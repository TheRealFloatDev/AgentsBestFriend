import * as clack from "@clack/prompts";
import { resolve } from "node:path";
import { runIndexPipeline } from "@abf/core/indexer";

export async function indexCommand(projectPath: string): Promise<void> {
  const root = resolve(projectPath);

  clack.intro("ABF Index");

  const s = clack.spinner();
  s.start("Indexing project...");

  const stats = await runIndexPipeline(root);
  s.stop("Done");

  clack.log.info(
    [
      `Discovered: ${stats.totalDiscovered}`,
      `New: ${stats.indexed}`,
      `Updated: ${stats.updated}`,
      `Unchanged: ${stats.skipped}`,
      `Removed: ${stats.removed}`,
      stats.errors > 0 ? `Errors: ${stats.errors}` : "",
      `Time: ${stats.durationMs}ms`,
    ]
      .filter(Boolean)
      .join("  |  "),
  );

  clack.outro("Index updated");
}
