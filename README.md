# AgentsBestFriend (abf)

Give your AI coding agents superpowers — a local [MCP](https://modelcontextprotocol.io/) server for fast, token-efficient code navigation, search & analysis.

Works with **VS Code Copilot**, **Cursor**, **Claude Code/Desktop**, **Codex**, **Cline**, **Zed**, **Gemini CLI**, **Goose**, **OpenCode**, and any other MCP-compatible agent.

---

## Why?

AI coding agents waste tokens re-reading files and searching blindly. ABF gives them purpose-built tools that return exactly what they need — in compact, structured responses that preserve context.

## Tools

| Tool | What it does |
|---|---|
| `abf_search` | Code search — exact (ripgrep), keyword-ranked, or semantic (embedding-based) |
| `abf_symbols` | Functions, classes, exports in a file (AST-based for TS/JS, regex for Python) |
| `abf_chunk` | Smart file chunk by symbol name, chunk index, or file overview |
| `abf_project_overview` | Tech stack, folder structure, key dependencies at a glance |
| `abf_dependencies` | Import graph — who imports what |
| `abf_impact` | Find all usages of a symbol across the project |
| `abf_git` | Git log, blame, diff (recent/staged/unstaged) |
| `abf_file_summary` | Full-text search across LLM-generated file summaries (FTS5, OR/AND mode) |
| `abf_conventions` | Detected naming, structure, and formatting conventions |
| `abf_index` | Index status, rebuild, incremental update, or trigger re-summarization |
| `abf_ping` | Health check — returns version and project root |

## Install

```bash
npm install -g agentsbestfriend
```

### Prerequisites

- **Node.js** ≥ 20
- **ripgrep** — `brew install ripgrep` (macOS) / `apt install ripgrep` (Linux)
- **git**
- **Ollama** (optional) — for summaries & semantic search: [ollama.com](https://ollama.com)

## Quick Start

```bash
abf init
```

`abf init` walks you through everything:

1. **Indexes your project** — discovers and indexes all files via `git ls-files`
2. **Generates LLM summaries & embeddings** (if Ollama is running) — with live `(12/80)` progress
3. **Adds `.abf/` to `.gitignore`** — prompts before writing
4. **Installs ABF as an MCP server** for your agents — you pick which agents (Cursor, VS Code, Claude Code, etc.) and whether to use `npx agentsbestfriend start` (always latest) or `abf start` (local install)

### Manual Agent Setup

If you prefer to configure manually, add ABF as a stdio MCP server. Using `npx` is recommended — it always runs the latest published version without requiring a global install:

**VS Code / GitHub Copilot** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "abf": {
      "command": "npx",
      "args": ["agentsbestfriend", "start"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "abf": {
      "command": "npx",
      "args": ["agentsbestfriend", "start"]
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "abf": {
      "command": "npx",
      "args": ["agentsbestfriend", "start"]
    }
  }
}
```

> Set `ABF_PROJECT_ROOT` in the `env` block if the agent does not pass its working directory automatically.

## CLI Commands

```
abf start          Start MCP server in stdio mode (used by agents)
abf init [path]    Index project, set up .gitignore entry, install MCP for agents
abf index [path]   Re-index a project (incremental by default)
abf status [path]  Show index stats
abf config         Interactive configuration editor
abf doctor         Health checks (Node, ripgrep, git, Ollama)
abf portal         Interactive TUI dashboard
```

## How It Works

ABF maintains a lightweight SQLite index (`.abf/index.db`) inside each project root. The index is built once and updated incrementally — only changed files are re-processed. A file watcher keeps it current as you edit.

| Table | Contents |
|---|---|
| `files` | Paths, hashes, languages, line counts, LLM summaries |
| `symbols` | Functions, classes, interfaces, types (AST-extracted) |
| `imports` | Dependency edges between files |
| `embeddings` | Float32 vectors for semantic search (chunked for large files) |
| `file_chunks` | Smart chunks aligned to symbol boundaries |
| `files_fts` | FTS5 full-text index over summaries |

## Optional: LLM Enrichment

With [Ollama](https://ollama.com) running locally, ABF generates file summaries and embeddings:

```bash
ollama pull qwen2.5-coder:1.5b    # file summaries
ollama pull nomic-embed-text       # embeddings / semantic search
```

Both `abf init` and `abf portal → Re-index` show live progress:

```
◆  Generating LLM summaries... (14/80)
◆  Generating embeddings... (28/80)
```

Large files are automatically split into chunks for embedding — no context-length errors.

Without Ollama, all tools still work normally. Semantic search falls back to keyword mode.

## Configuration

Global config at `~/.abf/config.json`. Edit interactively with `abf config` or via `abf portal`.

```json
{
  "llm": {
    "provider": "ollama",
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "summaryModel": "qwen2.5-coder:1.5b",
      "embeddingModel": "nomic-embed-text"
    }
  },
  "indexing": {
    "autoWatch": true,
    "respectGitignore": true,
    "maxFileSizeKb": 512,
    "excludedPatterns": ["*.min.js", "*.min.css", "*.map", "*.lock"]
  },
  "search": {
    "defaultMaxResults": 20
  }
}
```

## Architecture

```
AgentsBestFriend/
├── packages/
│   ├── core/     Shared logic — DB, config, search, analysis, indexer, LLM
│   ├── server/   MCP server (11 tools)
│   └── cli/      Commander.js CLI + TUI portal
├── turbo.json
└── package.json
```

Built with Turborepo + pnpm workspaces. Core modules:

| Module | Purpose |
|---|---|
| `@abf/core/db` | Drizzle ORM + SQLite (WAL, FTS5) |
| `@abf/core/config` | Zod-validated config |
| `@abf/core/search` | ripgrep, keyword scorer, semantic (cosine similarity) |
| `@abf/core/analysis` | ts-morph AST, conventions detector, project overview |
| `@abf/core/indexer` | git ls-files discovery, incremental pipeline, file watcher |
| `@abf/core/llm` | Ollama client, summary & chunked embedding pipelines |
| `@abf/core/git` | Git CLI wrapper |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode
pnpm dev

# Type-check
pnpm type-check
```

## Links

- **GitHub**: [github.com/TheRealFloatDev/AgentsBestFriend](https://github.com/TheRealFloatDev/AgentsBestFriend)
- **npm**: [npmjs.com/package/agentsbestfriend](https://npmjs.com/package/agentsbestfriend)
- **Issues**: [github.com/TheRealFloatDev/AgentsBestFriend/issues](https://github.com/TheRealFloatDev/AgentsBestFriend/issues)
- **MCP Spec**: [modelcontextprotocol.io](https://modelcontextprotocol.io)

## License

MIT
