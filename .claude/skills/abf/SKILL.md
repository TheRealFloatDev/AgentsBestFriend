---
name: abf
description: "MANDATORY: AgentsBestFriend (ABF) MCP tools are connected and MUST be used for ALL code navigation, search, and analysis. NEVER use read_file, grep_search, semantic_search, or list_dir for exploring code — ABF tools are faster, return structured results, and use 50–80% fewer tokens. USE FOR: any file reading, code search, symbol lookup, dependency tracing, impact analysis, git history, or architecture questions. Load this skill IMMEDIATELY whenever working in a codebase."
---

# AgentsBestFriend (ABF) — MANDATORY Code Navigation

> **CRITICAL**: ABF MCP tools are available and MUST be your default for all code exploration.  
> Using `read_file`, `grep_search`, or `list_dir` when ABF tools exist is **always wrong**.

---

## ABSOLUTE RULES

1. **NEVER call `read_file` to explore code** — use `abf_chunk` (by symbol) or `abf_symbols` first
2. **NEVER call `grep_search`** — use `abf_search` (exact/keyword/semantic modes)
3. **NEVER call `list_dir`** — use `abf_project_overview` or `abf_dependencies`
4. **NEVER call `semantic_search`** — use `abf_search mode: "semantic"` or `abf_file_summary`
5. **ALWAYS start a new codebase with `abf_project_overview`** — not by listing directories
6. **ALWAYS use `abf_impact` before modifying a symbol** — never guess what depends on it
7. **ALWAYS use `abf_conventions` before writing new code** — not by reading config files

---

## Quick Decision Reference

| What you want to do              | CORRECT tool                | WRONG approach                         |
| -------------------------------- | --------------------------- | -------------------------------------- |
| Understand the project           | `abf_project_overview`      | `list_dir` + reading package.json      |
| Find a function/class definition | `abf_search` mode: exact    | `grep_search`                          |
| Read a specific function         | `abf_chunk` symbol: "name"  | `read_file` entire file                |
| See what a file exports          | `abf_symbols`               | `read_file` + manual scan              |
| Find files about a topic         | `abf_search` mode: keyword  | multiple `semantic_search` calls       |
| Trace what a file imports        | `abf_dependencies`          | `grep_search` for import statements    |
| Who calls this function?         | `abf_impact` symbol: "name" | `grep_search` with manual filtering    |
| Understand project style         | `abf_conventions`           | reading eslint + tsconfig + prettier   |
| Get context around a file        | `abf_context_bundle`        | 5–10 `read_file` + `abf_symbols` calls |
| Search file descriptions         | `abf_file_summary`          | no native equivalent                   |
| Git history / blame / diff       | `abf_git`                   | `run_in_terminal` with git commands    |
| Index status or rebuild          | `abf_index`                 | nothing                                |

---

## Workflows

### Starting work on any codebase

```
1. abf_project_overview          ← ALWAYS first — architecture, stack, entry points
2. abf_conventions               ← style, patterns, naming before writing anything
3. abf_search (keyword mode)     ← find relevant files for the task
```

### Reading code in a file

```
1. abf_symbols (file)            ← see all exports/functions first
2. abf_chunk (symbol: "name")    ← read exactly the function you need
                                    only use read_file if you need the ENTIRE file
```

### Understanding a feature

```
abf_context_bundle (entry file, depth: 2)
← full source of entry + signatures of all deps in ONE call
← replaces 5–10 read_file calls
```

### Before changing anything

```
abf_impact (symbol: "functionName")
← ALL files and lines that reference it — never skip this
```

### Searching for code

```
Exact name known?    → abf_search mode: "exact"
Exploring a concept? → abf_search mode: "keyword"
By file purpose?     → abf_file_summary (searches LLM descriptions)
Semantic match?      → abf_search mode: "semantic"
```

---

## Tool Reference

### `abf_project_overview`

Returns tech stack, frameworks, entry points, folder structure, language distribution, architectural patterns.  
**Required params:** none  
**Use it:** at the start of every new task in an unfamiliar codebase.

### `abf_search`

- `mode: "exact"` — ripgrep regex, returns matching lines with context
- `mode: "keyword"` — ranks every file by keyword density, best for exploration
- `mode: "semantic"` — embedding similarity (requires Ollama index)
- `path_filter` — narrow scope (e.g. `"src/**/*.ts"`)

### `abf_chunk`

Read a specific function/class without loading the full file.

- `symbol: "functionName"` → returns the full body of that symbol
- No symbol → returns a chunk map; then use `chunk_index` for a specific section

### `abf_symbols`

All exports, functions, classes, interfaces in a file with line ranges.  
Call this before `abf_chunk` to see what's available.

### `abf_context_bundle`

**Biggest token saver.** Returns entry file + signatures/source of all its imports in one call.

- `include: "smart"` (default) — full source for entry, signatures for deps
- `include: "full"` — full source for everything
- `focus_symbol` — only follow imports relevant to one function
- `depth: 0–4` — how far to follow the import graph

### `abf_dependencies`

Returns both imports (what this file uses) and reverse dependencies (who imports this file).

### `abf_impact`

All files and specific lines that reference a symbol.  
**Always call before modifying a function, class, or exported type.**

### `abf_conventions`

Detected naming patterns, design patterns, folder structure conventions — with confidence scores and examples.

### `abf_file_summary`

Full-text search across LLM-generated file descriptions (FTS5/BM25 ranked).  
Use when you want to find files by purpose, not by exact code text.

- `match_mode: "or"` (default) — broader results
- `match_mode: "and"` — stricter matching

### `abf_git`

Structured git output — no terminal needed.

- `action: "log"` — recent commits
- `action: "file_history"` — commits touching a file
- `action: "blame"` — line-by-line authorship
- `action: "diff"` — staged, unstaged, or between commits

### `abf_index`

- `action: "status"` — index health and file count
- `action: "rebuild"` — full re-index
- `action: "update"` — incremental update
- `action: "summarize"` — generate LLM summaries (requires Ollama)

### `abf_ping`

Returns server version and project root. Use to verify ABF is connected.

---

## When ABF Tools Are NOT Needed

- **Writing/editing files** — ABF is read-only; use your normal edit tools
- **Running tests or build commands** — use the terminal
- **Checking lint/type errors** — use native diagnostic tools
- **ABF is not connected** — fall back to native tools, then reconnect with `abf start`
- **ABF returned no useful result** — if you already called the appropriate ABF tool and the output didn't answer your question (e.g. `abf_search` returned nothing, `abf_chunk` didn't find the symbol), fall back to native tools for that specific lookup. Do not skip ABF preemptively — only fall back _after_ ABF has been tried.
