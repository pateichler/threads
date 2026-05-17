import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import matter from "gray-matter";
import { marked } from "marked";
import * as chokidar from "chokidar";

interface Thread {
  id: string;
  slug: string;              // auto-generated from filename, e.g. "threads/my-note"
  targets: string[];         // from frontmatter `targets` key
  declaredThreads: string[]; // child IDs from frontmatter `threads` key
  contentHtml: string;
  children: string[]; // resolved + sorted
  parents: string[];  // inverted from other threads' declaredThreads
}

type ThreadMap = Record<string, Thread>;

export interface CompileOptions {
  input: string;
  output: string;
  template: string;
  serve: boolean;
  port: number;
  index: string | null;
  base: string;
}

function parseWikilink(ref: string): string {
  return ref.replace(/^\[\[/, "").replace(/\]\]$/, "");
}

function toSlug(id: string): string {
  if (id === "_index") return "index";
  const name = id.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `threads/${name}`;
}

// Pass 1: read all .md files, parse frontmatter and content
function readThreads(inputDir: string): ThreadMap {
  const threads: ThreadMap = {};

  const files = fs.readdirSync(inputDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const id = path.basename(file, ".md");
    const raw = fs.readFileSync(path.join(inputDir, file), "utf8");
    const { data, content } = matter(raw);

    threads[id] = {
      id,
      slug: toSlug(id),
      targets: Array.isArray(data.targets) ? data.targets : [],
      declaredThreads: Array.isArray(data.threads)
        ? data.threads.map((c: string) => parseWikilink(c))
        : [],
      contentHtml: marked(content) as string,
      children: [],
      parents: [],
    };
  }

  return threads;
}

// Pass 1 (continued): resolve declaredThreads into children, invert to build parents
function buildChildLists(threads: ThreadMap): void {
  for (const thread of Object.values(threads)) {
    for (const childId of thread.declaredThreads) {
      if (threads[childId]) {
        thread.children.push(childId);
        threads[childId].parents.push(thread.id);
      }
    }
  }
  for (const thread of Object.values(threads)) {
    thread.children.sort();
  }
}

function renderChild(
  childId: string,
  currentParentId: string,
  threads: ThreadMap,
  childTemplate: string,
  base: string
): string {
  const child = threads[childId];

  const hasOwnChildren = child.children.length > 0;
  const title =
    hasOwnChildren && child.slug
      ? `<a href="${slugToOutputPath(child.slug, base).href}">${child.id}</a>`
      : child.id;

  // Links to the child's other parents (those with slugs, excluding the current page)
  const parentLinks = child.parents
    .filter((p) => p !== currentParentId && threads[p]?.slug)
    .map((p) => {
      const { href } = slugToOutputPath(threads[p].slug, base);
      return `<a href="${href}">${threads[p].id}</a>`;
    })
    .join(" ");

  return childTemplate
    .replace("{{TITLE}}", title)
    .replace("{{CONTENT}}", child.contentHtml)
    .replace("{{PARENT_LINKS}}", parentLinks);
}

function slugToOutputPath(slug: string, base = ""): { filePath: string; href: string } {
  const p = path.extname(slug) ? slug : slug + ".html";
  return { filePath: p, href: base + "/" + p };
}

// Pass 2: render one HTML file per thread with a slug
function renderThreads(
  threads: ThreadMap,
  outputDir: string,
  threadTemplate: string,
  childTemplate: string,
  base: string
): void {
  for (const thread of Object.values(threads)) {
    if (thread.targets.length === 0) continue;

    const childrenHtml = thread.children
      .map((childId) => renderChild(childId, thread.id, threads, childTemplate, base))
      .join("\n");

    const parentsHtml = thread.parents
      .filter((p) => threads[p]?.slug)
      .map((p) => {
        const { href } = slugToOutputPath(threads[p].slug, base);
        return `<a href="${href}">${threads[p].id}</a>`;
      })
      .join(" ");

    const html = threadTemplate
      .replace(/\{\{TITLE\}\}/g, thread.id)
      .replace("{{CONTENT}}", thread.contentHtml)
      .replace("{{CHILDREN}}", childrenHtml)
      .replace("{{PARENTS}}", parentsHtml);

    const { filePath } = slugToOutputPath(thread.slug, base);
    const outPath = path.join(outputDir, filePath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, "utf8");
    console.log(`wrote ${outPath}`);
  }
}

function compile(
  inputDir: string,
  outputDir: string,
  threadTemplate: string,
  childTemplate: string,
  indexId: string | null,
  base: string
): void {
  const threads = readThreads(inputDir);
  buildChildLists(threads);
  renderThreads(threads, outputDir, threadTemplate, childTemplate, base);

  if (indexId) {
    const thread = threads[indexId];
    if (!thread) {
      console.error(`--index: thread "${indexId}" not found`);
      return;
    }
    const { filePath } = slugToOutputPath(thread.slug, base);
    const src = path.join(outputDir, filePath);
    const dest = path.join(outputDir, "index.html");
    fs.copyFileSync(src, dest);
    console.log(`wrote ${dest}`);
  }
}

// Injected into served HTML pages to trigger a reload on SSE message
const SSE_SCRIPT = `<script>new EventSource('/sse').onmessage = () => location.reload();</script>`;

function startDevServer(outputDir: string, port: number): () => void {
  const clients: http.ServerResponse[] = [];

  function broadcast(): void {
    for (const client of clients) {
      client.write("data: reload\n\n");
    }
  }

  const server = http.createServer((req, res) => {
    if (req.url === "/sse") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      clients.push(res);
      req.on("close", () => {
        const i = clients.indexOf(res);
        if (i !== -1) clients.splice(i, 1);
      });
      return;
    }

    let urlPath = req.url?.split("?")[0] ?? "/";
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = path.join(outputDir, urlPath);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const isHtml = filePath.endsWith(".html");
      res.writeHead(200, {
        "Content-Type": isHtml ? "text/html" : "application/octet-stream",
      });
      const body = isHtml
        ? data.toString().replace("</body>", `${SSE_SCRIPT}</body>`)
        : data;
      res.end(body);
    });
  });

  server.listen(port, () => console.log(`serving http://localhost:${port}`));
  return broadcast;
}

export function run(options: CompileOptions): void {
  const { input, output, template, serve, port, index, base } = options;

  const threadTemplate = fs.readFileSync(
    path.join(template, "thread.html"),
    "utf8"
  );
  const childTemplate = fs.readFileSync(
    path.join(template, "child.html"),
    "utf8"
  );

  compile(input, output, threadTemplate, childTemplate, index, base);

  if (!serve) return;

  const broadcast = startDevServer(output, port);

  // Debounce recompilation to handle editors that use atomic writes (unlink +
  // add), which would otherwise trigger a compile mid-rename with a missing file.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRecompile() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      compile(input, output, threadTemplate, childTemplate, index, base);
      broadcast();
    }, 100);
  }

  chokidar
    .watch(input, { depth: 0, ignoreInitial: true })
    .on("all", (_, filePath) => {
      if (typeof filePath !== "string" || !filePath.endsWith(".md")) return;
      console.log(`changed: ${path.basename(filePath)}`);
      scheduleRecompile();
    });
}

