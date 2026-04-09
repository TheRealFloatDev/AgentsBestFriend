---
name: abf
description: "Use AgentsBestFriend (ABF) MCP tools for codebase navigation, search, and analysis instead of native file-reading tools. USE WHEN: exploring unfamiliar code, understanding architecture, searching across files, tracing imports/dependencies, analyzing change impact, reading large files, or needing project context. Prefer ABF tools over read_file, grep_search, semantic_search, and list_dir for multi-file workflows — they return pre-structured, token-efficient results in a single call."
---

# AgentsBestFriend (ABF) — Codebase Navigation Skill

ABF is a local MCP server that provides AI-optimized tools for navigating, searching, and analyzing code repositories. These tools return structured, compact results that save 50–80% of tokens compared to manually reading files.

## When to Use ABF Tools

**Always prefer ABF tools when you need to:**
- Understand a project's structure or tech stack
- Search for code across files (exact, keyword, or semantic)
- Read specific functions or classes from large files
- Trace imports, dependencies, or reverse dependencies
- Assess the impact of changing a symbol
- Get multi-file context around an entry point

**Use native tools only when:**
- Making edits to files (ABF is read-only)
- Checking for lint/compile errors
- Running terminal commands
- The ABF MCP server is not connected

## Decision Matrix

| Task | ABF Tool | Instead of |
|------|----------|------------|
| Orient in a new project | `abf_project_overview` | Reading README + listing directories + checking package.json |
| Find where something is defined | `abf_search` (exact mode) | `grep_search` |
| Find files related to a concept | `abf_search` (keyword mode) | Multiple `semantic_search` + `grep_search` calls |
| Read a specific function from a large file | `abf_chunk` with symbol name | `read_file` (which loads entire file or requires guessing line ranges) |
| List all exports of a file | `abf_symbols` | `read_file` and scanning manually |
| Understand what a file imports and who imports it | `abf_dependencies` | Multiple `grep_search` calls for import statements |
| Get multi-file context around one entry point | `abf_context_bundle` | 5–10 calls to `read_file` + `abf_symbols` + `abf_dependencies` |
| Find all usages of a function/class | `abf_impact` | `grep_search` with manual filtering |
| Understand project conventions | `abf_conventions` | Reading multiple config files manually |
| Search by file purpose/description | `abf_file_summary` | No native equivalent |
| Check git history or blame | `abf_git` | `run_in_terminal` with git commands |

## Recommended Workflows

### 1. First Contact with a Codebase

```
1. abf_project_overview              → architecture, tech stack, entry points
2. abf_conventions                   → coding style, patterns, naming
3. abf_search (keyword: "main topic") → find relevant files
```

### 2. Understanding a Specific File

```
1. abf_symbols (file)               → see all exports/functions at a glance
2. abf_chunk (file, symbol: "name") → read just the function you care about
3. abf_dependencies (file)          → see what it imports and who imports it
```

### 3. Deep Dive into a Feature

```
1. abf_context_bundle (entry file, depth: 2, include: "smart")
   → full source of entry + signatures of all dependencies in ONE call
2. If needed: abf_chunk to read specific dependency functions
```

### 4. Change Impact Analysis

```
1. abf_impact (symbol: "functionName")  → all files and lines referencing it
2. abf_context_bundle (entry, focus_symbol: "functionName", reverse: true)
   → focused view of the function + its callers
```

### 5. Searching for Code

```
- Know the exact name?       → abf_search mode: "exact"
- Exploring a concept?       → abf_search mode: "keyword"
- Describe what you need?    → abf_file_summary (searches LLM-generated descriptions)
- Semantic similarity?       → abf_search mode: "semantic" (requires Ollama)
```

## Tool Reference

### abf_project_overview
**When:** Starting work on a project, or when asked "what does this project do?"
**Saves:** Reading README + package.json + listing directories manually (3–5 calls → 1)
- Returns: tech stack, frameworks, entry points, directory structure, language distribution, architectural patterns
- No index required — works immediately

### abf_search
**When:** Looking for code, files, or patterns across the project
**Saves:** Multiple grep_search or semantic_search calls
- `mode: "exact"` — ripgrep-powered, supports regex, returns matching lines with context
- `mode: "keyword"` — scores every file by keyword density, best for exploration
- `mode: "semantic"` — embedding similarity (requires Ollama + index with embeddings)
- Use `path_filter` to narrow scope (e.g. `"src/**/*.ts"`)

### abf_context_bundle
**When:** You need to understand a file in the context of its dependencies
**Saves:** 5–10 calls to read_file + abf_symbols + abf_dependencies (biggest saver)
- `include: "smart"` (default) — full source for entry, signatures for deps
- `include: "signatures"` — compact type signatures only (minimal tokens)
- `include: "full"` — full source code for all files up to depth
- `focus_symbol` — only follows imports relevant to one function/class
- `reverse: true` — also shows who imports this file
- `depth: 0–4` — how far to follow the import graph

### abf_chunk
**When:** You need to read a specific function/class from a file without loading the entire file
**Saves:** read_file loading hundreds of irrelevant lines
- Call with `symbol: "functionName"` to get its full source code directly
- Call without symbol first to get a chunk overview, then use `chunk_index` to retrieve specific sections

### abf_symbols
**When:** You need to see what a file exports without reading its full content
**Saves:** read_file + mentally parsing the file structure
- Returns: function signatures, classes, interfaces, types, variables with line ranges
- Shows export status (★ = exported) and nesting

### abf_dependencies
**When:** Tracing what a file imports or finding who depends on it
**Saves:** Multiple grep_search calls for import statements
- Returns both imports and reverse dependencies (imported_by)

### abf_impact
**When:** Assessing how widely a symbol is used before changing it
**Saves:** grep_search + manual filtering of false positives
- Returns all files and specific lines that reference the symbol
- Classifies usage type (call, import, type reference, etc.)

### abf_file_summary
**When:** Searching by file purpose rather than exact code text
**Saves:** No native equivalent — unique capability
- Full-text search across LLM-generated file descriptions
- Requires summaries to be generated first (`abf_index` action: summarize)

### abf_conventions
**When:** Understanding project style before making changes
**Saves:** Reading eslint, tsconfig, prettier, and other config files manually
- Detects naming patterns, design patterns, folder structure conventions
- Returns confidence scores and examples

### abf_git
**When:** Checking history, blame, or diffs
**Saves:** Running git commands in terminal and parsing output
- Actions: log, file_history, blame, diff
- Structured output ready for analysis

### abf_index
**When:** Managing the ABF index
- `status` — check index health
- `rebuild` — full re-index
- `update` — incremental update
- `summarize` — generate LLM summaries (requires Ollama)

### abf_ping
**When:** Verifying ABF is running
- Returns server version, project root, and status
