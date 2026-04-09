# agentsbestfriend

Give your AI coding agents superpowers — a local [MCP](https://modelcontextprotocol.io/) server for fast, token-efficient code navigation, search & analysis.

Works with **VS Code Copilot**, **Cursor**, **Claude Code/Desktop**, **Codex**, **Cline**, **Zed**, and any other MCP-compatible agent.

## What it does

AI agents waste tokens re-reading files and searching blindly. ABF gives them purpose-built tools that return exactly what they need:

| Tool | Purpose |
|---|---|
| `abf_search` | Code search — exact (ripgrep), keyword-ranked, or semantic |
| `abf_symbols` | Functions, classes, exports in a file (AST-based) |
| `abf_chunk` | Smart file chunk by symbol name or line range |
| `abf_project_overview` | Tech stack, structure, dependencies at a glance |
| `abf_dependencies` | Import graph — who imports what |
| `abf_impact` | Find all usages of a symbol across the project |
| `abf_git` | Commits, blame, diff (recent/staged/unstaged) |
| `abf_file_summary` | Search LLM-generated file summaries |
| `abf_conventions` | Detected naming & style conventions |
| `abf_index` | Index status & rebuild |
| `abf_ping` | Health check |

## Install

```bash
npm install -g agentsbestfriend
```

### Prerequisites

- **Node.js** ≥ 20
- **ripgrep** — `brew install ripgrep` / `apt install ripgrep`
- **git**
- **Ollama** (optional, for summaries & semantic search) — [ollama.com](https://ollama.com)

## Quick Start

```bash
# Initialize a project (indexes files, optionally installs MCP for your agents)
abf init

# Or initialize a specific path
abf init /path/to/project

# Check everything is working
abf doctor
```

During `abf init`, you'll be asked whether to install ABF as an MCP server for your coding agents. Pick the agents you use (Cursor, VS Code, Claude Code, etc.) and ABF handles the rest via [add-mcp](https://github.com/neondatabase/add-mcp).

### Manual Agent Setup

If you prefer to configure manually, add ABF as a stdio MCP server:

**VS Code / GitHub Copilot** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "abf": {
      "command": "abf",
      "args": ["start"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "abf": {
      "command": "abf",
      "args": ["start"]
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "abf": {
      "command": "abf",
      "args": ["start"]
    }
  }
}
```

## CLI Commands

```
abf start         Start MCP server in stdio mode (used by agents)
abf init [path]   Initialize index & optionally install MCP for agents
abf index [path]  Re-index a project
abf status [path] Show index status
abf config        Interactive configuration editor
abf doctor        System health checks (Node, ripgrep, git, Ollama)
abf portal        Interactive terminal dashboard
```

## How It Works

ABF maintains a lightweight SQLite index (`.abf/index.db`) per project containing:

- **File metadata** — paths, hashes, languages, line counts
- **Symbols** — functions, classes, interfaces, types extracted via AST (ts-morph for TS/JS, regex for Python & others)
- **Imports** — dependency edges between files
- **Summaries** — LLM-generated file descriptions (optional, via Ollama)
- **Embeddings** — vectors for semantic search (optional, via Ollama)

The index updates incrementally — only changed files are re-processed.

## Optional: LLM Enrichment

With [Ollama](https://ollama.com) running locally, ABF can generate file summaries and embeddings for semantic search:

```bash
ollama pull qwen2.5-coder:1.5b    # summaries
ollama pull nomic-embed-text       # embeddings
```

Without Ollama, all tools work normally — semantic search falls back to keyword mode.

## Configuration

Global config at `~/.abf/config.json`. Edit with `abf config` or `abf portal`.

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
    "maxFileSizeKb": 512
  },
  "search": {
    "defaultMaxResults": 20
  }
}
```

## Links

- **GitHub**: [github.com/TheRealFloatDev/AgentsBestFriend](https://github.com/TheRealFloatDev/AgentsBestFriend)
- **Issues**: [github.com/TheRealFloatDev/AgentsBestFriend/issues](https://github.com/TheRealFloatDev/AgentsBestFriend/issues)
- **MCP Spec**: [modelcontextprotocol.io](https://modelcontextprotocol.io)

## License

MIT
