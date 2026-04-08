import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runIndexPipeline, getIndexStatus } from "@abf/core/indexer";

const IndexActionSchema = z.enum(["status", "rebuild", "update"]);

export function registerIndexTool(server: McpServer): void {
  server.tool(
    "abf_index",
    "Manage the file index: check status, trigger rebuild, or incremental update.",
    {
      action: IndexActionSchema.describe(
        "status: show index info, rebuild: full re-index, update: incremental update",
      ),
    },
    async ({ action }) => {
      const cwd = process.cwd();

      try {
        switch (action) {
          case "status": {
            const status = await getIndexStatus(cwd);
            const lastUp = status.lastUpdated
              ? status.lastUpdated.toISOString()
              : "never";
            const sizeMb = (status.indexSizeBytes / (1024 * 1024)).toFixed(2);

            const text = [
              `Indexed files: ${status.indexedFiles}/${status.totalTrackedFiles}`,
              `Stale entries: ${status.staleFiles}`,
              `Last updated: ${lastUp}`,
              `Index size: ${sizeMb} MB`,
            ].join("\n");

            return { content: [{ type: "text" as const, text }] };
          }

          case "rebuild":
          case "update": {
            // Both run the same pipeline — it's always incremental (hash-based)
            const stats = await runIndexPipeline(cwd);
            const text = [
              `Index ${action} complete (${stats.durationMs}ms)`,
              `Discovered: ${stats.totalDiscovered}`,
              `New: ${stats.indexed}`,
              `Updated: ${stats.updated}`,
              `Removed: ${stats.removed}`,
              `Unchanged: ${stats.skipped}`,
              stats.errors > 0 ? `Errors: ${stats.errors}` : null,
            ]
              .filter(Boolean)
              .join("\n");

            return { content: [{ type: "text" as const, text }] };
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Index error: ${msg}` }],
        };
      }
    },
  );
}
