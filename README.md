# threads

A minimal static site compiler for a personal website built around the idea of *threads* — short, interconnected notes that link together into a web of thought.

## Concept

Each markdown file is a thread. Threads are connected through parent-child relationships: a thread declares its parents in frontmatter, and the compiler inverts these to build child lists. When a thread page renders, it shows its own content followed by all its child threads inline beneath it — creating a feed-like reading experience where context flows downward.

A thread with multiple parents appears on each parent's page. Links at the bottom of each page point back to its parents, and a small label next to an inline child points to its other parent pages if it belongs to more than one.

## Usage

```bash
npm run build
node compile.js --input ./notes --output ./site --template ./template
```

Add `--serve` to watch for changes and serve the output locally:

```bash
node compile.js --input ./notes --output ./site --template ./template --serve
node compile.js --input ./notes --output ./site --template ./template --serve --port 3000
```

## Frontmatter

```yaml
---
threads:
  - "[[some-note]]"  # Wikilink-style references to child threads by filename.
---
```

Every thread generates a page at `threads/{{url-safe-filename}}.html`. The URL-safe name is the filename lowercased with spaces replaced by hyphens.

## Templates

Two HTML files in the template folder drive the output:

- `thread.html` — the full page. Placeholders: `{{TITLE}}`, `{{CONTENT}}`, `{{CHILDREN}}`, `{{PARENTS}}`
- `child.html` — one inline child thread. Placeholders: `{{TITLE}}`, `{{CONTENT}}`, `{{PARENT_LINKS}}`

## Dependencies

- [`marked`](https://github.com/markedjs/marked) — markdown to HTML
- [`gray-matter`](https://github.com/jonschlinkert/gray-matter) — frontmatter parsing
- [`chokidar`](https://github.com/paulmillr/chokidar) — file watching
