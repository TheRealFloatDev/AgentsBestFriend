import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createProjectDb, closeDb } from "@abf/core/db";
import { sql } from "drizzle-orm";
import { files } from "@abf/core/db";

export function registerFileSummaryTool(server: McpServer): void {
  server.tool(
    "abf_file_summary",
    `Search across LLM-generated file summaries using full-text search.
Returns files whose summaries match the query, ranked by relevance.
Useful when exploring a codebase by concept rather than exact code text.
Requires summaries to be generated first (run abf_index with summarize=true, or abf enrichment).`,
    {
      query: z
        .string()
        .describe(
          "Search query — keywords to match against file summaries (FTS5 syntax supported)",
        ),
      max_results: z
        .number()
        .int()
        .positive()
        .optional()
        .default(10)
        .describe("Maximum number of results (default: 10)"),
      path_filter: z
        .string()
        .optional()
        .describe(
          'Optional prefix filter for file paths, e.g. "src/" or "packages/core"',
        ),
    },
    async ({ query, max_results, path_filter }) => {
      const projectRoot = process.env.ABF_PROJECT_ROOT || process.cwd();

      try {
        const db = createProjectDb(projectRoot);

        try {
          // Use FTS5 MATCH for full-text search on summaries
          // bm25() returns negative values (more negative = more relevant)
          let sqlQuery = sql`
            SELECT
              f.path,
              f.summary,
              f.language,
              f.size_bytes,
              bm25(files_fts) AS rank
            FROM files_fts
            JOIN files f ON files_fts.rowid = f.id
            WHERE files_fts MATCH ${query}
          `;

          if (path_filter) {
            sqlQuery = sql`
              SELECT
                f.path,
                f.summary,
                f.language,
                f.size_bytes,
                bm25(files_fts) AS rank
              FROM files_fts
              JOIN files f ON files_fts.rowid = f.id
              WHERE files_fts MATCH ${query}
                AND f.path LIKE ${path_filter + "%"}
            `;
          }

          sqlQuery = sql`${sqlQuery} ORDER BY rank LIMIT ${max_results}`;

          const rows = db.all<{
            path: string;
            summary: string | null;
            language: string | null;
            size_bytes: number;
            rank: number;
          }>(sqlQuery);

          if (rows.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No file summaries matching "${query}"${path_filter ? ` in ${path_filter}` : ""}. Make sure summaries have been generated (requires Ollama).`,
                },
              ],
            };
          }

          const lines: string[] = [
            `Found ${rows.length} file(s) matching "${query}":`,
            "",
          ];

          for (const row of rows) {
            lines.push(
              `── ${row.path} (${row.language ?? "unknown"}, ${formatBytes(row.size_bytes)}) ──`,
            );
            if (row.summary) {
              lines.push(`  ${row.summary}`);
            }
            lines.push("");
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        } finally {
          closeDb(db);
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `File summary search error: ${error.message ?? String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
