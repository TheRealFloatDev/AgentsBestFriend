# AgentsBestFriend (abf)

A local [MCP](https://modelcontextprotocol.io/) server that gives AI coding agents fast, token-efficient tools for navigating, searching, and understanding codebases — including monorepos.

Works with **VS Code Copilot**, **Cursor**, **Claude Desktop/Code**, **Windsurf**, and any other MCP-compatible agent.

---

## Why?

AI coding agents waste tokens re-reading files, searching blindly, and losing context. ABF provides purpose-built tools that return exactly what the agent needs in compact, structured responses:

- **Fast search** — ripgrep-powered exact search, keyword-scored file ranking, and embedding-based semantic search
- **Code intelligence** — AST-based symbol extraction for TS/JS/Python, import/dependency mapping, impact analysis
- **Project awareness** — auto-detected tech stack, conventions, folder structure
- **LLM enrichment** — optional Ollama-powered file summaries and embeddings for semantic navigation
- **Zero config** — auto-initializes on first use; agents just call tools

## Features

| Tool | What it does |
|---|---|
| `abf_search` | Search code (exact/keyword/semantic modes) |
| `abf_symbols` | List functions, classes, exports in a file |
| `abf_chunk` | Get a smart chunk of a file by symbol/line range |
| `abf_project_overview` | Tech stack, structure, dependencies at a glance |
| `abf_dependencies` | Import graph — who imports what |
| `abf_impact` | Find all usages of a symbol across the project |
| `abf_git` | Commits, blame, diff (recent/staged/unstaged) |
| `abf_file_summary` | Search LLM-generated file summaries (FTS5) |
| `abf_conventions` | Detected naming, structure, pattern, formatting conventions |
| `abf_index` | Index status, rebuild, incremental update |
| `abf_ping` | Health check |

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **ripgrep** — `brew install ripgrep` (macOS) / `apt install ripgrep` (Linux)
- **git** (for git tools & file discovery)
- **Ollama** (optional) — for summaries & semantic search: [ollama.com](https://ollama.com)

### Install & Run

```bash
# Clone
git clone https://github.com/yourname/AgentsBestFriend.git
cd AgentsBestFriend

# Install dependencies
npm install

# Build all packages
npx turbo build

# Check system health
node packages/cli/dist/index.js doctor
```

### Connect to Your Agent

Add ABF as an MCP server in your agent's config:

**VS Code Copilot** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "abf": {
      "command": "node",
      "args": ["/path/to/AgentsBestFriend/packages/cli/dist/index.js", "start"],
      "env": {
        "ABF_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "abf": {
      "command": "node",
      "args": ["/path/to/AgentsBestFriend/packages/cli/dist/index.js", "start"],
      "env": {
        "ABF_PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "abf": {
      "command": "node",
      "args": ["/path/to/AgentsBestFriend/packages/cli/dist/index.js", "start"],
      "env": {
        "ABF_PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

The server auto-initializes an `.abf/` directory with a SQLite index on first tool call.

## CLI

```
abf start        Start MCP server (stdio mode — used by agents)
abf init [path]  Initialize index for a project
abf index [path] Re-index a project
abf status [path] Show index status
abf config       Interactive configuration editor
abf doctor       System health checks
abf portal       Interactive terminal dashboard
```

## Architecture

```
AgentsBestFriend/
├── packages/
│   ├── core/         Shared logic — DB, config, search, analysis, indexer, LLM
│   ├── server/       MCP server with all 11 tools
│   ├── cli/          Commander.js CLI + interactive TUI portal
│   └── portal/       (placeholder — UI logic lives in CLI TUI)
├── turbo.json        Turborepo build config
└── package.json      npm workspaces root
```

### Core Modules

| Module | Purpose |
|---|---|
| `@abf/core/db` | Drizzle ORM + SQLite (WAL mode, FTS5) |
| `@abf/core/config` | Zod-validated config at `~/.abf/config.json` |
| `@abf/core/search` | ripgrep, keyword scoring, semantic (cosine similarity) |
| `@abf/core/analysis` | ts-morph AST parser, regex fallback, conventions detector, project overview |
| `@abf/core/indexer` | File discovery (git ls-files), incremental pipeline, file watcher |
| `@abf/core/llm` | Provider interface, Ollama client, summary/embedding pipelines |
| `@abf/core/git` | Git CLI wrapper (log, blame, diff, history) |

### Database

ABF stores its index in `.abf/index.db` (SQLite) inside each project root:

- **files** — path, hash, language, size, line count, LLM summary
- **symbols** — functions, classes, interfaces, types with hierarchy
- **imports** — import/require edges between files
- **embeddings** — float32 vectors for semantic search
- **file_chunks** — smart chunks aligned to symbol boundaries
- **files_fts** — FTS5 full-text search on summaries

## Optional: LLM Enrichment

With [Ollama](https://ollama.com) running locally, ABF can generate:

1. **File summaries** — 2-3 sentence descriptions of each file (default model: `qwen2.5-coder:1.5b`)
2. **Embeddings** — vector representations for semantic search (default model: `nomic-embed-text`)

```bash
# Install Ollama, then pull models
ollama pull qwen2.5-coder:1.5b
ollama pull nomic-embed-text
```

Without Ollama, all other tools work normally. Semantic search falls back to keyword mode.

## Configuration

Global config lives at `~/.abf/config.json`:

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
    "excludedPatterns": ["*.min.js", "*.min.css", "*.map", "*.lock", "package-lock.json"]
  },
  "search": {
    "defaultMaxResults": 20,
    "ripgrepPath": "rg"
  },
  "portal": {
    "port": 4242
  }
}
```

Edit interactively with `abf config` or `abf portal`.

## Terminal Portal

```bash
abf portal
```

Interactive TUI dashboard powered by [@clack/prompts](https://github.com/bombshell-dev/clack):

- **Dashboard** — system overview, health checks, LLM status, project index stats
- **Project Status** — detailed index info for any project path
- **Re-index** — trigger a full re-index from the menu
- **Configuration** — edit LLM provider, indexing, and other settings
- **Doctor** — health checks for Node.js, ripgrep, git, Ollama

## Tech Stack

- **Runtime:** Node.js ≥ 20, TypeScript (NodeNext)
- **Build:** Turborepo + npm workspaces
- **MCP:** `@modelcontextprotocol/sdk` v1.x
- **Database:** Drizzle ORM + better-sqlite3 (WAL, FTS5)
- **AST:** ts-morph (TypeScript/JavaScript)
- **Search:** ripgrep + custom keyword scorer + cosine similarity
- **CLI:** Commander.js + @clack/prompts
- **LLM:** Ollama (local, optional)

## Development

```bash
# Install
npm install

# Build all
npx turbo build

# Watch mode (rebuild on changes)
npx turbo dev

# Type-check without emitting
npx turbo type-check

# Run tests
npx turbo test
```

## License

MIT
