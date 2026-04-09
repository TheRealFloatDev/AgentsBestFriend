import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runIndexPipeline, getIndexStatus } from "@abf/core/indexer";
import {
  generateSummaries,
  generateEmbeddings,
  getLlmProvider,
} from "@abf/core/llm";

const IndexActionSchema = z.enum(["status", "rebuild", "update", "summarize"]);

export function registerIndexTool(server: McpServer): void {
  server.tool(
    "abf_index",
    "Manage the file index: check status, trigger rebuild, incremental update, or generate LLM summaries. Rebuild/update will auto-generate summaries when Ollama is available.",
    {
      action: IndexActionSchema.describe(
        "status: show index info, rebuild: full re-index, update: incremental update, summarize: (re)generate LLM file summaries (requires Ollama)",
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
            const textParts = [
              `Index ${action} complete (${stats.durationMs}ms)`,
              `Discovered: ${stats.totalDiscovered}`,
              `New: ${stats.indexed}`,
              `Updated: ${stats.updated}`,
              `Removed: ${stats.removed}`,
              `Unchanged: ${stats.skipped}`,
              stats.errors > 0 ? `Errors: ${stats.errors}` : null,
            ].filter(Boolean);

            // Auto-generate summaries + embeddings if Ollama is available
            const provider = getLlmProvider();
            if (provider && (await provider.isAvailable())) {
              try {
                const sumStats = await generateSummaries(projectRoot);
                textParts.push(
                  "",
                  `LLM summaries: ${sumStats.generated} generated, ${sumStats.skipped} skipped${sumStats.errors > 0 ? `, ${sumStats.errors} errors` : ""} (${sumStats.durationMs}ms)`,
                );
              } catch {
                textParts.push("", "LLM summaries: skipped (Ollama error)");
              }

              try {
                const embStats = await generateEmbeddings(projectRoot);
                textParts.push(
                  `Embeddings: ${embStats.generated} generated, ${embStats.skipped} skipped${embStats.errors > 0 ? `, ${embStats.errors} errors` : ""} (${embStats.durationMs}ms)`,
                );
              } catch {
                textParts.push("Embeddings: skipped (Ollama error)");
              }
            }

            return {
              content: [{ type: "text" as const, text: textParts.join("\n") }],
            };
          }

          case "summarize": {
            const sumStats = await generateSummaries(projectRoot);
            const embStats = await generateEmbeddings(projectRoot);
            const text = [
              `Summary generation complete (${sumStats.durationMs}ms)`,
              `  Generated: ${sumStats.generated}`,
              `  Skipped: ${sumStats.skipped}`,
              sumStats.errors > 0 ? `  Errors: ${sumStats.errors}` : null,
              "",
              `Embedding generation complete (${embStats.durationMs}ms)`,
              `  Generated: ${embStats.generated}`,
              `  Skipped: ${embStats.skipped}`,
              embStats.errors > 0 ? `  Errors: ${embStats.errors}` : null,
            ]
              .filter((l) => l !== null)
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
