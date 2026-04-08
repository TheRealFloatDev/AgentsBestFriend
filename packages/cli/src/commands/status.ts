import * as clack from "@clack/prompts";
import { resolve } from "node:path";
import { getIndexStatus } from "@abf/core/indexer";
import { loadConfig } from "@abf/core/config";

export async function statusCommand(projectPath: string): Promise<void> {
  const root = resolve(projectPath);
  const config = loadConfig();

  clack.intro("ABF Status");

  try {
    const status = await getIndexStatus(root);

    const sizeStr =
      status.indexSizeBytes < 1024 * 1024
        ? `${(status.indexSizeBytes / 1024).toFixed(1)} KB`
        : `${(status.indexSizeBytes / (1024 * 1024)).toFixed(1)} MB`;

    clack.log.info(
      [
        `Project: ${root}`,
        `Indexed files: ${status.indexedFiles} / ${status.totalTrackedFiles}`,
        `Stale files: ${status.staleFiles}`,
        `Index size: ${sizeStr}`,
        `Last updated: ${status.lastUpdated ? status.lastUpdated.toLocaleString() : "never"}`,
        `LLM provider: ${config.llm.provider}`,
      ].join("\n  "),
    );

    clack.outro("OK");
  } catch (error: any) {
    clack.log.error(`Failed to get status: ${error.message}`);
    clack.log.info("Run `abf init` to initialize the project first.");
    process.exit(1);
  }
}
