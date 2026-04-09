import * as clack from "@clack/prompts";
import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { runIndexPipeline } from "@abf/core/indexer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const AGENTS = [
  { value: "cursor", label: "Cursor" },
  { value: "vscode", label: "VS Code / GitHub Copilot" },
  { value: "claude-code", label: "Claude Code" },
  { value: "claude-desktop", label: "Claude Desktop" },
  { value: "codex", label: "Codex" },
  { value: "cline", label: "Cline" },
  { value: "zed", label: "Zed" },
  { value: "gemini-cli", label: "Gemini CLI" },
  { value: "goose", label: "Goose" },
  { value: "opencode", label: "OpenCode" },
] as const;

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

  // --- MCP installation via add-mcp ---
  const installMcp = await clack.confirm({
    message: "Install ABF as an MCP server for your coding agents?",
    initialValue: true,
  });

  if (clack.isCancel(installMcp) || !installMcp) {
    clack.outro(isNew ? "Project initialized!" : "Index rebuilt!");
    return;
  }

  const selectedAgents = await clack.multiselect({
    message: "Which agents should ABF be installed for?",
    options: AGENTS.map((a) => ({
      value: a.value,
      label: a.label,
    })),
    required: true,
  });

  if (clack.isCancel(selectedAgents)) {
    clack.outro(isNew ? "Project initialized!" : "Index rebuilt!");
    return;
  }

  const scope = await clack.select({
    message: "Installation scope?",
    options: [
      {
        value: "global",
        label: "Global",
        hint: "Available across all projects (recommended)",
      },
      {
        value: "project",
        label: "Project",
        hint: "Only this project, committed with your repo",
      },
    ],
  });

  if (clack.isCancel(scope)) {
    clack.outro(isNew ? "Project initialized!" : "Index rebuilt!");
    return;
  }

  const addMcpArgs = ["add-mcp", "abf start", "--name", "abf", "-y"];
  for (const agent of selectedAgents) {
    addMcpArgs.push("-a", agent);
  }
  if (scope === "global") {
    addMcpArgs.push("-g");
  }

  const mcpSpinner = clack.spinner();
  mcpSpinner.start(
    `Installing MCP server for ${(selectedAgents as string[]).join(", ")}...`,
  );

  try {
    await execFileAsync("npx", addMcpArgs, {
      cwd: root,
      timeout: 60_000,
    });
    mcpSpinner.stop("MCP server installed successfully");
    clack.log.info(
      `Agents can now use ABF via the "abf start" command.\nMake sure abf is installed globally: npm install -g @abf/cli`,
    );
  } catch (err) {
    mcpSpinner.stop("MCP installation failed");
    const msg = err instanceof Error ? err.message : String(err);
    clack.log.warn(
      `Could not install MCP server: ${msg}\nYou can install manually: npx add-mcp "abf start" --name abf -y`,
    );
  }

  clack.outro(isNew ? "Project initialized!" : "Index rebuilt!");
}
