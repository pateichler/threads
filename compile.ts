import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import { marked } from "marked";

interface Thread {
  id: string;
  slug: string;
  parents: string[];
  contentHtml: string;
  children: string[];
}

type ThreadMap = Record<string, Thread>;

function parseArgs(): { input: string; output: string; template: string } {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  if (!flags.input || !flags.output || !flags.template) {
    console.error(
      "Usage: node compile.js --input <dir> --output <dir> --template <dir>"
    );
    process.exit(1);
  }
  return flags as { input: string; output: string; template: string };
}

function parseWikilink(ref: string): string {
  return ref.replace(/^\[\[/, "").replace(/\]\]$/, "");
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
      slug: typeof data.slug === "string" ? data.slug : "",
      parents: Array.isArray(data.parents)
        ? data.parents.map((p: string) => parseWikilink(p))
        : [],
      contentHtml: marked(content) as string,
      children: [],
    };
  }

  return threads;
}

// Pass 1 (continued): invert parent declarations into child lists
function buildChildLists(threads: ThreadMap): void {
  for (const thread of Object.values(threads)) {
    for (const parentId of thread.parents) {
      if (threads[parentId]) {
        threads[parentId].children.push(thread.id);
      }
    }
  }
  for (const thread of Object.values(threads)) {
    thread.children.sort();
  }
}

function renderChild(
  childId: string,
  threads: ThreadMap,
  childTemplate: string
): string {
  const child = threads[childId];
  const validParents = child.parents.filter((p) => threads[p]);
  const hasMultipleParents = validParents.length > 1;

  let parentLinks = "";
  if (hasMultipleParents && child.slug) {
    parentLinks = `<a href="/${child.slug}.html">permalink</a>`;
  }

  return childTemplate
    .replace("{{CONTENT}}", child.contentHtml)
    .replace("{{PARENT_LINKS}}", parentLinks);
}

// Pass 2: render one HTML file per thread with a slug
function renderThreads(
  threads: ThreadMap,
  outputDir: string,
  threadTemplate: string,
  childTemplate: string
): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const thread of Object.values(threads)) {
    if (!thread.slug) continue;

    const childrenHtml = thread.children
      .map((childId) => renderChild(childId, threads, childTemplate))
      .join("\n");

    const html = threadTemplate
      .replace(/\{\{TITLE\}\}/g, thread.id)
      .replace("{{CONTENT}}", thread.contentHtml)
      .replace("{{CHILDREN}}", childrenHtml);

    const outPath = path.join(outputDir, `${thread.slug}.html`);
    fs.writeFileSync(outPath, html, "utf8");
    console.log(`wrote ${outPath}`);
  }
}

function main(): void {
  const { input, output, template } = parseArgs();

  const threads = readThreads(input);
  buildChildLists(threads);

  const threadTemplate = fs.readFileSync(
    path.join(template, "thread.html"),
    "utf8"
  );
  const childTemplate = fs.readFileSync(
    path.join(template, "child.html"),
    "utf8"
  );

  renderThreads(threads, output, threadTemplate, childTemplate);
}

main();
