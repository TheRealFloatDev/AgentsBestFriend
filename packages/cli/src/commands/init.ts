import * as clack from "@clack/prompts";
import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { runIndexPipeline } from "@abf/core/indexer";

export async function initCommand(projectPath: string): Promise<void> {
  const root = resolve(projectPath);

  clack.intro("ABF Init");

  if (!existsSync(root)) {
    clack.log.error(`Path does not exist: ${root}`);
    process.exit(1);
  }

  const abfDir = resolve(root, ".abf");
  const isNew = !existsSync(abfDir);

  if (isNew) {
    mkdirSync(abfDir, { recursive: true });
    clack.log.info(`Created ${abfDir}`);
  } else {
    clack.log.info(`ABF directory already exists at ${abfDir}`);
  }

  const s = clack.spinner();
  s.start("Running initial index...");

  const stats = await runIndexPipeline(root);
  s.stop("Indexing complete");

  clack.log.info(
    [
      `Files discovered: ${stats.totalDiscovered}`,
      `Indexed (new): ${stats.indexed}`,
      `Updated: ${stats.updated}`,
      `Skipped (unchanged): ${stats.skipped}`,
      `Removed (stale): ${stats.removed}`,
      stats.errors > 0 ? `Errors: ${stats.errors}` : "",
      `Duration: ${stats.durationMs}ms`,
    ]
      .filter(Boolean)
      .join("\n  "),
  );

  clack.outro(isNew ? "Project initialized!" : "Index rebuilt!");
}
