import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runIndexPipeline, getIndexStatus } from "@abf/core/indexer";
import { generateSummaries } from "@abf/core/llm";

const IndexActionSchema = z.enum(["status", "rebuild", "update", "summarize"]);

export function registerIndexTool(server: McpServer): void {
  server.tool(
    "abf_index",
    "Manage the file index: check status, trigger rebuild, incremental update, or generate LLM summaries (requires Ollama).",
    {
      action: IndexActionSchema.describe(
        "status: show index info, rebuild: full re-index, update: incremental update, summarize: generate LLM file summaries (requires Ollama)",
      ),
    },
    async ({ action }) => {
      const projectRoot = process.env.ABF_PROJECT_ROOT || process.cwd();

      try {
        switch (action) {
          case "status": {
            const status = await getIndexStatus(projectRoot);
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
            const stats = await runIndexPipeline(projectRoot);
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

          case "summarize": {
            const stats = await generateSummaries(projectRoot);
            const text = [
              `Summary generation complete (${stats.durationMs}ms)`,
              `Generated: ${stats.generated}`,
              `Skipped (already have summary): ${stats.skipped}`,
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
