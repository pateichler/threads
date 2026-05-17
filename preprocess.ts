import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

interface Target {
  name: string;
  output_path: string;
  index?: string; // source file ID to use as index.html
}

type TargetsConfig = Record<string, Target>;

interface SourceThread {
  id: string;
  file: string;
  targets: string[];
  declaredChildren: string[]; // from frontmatter `threads` key
  data: Record<string, unknown>;
  content: string;
}

type ThreadMap = Record<string, SourceThread>;

function parseArgs(): {
  command: string;
  flags: Record<string, string>;
  targetKeys: string[];
} {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command) {
    console.error("Usage: node preprocess.js <command> [options]");
    console.error("Commands: clean, sync");
    process.exit(1);
  }

  const flags: Record<string, string> = {};
  const targetKeys: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else {
      targetKeys.push(args[i]);
    }
  }

  return { command, flags, targetKeys };
}

function parseWikilink(ref: string): string {
  return ref.replace(/^\[\[/, "").replace(/\]\]$/, "");
}

function normalizeTargets(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return items.map((t: string) => parseWikilink(t));
}

function readThreads(inputDir: string): ThreadMap {
  const threads: ThreadMap = {};
  const files = fs.readdirSync(inputDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const id = path.basename(file, ".md");
    const raw = fs.readFileSync(path.join(inputDir, file), "utf8");
    const { data, content } = matter(raw);

    threads[id] = {
      id,
      file,
      targets: normalizeTargets(data.targets),
      declaredChildren: Array.isArray(data.threads)
        ? data.threads.map((c: string) => parseWikilink(c))
        : [],
      data: data as Record<string, unknown>,
      content,
    };
  }

  return threads;
}

function copyThread(
  thread: SourceThread,
  outputDir: string,
  targets: string[]
): void {
  const newData: Record<string, unknown> = { ...thread.data };
  if (targets.length > 0) {
    newData.targets = targets;
  } else {
    delete newData.targets;
  }

  const output = matter.stringify(thread.content, newData);
  fs.writeFileSync(path.join(outputDir, thread.file), output, "utf8");
}

function syncTarget(
  targetKey: string,
  target: Target,
  threads: ThreadMap,
  targetsJsonDir: string
): void {
  const outputDir = path.resolve(targetsJsonDir, target.output_path);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Files explicitly tagged for this target
  const tagged = new Set(
    Object.values(threads)
      .filter((t) => t.targets.includes(target.name))
      .map((t) => t.id)
  );

  // Direct children of tagged files not already tagged
  const children = new Set<string>();
  for (const id of tagged) {
    for (const childId of threads[id].declaredChildren) {
      if (threads[childId] && !tagged.has(childId)) {
        children.add(childId);
      }
    }
  }

  for (const id of tagged) {
    copyThread(threads[id], outputDir, [targetKey]);
  }
  for (const id of children) {
    copyThread(threads[id], outputDir, []);
  }

  console.log(
    `[${targetKey}] copied ${tagged.size} tagged + ${children.size} child files → ${outputDir}`
  );
}

function cmdClean(flags: Record<string, string>): void {
  if (!flags.input) {
    console.error("Usage: node preprocess.js clean --input <dir>");
    process.exit(1);
  }

  const inputDir = flags.input;
  const files = fs.readdirSync(inputDir).filter((f) => f.endsWith(".md"));

  // Read all files into memory before making any changes
  const parsed: Record<string, { data: Record<string, unknown>; content: string }> = {};
  for (const file of files) {
    const id = path.basename(file, ".md");
    const raw = fs.readFileSync(path.join(inputDir, file), "utf8");
    const { data, content } = matter(raw);
    parsed[id] = { data: data as Record<string, unknown>, content };
  }

  const modified = new Set<string>();

  for (const file of files) {
    const id = path.basename(file, ".md");
    const { data } = parsed[id];

    const rawParents: string[] = Array.isArray(data.parents)
      ? data.parents
      : typeof data.parents === "string"
      ? [data.parents]
      : [];

    if (rawParents.length === 0) continue;

    const unresolved: string[] = [];

    for (const raw of rawParents) {
      const parentId = parseWikilink(raw);
      if (!parsed[parentId]) {
        unresolved.push(raw);
        continue;
      }

      // Prepend child to parent's threads, guarding against duplicates
      const parentData = parsed[parentId].data;
      const existing: string[] = Array.isArray(parentData.threads)
        ? parentData.threads
        : typeof parentData.threads === "string"
        ? [parentData.threads]
        : [];
      const childWikilink = `[[${id}]]`;
      if (!existing.includes(childWikilink)) {
        parentData.threads = [childWikilink, ...existing];
        modified.add(parentId);
      }
    }

    // Update or remove parents field on this file
    if (unresolved.length === 0) {
      delete data.parents;
    } else {
      data.parents = unresolved;
    }
    if (unresolved.length < rawParents.length) modified.add(id);
  }

  for (const id of modified) {
    const { data, content } = parsed[id];
    const output = matter.stringify(content, data);
    fs.writeFileSync(path.join(inputDir, `${id}.md`), output, "utf8");
    console.log(`cleaned ${id}.md`);
  }
}

function cmdSync(flags: Record<string, string>, targetKeys: string[]): void {
  if (!flags.input || !flags.targets) {
    console.error(
      "Usage: node preprocess.js sync --input <dir> --targets <json> [target-key...]"
    );
    process.exit(1);
  }

  const config: TargetsConfig = JSON.parse(
    fs.readFileSync(flags.targets, "utf8")
  );
  const targetsJsonDir = path.dirname(path.resolve(flags.targets));
  const threads = readThreads(flags.input);
  const keys = targetKeys.length > 0 ? targetKeys : Object.keys(config);

  for (const key of keys) {
    if (!config[key]) {
      console.error(`Unknown target: ${key}`);
      continue;
    }
    syncTarget(key, config[key], threads, targetsJsonDir);
  }
}

function main(): void {
  const { command, flags, targetKeys } = parseArgs();

  if (command === "sync") {
    cmdSync(flags, targetKeys);
  } else if (command === "clean") {
    cmdClean(flags);
  } else {
    console.error(`Unknown command: ${command}. Available: clean, sync`);
    process.exit(1);
  }
}

main();
