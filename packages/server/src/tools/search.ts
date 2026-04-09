import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ripgrepSearch,
  isRipgrepAvailable,
  keywordSearch,
  semanticSearch,
} from "@abf/core/search";
import { LlmUnavailableError } from "@abf/core/llm";

export function registerSearchTool(server: McpServer): void {
  server.tool(
    "abf_search",
    `Search code in the project using multiple modes:
- "exact": Fast ripgrep-based search for exact strings or regex patterns. Returns matching lines with file path, line number, and surrounding context.
- "keyword": Exploratory search — splits the query into keywords, scores every file by keyword density, returns the top matching files ranked by relevance. Best when you're not sure of exact names.
- "semantic": (Requires Ollama + embeddings index) Embedding-based similarity search. Falls back to keyword mode if unavailable.

Use "exact" when you EXACTLY know what to search for. Use "keyword" when exploring or looking for files related to a concept.`,
    {
      query: z
        .string()
        .describe(
          "Search query — exact text, regex, or space-separated keywords depending on mode",
        ),
      mode: z
        .enum(["exact", "keyword", "semantic"])
        .default("keyword")
        .describe(
          'Search mode: "exact" (ripgrep), "keyword" (file scoring), or "semantic" (embedding similarity)',
        ),
      path_filter: z
        .string()
        .optional()
        .describe('Glob pattern to filter files, e.g. "src/**/*.ts" or "*.py"'),
      max_results: z
        .number()
        .int()
        .positive()
        .optional()
        .default(20)
        .describe("Maximum number of results to return (default: 20)"),
      case_sensitive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Case-sensitive search (exact mode only)"),
      regex: z
        .boolean()
        .optional()
        .default(false)
        .describe("Treat query as regex pattern (exact mode only)"),
    },
    async ({
      query,
      mode,
      path_filter,
      max_results,
      case_sensitive,
      regex,
    }) => {
      const projectRoot = process.env.ABF_PROJECT_ROOT || process.cwd();

      try {
        if (mode === "exact") {
          return await handleExactSearch({
            query,
            projectRoot,
            pathFilter: path_filter,
            maxResults: max_results,
            caseSensitive: case_sensitive,
            regex,
          });
        }

        if (mode === "keyword") {
          return await handleKeywordSearch({
            query,
            projectRoot,
            pathFilter: path_filter,
            maxResults: max_results,
          });
        }

        if (mode === "semantic") {
          try {
            return await handleSemanticSearch({
              query,
              projectRoot,
              maxResults: max_results,
            });
          } catch (error: any) {
            if (error instanceof LlmUnavailableError) {
              // Fall back to keyword search when LLM is unavailable
              const result = await handleKeywordSearch({
                query,
                projectRoot,
                pathFilter: path_filter,
                maxResults: max_results,
              });

              return {
                content: [
                  {
                    type: "text",
                    text: `[Semantic search unavailable: ${error.message}. Using keyword fallback.]\n\n${result.content[0].type === "text" ? result.content[0].text : ""}`,
                  },
                ],
              };
            }
            throw error;
          }
        }

        return {
          content: [{ type: "text", text: `Unknown search mode: ${mode}` }],
          isError: true,
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Search error: ${error.message ?? String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

async function handleExactSearch(opts: {
  query: string;
  projectRoot: string;
  pathFilter?: string;
  maxResults: number;
  caseSensitive: boolean;
  regex: boolean;
}) {
  const rgAvailable = await isRipgrepAvailable();
  if (!rgAvailable) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Error: ripgrep (rg) is not installed or not found in PATH. Install it via: brew install ripgrep (macOS), apt install ripgrep (Linux), or choco install ripgrep (Windows).",
        },
      ],
      isError: true,
    };
  }

  const result = await ripgrepSearch({
    query: opts.query,
    cwd: opts.projectRoot,
    pathFilter: opts.pathFilter,
    maxResults: opts.maxResults,
    caseSensitive: opts.caseSensitive,
    regex: opts.regex,
  });

  if (result.matches.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No matches found for "${opts.query}"${opts.pathFilter ? ` in ${opts.pathFilter}` : ""}`,
        },
      ],
    };
  }

  // Format results in a compact, token-efficient way
  const lines: string[] = [
    `Found ${result.totalMatches} matches${result.truncated ? ` (showing top ${result.matches.length})` : ""}:`,
    "",
  ];

  let currentFile = "";
  for (const match of result.matches) {
    if (match.filePath !== currentFile) {
      if (currentFile) lines.push("");
      lines.push(`── ${match.filePath} ──`);
      currentFile = match.filePath;
    }

    // Show context before
    for (const ctx of match.contextBefore) {
      lines.push(`  ${ctx}`);
    }

    // The match line with marker
    lines.push(`▶ L${match.lineNumber}: ${match.lineText.trimEnd()}`);

    // Show context after
    for (const ctx of match.contextAfter) {
      lines.push(`  ${ctx}`);
    }
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}

async function handleKeywordSearch(opts: {
  query: string;
  projectRoot: string;
  pathFilter?: string;
  maxResults: number;
}) {
  const result = await keywordSearch({
    query: opts.query,
    cwd: opts.projectRoot,
    pathFilter: opts.pathFilter,
    maxResults: opts.maxResults,
  });

  if (result.matches.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No files matching keywords [${result.keywords.join(", ")}]${opts.pathFilter ? ` in ${opts.pathFilter}` : ""}. Scanned ${result.totalFilesScanned} files.`,
        },
      ],
    };
  }

  const lines: string[] = [
    `Keywords: [${result.keywords.join(", ")}]`,
    `Top ${result.matches.length} files (scanned ${result.totalFilesScanned}):`,
    "",
  ];

  for (const match of result.matches) {
    lines.push(
      `── ${match.filePath} (score: ${match.score}, hits: ${match.totalHits}) ──`,
    );

    // Show keyword breakdown
    const hitSummary = Object.entries(match.keywordHits)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
    lines.push(`  Keywords: ${hitSummary}`);

    // Show top matching lines
    if (match.topLines.length > 0) {
      for (const tl of match.topLines.slice(0, 3)) {
        lines.push(`  L${tl.line}: ${tl.text}`);
      }
    }
    lines.push("");
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}

async function handleSemanticSearch(opts: {
  query: string;
  projectRoot: string;
  maxResults: number;
}) {
  const result = await semanticSearch({
    query: opts.query,
    cwd: opts.projectRoot,
    maxResults: opts.maxResults,
  });

  if (result.matches.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No semantically similar files found for "${opts.query}". Make sure embeddings have been generated (requires Ollama).`,
        },
      ],
    };
  }

  const lines: string[] = [
    `Semantic search: ${result.matches.length} results (embed: ${result.queryEmbeddingMs}ms, search: ${result.searchMs}ms):`,
    "",
  ];

  for (const match of result.matches) {
    const scoreStr = (match.score * 100).toFixed(1);
    lines.push(
      `── ${match.filePath} (${scoreStr}% similar, ${match.language ?? "unknown"}) ──`,
    );
    if (match.summary) {
      lines.push(`  ${match.summary}`);
    }
    lines.push("");
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
