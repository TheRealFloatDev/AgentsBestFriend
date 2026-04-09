import * as clack from "@clack/prompts";
import { resolve, dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runIndexPipeline } from "@abf/core/indexer";
import {
  getLlmProvider,
  generateSummaries,
  generateEmbeddings,
} from "@abf/core/llm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const AGENTS = [
  { value: "cursor", label: "Cursor", skillAgent: "cursor" },
  {
    value: "vscode",
    label: "VS Code / GitHub Copilot",
    skillAgent: "github-copilot",
  },
  { value: "claude-code", label: "Claude Code", skillAgent: "claude-code" },
  { value: "claude-desktop", label: "Claude Desktop", skillAgent: undefined },
  { value: "codex", label: "Codex", skillAgent: "codex" },
  { value: "cline", label: "Cline", skillAgent: "cline" },
  { value: "zed", label: "Zed", skillAgent: undefined },
  { value: "gemini-cli", label: "Gemini CLI", skillAgent: "gemini-cli" },
  { value: "goose", label: "Goose", skillAgent: "goose" },
  { value: "opencode", label: "OpenCode", skillAgent: "opencode" },
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

  // --- Add .abf/ to .gitignore ---
  const gitignorePath = resolve(root, ".gitignore");
  const gitignoreExists = existsSync(gitignorePath);
  const alreadyIgnored =
    gitignoreExists &&
    readFileSync(gitignorePath, "utf-8")
      .split("\n")
      .some((line) => line.trim() === ".abf" || line.trim() === ".abf/");

  if (!alreadyIgnored) {
    const addToGitignore = await clack.confirm({
      message: "Add .abf/ to .gitignore?",
      initialValue: true,
    });

    if (!clack.isCancel(addToGitignore) && addToGitignore) {
      const block = `${gitignoreExists ? "\n" : ""}# AgentsBestFriend (MCP) local index\n.abf/\n`;
      appendFileSync(gitignorePath, block, "utf-8");
      clack.log.info(".abf/ added to .gitignore");
    }
  }

  const s = clack.spinner();
  s.start("Running initial index...");

  let stats;
  try {
    stats = await runIndexPipeline(root);
  } catch (err) {
    s.stop("Indexing failed");
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    clack.log.error(msg);
    process.exit(1);
  }
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

  // --- LLM enrichment (summaries + embeddings) ---
  const provider = getLlmProvider();
  if (provider && (await provider.isAvailable())) {
    const llmSpinner = clack.spinner();
    llmSpinner.start("Generating LLM summaries...");
    try {
      const sumStats = await generateSummaries(root, {
        onProgress: (done, total) =>
          llmSpinner.message(`Generating LLM summaries... (${done}/${total})`),
      });
      llmSpinner.stop(
        `Summaries: ${sumStats.generated} generated, ${sumStats.skipped} skipped (${sumStats.durationMs}ms)`,
      );
    } catch (err: any) {
      llmSpinner.stop(`Summary generation failed: ${err.message ?? err}`);
    }

    const embSpinner = clack.spinner();
    embSpinner.start("Generating embeddings...");
    try {
      const embStats = await generateEmbeddings(root, {
        onProgress: (done, total) =>
          embSpinner.message(`Generating embeddings... (${done}/${total})`),
      });
      embSpinner.stop(
        `Embeddings: ${embStats.generated} generated, ${embStats.skipped} skipped (${embStats.durationMs}ms)`,
      );
    } catch (err: any) {
      embSpinner.stop(`Embedding generation failed: ${err.message ?? err}`);
      clack.log.warn(
        "Make sure the embedding model is pulled: ollama pull nomic-embed-text",
      );
    }
  } else {
    clack.log.info(
      "LLM enrichment skipped (Ollama not available). Run `abf index --summarize` later.",
    );
  }

  // --- Install ABF skill ---
  await installSkill(root);

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

  const mcpSource = await clack.select({
    message: "How should agents run ABF?",
    options: [
      {
        value: "npx",
        label: "npx (recommended)",
        hint: "Always uses the latest version via npx agentsbestfriend start",
      },
      {
        value: "local",
        label: "Local install",
        hint: "Uses your locally installed abf binary",
      },
    ],
  });

  if (clack.isCancel(mcpSource)) {
    clack.outro(isNew ? "Project initialized!" : "Index rebuilt!");
    return;
  }

  const mcpCommand =
    mcpSource === "npx" ? "npx -y agentsbestfriend start" : "abf start";

  const addMcpArgs = ["add-mcp", mcpCommand, "--name", "abf", "-y"];
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
    if (mcpSource === "npx") {
      clack.log.info(
        `Agents will use ABF via "npx agentsbestfriend start" (always latest version).`,
      );
    } else {
      clack.log.info(
        `Agents will use ABF via "abf start".\nMake sure abf is installed globally: npm install -g agentsbestfriend`,
      );
    }
  } catch (err) {
    mcpSpinner.stop("MCP installation failed");
    const msg = err instanceof Error ? err.message : String(err);
    clack.log.warn(
      `Could not install MCP server: ${msg}\nYou can install manually: npx add-mcp "${mcpCommand}" --name abf -y`,
    );
  }

  clack.outro(isNew ? "Project initialized!" : "Index rebuilt!");
}

// ─── Skill Installation via `npx skills add` ────────────────────────────────

function getSkillDir(): string | null {
  // The skills asset ships at <package>/assets/skills/ (sibling to dist/)
  const candidates = [
    // Installed via npm/npx — assets is sibling to dist/
    join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "skills"),
    // Monorepo dev — two levels up from dist/
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "assets",
      "skills",
    ),
  ];

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(join(resolved, "abf", "SKILL.md"))) return resolved;
  }

  return null;
}

async function installSkill(projectRoot: string): Promise<void> {
  const doInstall = await clack.confirm({
    message:
      "Install ABF workflow skill? (Helps agents prefer ABF tools over native read_file/grep)",
    initialValue: true,
  });

  if (clack.isCancel(doInstall) || !doInstall) return;

  const skillDir = getSkillDir();
  if (!skillDir) {
    clack.log.warn("Could not find bundled skill asset — skipping.");
    return;
  }

  // All or pick specific agents
  const agentChoice = await clack.select({
    message: "Install skill for which agents?",
    options: [
      {
        value: "all",
        label: "All detected agents",
        hint: "Auto-detects installed agents",
      },
      {
        value: "pick",
        label: "Let me pick",
      },
    ],
  });

  if (clack.isCancel(agentChoice)) return;

  let skillAgentArgs: string[] = [];

  if (agentChoice === "pick") {
    const skillAgents = AGENTS.filter((a) => a.skillAgent);
    const selected = await clack.multiselect({
      message: "Which agents should get the ABF skill?",
      options: skillAgents.map((a) => ({
        value: a.skillAgent!,
        label: a.label,
      })),
      required: true,
    });

    if (clack.isCancel(selected)) return;

    for (const agent of selected) {
      skillAgentArgs.push("-a", agent);
    }
  }

  const scope = await clack.select({
    message: "Skill installation scope?",
    options: [
      {
        value: "project",
        label: "Project (default)",
        hint: "Committed with your repo, shared with team",
      },
      {
        value: "global",
        label: "Global",
        hint: "Available across all projects",
      },
    ],
  });

  if (clack.isCancel(scope)) return;

  const skillArgs = [
    "skills",
    "add",
    skillDir,
    "--skill",
    "abf",
    "--copy",
    "-y",
  ];
  if (agentChoice === "all") {
    skillArgs.push("--all");
  } else {
    skillArgs.push(...skillAgentArgs);
  }
  if (scope === "global") {
    skillArgs.push("-g");
  }

  const skillSpinner = clack.spinner();
  skillSpinner.start("Installing ABF skill...");

  try {
    await execFileAsync("npx", skillArgs, {
      cwd: projectRoot,
      timeout: 60_000,
    });
    skillSpinner.stop("ABF skill installed successfully");
  } catch (err) {
    skillSpinner.stop("Skill installation failed");
    const msg = err instanceof Error ? err.message : String(err);
    clack.log.warn(
      `Could not install skill: ${msg}\nYou can install manually: npx skills add ${skillDir} --skill abf --copy -y`,
    );
  }
}
