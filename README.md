# threads

> This project was built in collaboration with [Claude](https://claude.ai) (Anthropic). The code and documentation were written with AI assistance.

A minimal static site compiler for a personal website built around the idea of *threads* — short, interconnected notes that link together into a web of thought.

## Concept

Each markdown file is a thread. A parent thread declares its children via the `threads` frontmatter field. When a thread page renders, it shows its own content followed by all its child threads inline beneath it — creating a feed-like reading experience where context flows downward.

A thread with multiple parents appears on each parent's page. Links at the bottom of each page point back to its parents, and a small label next to an inline child points to its other parent pages if it belongs to more than one.

Only threads with a non-empty `targets` field get their own HTML page. Others are still rendered inline as children on their parent's page.

## Compiler

```bash
threads compile --input <dir> --output <dir> [--template <dir>] [--base <path>] [--index <id>] [--serve] [--port <n>]
```

- `--template <dir>` — folder containing `thread.html` and `child.html`; defaults to the bundled template
- `--base <path>` — URL path prefix for all internal links (e.g. `/my-repo` for GitHub Pages)
- `--index <id>` — thread filename (without `.md`) to also copy as `index.html` at the output root
- `--serve` — watch input for changes, recompile, and serve output with live reload
- `--port` — dev server port (default: 8080)

Every thread with a non-empty `targets` field generates a page at `threads/<url-safe-filename>.html`.

### Templates

Two HTML files in the template folder:

- `thread.html` — full page. Placeholders: `{{TITLE}}`, `{{CONTENT}}`, `{{CHILDREN}}`, `{{PARENTS}}`
- `child.html` — inline child thread. Placeholders: `{{TITLE}}`, `{{CONTENT}}`, `{{PARENT_LINKS}}`

## Preprocessor

```bash
threads pre <command> [options]
```

### `clean --input <dir>`

Resolves `parents` frontmatter fields across source files. For each `[[Parent]]` reference that exists in the input directory, removes it from the child's `parents` list and prepends `[[Child]]` to the parent's `threads` list. Unresolvable references (file doesn't exist) are left in place.

Useful when adding a new thread from Obsidian or a text editor without opening the parent file.

### `sync --input <dir> [--targets <json>] [target-key...]`

Copies source files to target directories based on a targets JSON file. A file is included if it has the target's `name` in its `targets` field, or if it is a direct child of a file that does. Tagged files keep their `targets` field trimmed to the current target; child-included files have `targets` removed.

- `--targets <json>` — path to the targets JSON file; defaults to `targets.json` in the input directory

Omitting `[target-key...]` builds all targets.

## Frontmatter

```yaml
---
targets: "[[>MyTarget]]"  # wikilink-style tag; controls sync inclusion and page generation
threads:
  - "[[child-note]]"      # declared child threads by filename (no extension)
parents:                  # temporary field consumed by `clean`; references are moved to parent files
  - "[[parent-note]]"
---
```

## targets.json

```json
{
  "my-target": {
    "name": ">MyTarget",       
    "output_path": "./synced/",
    "index": "Home"            
  }
}
```

- `name` — value matched against the `targets` frontmatter field (with wikilink brackets stripped)
- `output_path` — destination directory, relative to the targets.json file
- `index` — optional source file ID to also copy as `index.html` when compiling

## Dependencies

- [`marked`](https://github.com/markedjs/marked) — markdown to HTML
- [`gray-matter`](https://github.com/jonschlinkert/gray-matter) — frontmatter parsing
- [`chokidar`](https://github.com/paulmillr/chokidar) — file watching
