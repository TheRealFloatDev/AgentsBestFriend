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

| What you want to do               | CORRECT tool                | WRONG approach                         |
| --------------------------------- | --------------------------- | -------------------------------------- |
| Understand the project            | `abf_project_overview`      | `list_dir` + reading package.json      |
| Find a function/class definition  | `abf_search` mode: exact    | `grep_search`                          |
| Read a specific function          | `abf_chunk` symbol: "name"  | `read_file` entire file                |
| See what a file exports           | `abf_symbols`               | `read_file` + manual scan              |
| Find files about a topic          | `abf_search` mode: keyword  | multiple `semantic_search` calls       |
| Trace what a file imports         | `abf_dependencies`          | `grep_search` for import statements    |
| Who calls this function?          | `abf_impact` symbol: "name" | `grep_search` with manual filtering    |
| Understand project style          | `abf_conventions`           | reading eslint + tsconfig + prettier   |
| Get context around a file         | `abf_context_bundle`        | 5–10 `read_file` + `abf_symbols` calls |
| Search file descriptions          | `abf_file_summary`          | no native equivalent                   |
| Multi-strategy search in one call | `abf_search_multi`          | 3 separate `abf_search` calls          |
| Typed impact (TS/JS, classified)  | `abf_impact_typed`          | `abf_impact` + manual classification   |
| Risk/blast radius of a file       | `abf_blast_radius`          | `abf_dependencies` chains by hand      |
| Find tests covering file/symbol   | `abf_related_tests`         | `abf_search` with manual filtering     |
| Preview an edit before writing    | `abf_preview_changes`       | guessing — then write & hope           |
| Plan a rename/move/extract        | `abf_refactor_plan`         | start editing without an ordered plan  |
| Git history / blame / diff        | `abf_git`                   | `run_in_terminal` with git commands    |
| Index status or rebuild           | `abf_index`                 | nothing                                |

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

For TypeScript/JavaScript projects prefer `abf_impact_typed` — it classifies each
reference (definition / call / import / type_ref / jsx) with a confidence level.

### Plan → preview → verify (before any non-trivial edit)

```
1. abf_blast_radius   (file)                ← scope: who breaks if this changes?
2. abf_refactor_plan  (intent + symbol)     ← ordered, collision-checked edit plan
3. abf_preview_changes (file, new_content)  ← diff + symbol/import deltas + risk flags
4. abf_related_tests  (file or symbol)      ← which tests must stay green
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

### `abf_impact_typed`

AST-aware impact analysis for TypeScript/JavaScript using ts-morph.
Classifies every reference and reports a confidence level.

- `symbol` — required
- `file_path` — optional, scopes to that file's import closure
- `include_kinds` — filter to e.g. `["call", "import"]`
- Reference kinds: `definition`, `import`, `export`, `call`, `type_ref`, `jsx`, `reference`
- Confidence: `high` (TS AST classification) vs `low` (regex fallback for non-TS files)

Prefer this over `abf_impact` whenever the codebase is primarily TS/JS.

### `abf_blast_radius`

BFS over the reverse-import graph for a single file. Returns impacted files per
depth level, distinct affected symbols, test files in scope, and a weighted
`break_risk_score` (0–100) plus `low`/`medium`/`high` label and a recommendation.

- `file_path` — required
- `depth` — 1–5 (default 3)
- `include_tests` — count test files separately
- Use it before refactors to know how far the blast goes.

### `abf_related_tests`

Heuristically ranks test files most likely to cover a given source file or symbol.
Scoring combines name match, importer relationship, and symbol mentions.

- `file_path` — match by name and import edges
- `symbol` — match by mentions inside test bodies
- At least one of the two must be provided
- Returns `[high|medium|low/<score>]` with reasons (`name match`, `imports source`, `mentions "<symbol>"`)

### `abf_preview_changes`

Read-only preview of an edit. Computes a unified diff plus structured deltas:
added/removed/modified symbols, import diffs, risk flags (`breaking:` for removed
exports), suggested checks, and a probe for external usage of removed exports.
**Does not write anything.**

- `file_path` + `new_content` (required)
- `old_content` — optional override; otherwise reads the current file
- `probe_external_usage` — default `true`
- Run this before sending any non-trivial edit.

### `abf_refactor_plan`

Read-only ordered edit plan for refactors. **Plans only — does not modify files.**

- `intent: "rename"` — fully implemented: locates target, detects naming
  collisions, returns a source-file-first ordered list of files to edit with
  per-file occurrence counts.
- `intent: "move" | "extract" | "split"` — returns structured guidance.
- Always pair the output with `abf_preview_changes` per file before applying.

### `abf_search_multi`

Runs up to 8 sub-queries (`exact`, `keyword`, `semantic`) in one call and merges
results with weighted, normalized scoring. Each query carries its own `mode`
and `weight`.

- Use it when one mode alone gives noisy or partial results.
- Falls back to `keyword` (with reduced weight) if `semantic` is unavailable.
- Prefer this over issuing 2–3 separate `abf_search` calls.

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
