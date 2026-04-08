import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

/**
 * Compute SHA-256 hash of a file's content.
 */
export function hashFileContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Compute SHA-256 hash of a file by path.
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return hashFileContent(content);
}

/**
 * Detect programming language from file extension.
 */
export function detectLanguage(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".pyi": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".swift": "swift",
    ".rb": "ruby",
    ".php": "php",
    ".lua": "lua",
    ".r": "r",
    ".R": "r",
    ".scala": "scala",
    ".dart": "dart",
    ".zig": "zig",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".hrl": "erlang",
    ".hs": "haskell",
    ".ml": "ocaml",
    ".mli": "ocaml",
    ".clj": "clojure",
    ".cljs": "clojure",
    ".vue": "vue",
    ".svelte": "svelte",
    ".astro": "astro",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".xml": "xml",
    ".md": "markdown",
    ".mdx": "markdown",
    ".sql": "sql",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".fish": "shell",
    ".ps1": "powershell",
    ".dockerfile": "dockerfile",
    ".tf": "terraform",
    ".hcl": "hcl",
    ".proto": "protobuf",
    ".graphql": "graphql",
    ".gql": "graphql",
  };

  return languageMap[ext] ?? null;
}

/**
 * Count the number of lines in a string.
 */
export function countLines(content: string): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") count++;
  }
  return count;
}

/**
 * Check if a file is likely binary by examining the first chunk of bytes.
 */
export function isBinaryFile(filePath: string): boolean {
  try {
    const buffer = Buffer.alloc(8192);
    const fd = require("node:fs").openSync(filePath, "r");
    const bytesRead = require("node:fs").readSync(fd, buffer, 0, 8192, 0);
    require("node:fs").closeSync(fd);

    // Check for null bytes in the first chunk
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}
