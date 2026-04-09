import * as clack from "@clack/prompts";
import { resolve } from "node:path";
import { loadConfig, updateConfig, getConfigPath } from "@abf/core/config";
import { getIndexStatus, runIndexPipeline } from "@abf/core/indexer";
import { isRipgrepAvailable } from "@abf/core/search";
import {
  getLlmProvider,
  generateSummaries,
  generateEmbeddings,
} from "@abf/core/llm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function portalCommand(): Promise<void> {
  clack.intro("AgentsBestFriend — Terminal Portal");

  // Main loop
  while (true) {
    const action = await clack.select({
      message: "What would you like to do?",
      options: [
        {
          value: "dashboard",
          label: "📊  Dashboard",
          hint: "Health checks & system overview",
        },
        {
          value: "status",
          label: "📁  Project Status",
          hint: "Index stats for current project",
        },
        {
          value: "index",
          label: "🔄  Re-index Project",
          hint: "Rebuild index for current project",
        },
        {
          value: "config",
          label: "⚙️   Configuration",
          hint: "View & edit settings",
        },
        { value: "doctor", label: "🩺  Doctor", hint: "System health checks" },
        { value: "quit", label: "👋  Quit" },
      ],
    });

    if (clack.isCancel(action) || action === "quit") {
      clack.outro("Bye!");
      return;
    }

    if (action === "dashboard") await showDashboard();
    if (action === "status") await showStatus();
    if (action === "index") await reindex();
    if (action === "config") await editConfig();
    if (action === "doctor") await runDoctor();

    console.log(); // breathing room between sections
  }
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

async function showDashboard(): Promise<void> {
  const s = clack.spinner();
  s.start("Gathering system info...");

  const config = loadConfig();
  const lines: string[] = [];

  // Node
  lines.push(`Node.js      ${process.version}`);

  // ripgrep
  const rgOk = await isRipgrepAvailable();
  lines.push(`ripgrep      ${rgOk ? "✓ available" : "✗ not found"}`);

  // git
  try {
    const { stdout } = await execFileAsync("git", ["--version"]);
    lines.push(`git          ${stdout.trim()}`);
  } catch {
    lines.push(`git          ✗ not found`);
  }

  // Ollama
  if (config.llm.provider === "ollama") {
    const provider = getLlmProvider();
    const available = provider ? await provider.isAvailable() : false;
    if (available && provider) {
      const models = await provider.listModels();
      lines.push(`Ollama       ✓ connected at ${config.llm.ollama.baseUrl}`);
      lines.push(
        `  Models     ${models.map((m) => m.name).join(", ") || "(none)"}`,
      );
      lines.push(`  Summary    ${config.llm.ollama.summaryModel}`);
      lines.push(`  Embedding  ${config.llm.ollama.embeddingModel}`);
    } else {
      lines.push(
        `Ollama       ⚠ not reachable at ${config.llm.ollama.baseUrl}`,
      );
    }
  } else {
    lines.push(`LLM          disabled (provider: none)`);
  }

  // Project status (cwd)
  try {
    const status = await getIndexStatus(process.cwd());
    const sizeStr =
      status.indexSizeBytes < 1024 * 1024
        ? `${(status.indexSizeBytes / 1024).toFixed(1)} KB`
        : `${(status.indexSizeBytes / (1024 * 1024)).toFixed(1)} MB`;
    lines.push(``);
    lines.push(`── Current Project ──`);
    lines.push(`  Path       ${process.cwd()}`);
    lines.push(
      `  Indexed    ${status.indexedFiles} / ${status.totalTrackedFiles} files`,
    );
    lines.push(`  Stale      ${status.staleFiles}`);
    lines.push(`  DB size    ${sizeStr}`);
    lines.push(
      `  Updated    ${status.lastUpdated ? status.lastUpdated.toLocaleString() : "never"}`,
    );
  } catch {
    lines.push(``);
    lines.push(`── Current Project ──`);
    lines.push(`  Not initialized — run \`abf init\``);
  }

  s.stop("System Overview");
  clack.log.info(lines.join("\n  "));
}

// ─── Project Status ────────────────────────────────────────────────────────

async function showStatus(): Promise<void> {
  const projectPath = await clack.text({
    message: "Project path:",
    initialValue: process.cwd(),
  });
  if (clack.isCancel(projectPath)) return;

  const root = resolve(projectPath as string);
  const s = clack.spinner();
  s.start("Loading index status...");

  try {
    const status = await getIndexStatus(root);
    const sizeStr =
      status.indexSizeBytes < 1024 * 1024
        ? `${(status.indexSizeBytes / 1024).toFixed(1)} KB`
        : `${(status.indexSizeBytes / (1024 * 1024)).toFixed(1)} MB`;

    s.stop("Index Status");
    clack.log.info(
      [
        `Project:       ${root}`,
        `Indexed files: ${status.indexedFiles} / ${status.totalTrackedFiles}`,
        `Stale files:   ${status.staleFiles}`,
        `Index size:    ${sizeStr}`,
        `Last updated:  ${status.lastUpdated ? status.lastUpdated.toLocaleString() : "never"}`,
      ].join("\n  "),
    );
  } catch (error: any) {
    s.stop("Error");
    clack.log.error(error.message);
    clack.log.info("Run `abf init` to initialize the project first.");
  }
}

// ─── Re-index ──────────────────────────────────────────────────────────────

async function reindex(): Promise<void> {
  const projectPath = await clack.text({
    message: "Project path:",
    initialValue: process.cwd(),
  });
  if (clack.isCancel(projectPath)) return;

  const root = resolve(projectPath as string);
  const s = clack.spinner();
  s.start("Indexing...");

  try {
    const stats = await runIndexPipeline(root);
    s.stop("Indexing complete");
    clack.log.info(
      [
        `Discovered: ${stats.totalDiscovered}`,
        `New: ${stats.indexed}  |  Updated: ${stats.updated}  |  Unchanged: ${stats.skipped}`,
        `Removed: ${stats.removed}  |  Errors: ${stats.errors}`,
        `Time: ${stats.durationMs}ms`,
      ].join("\n  "),
    );

    // LLM enrichment (summaries + embeddings)
    const provider = getLlmProvider();
    if (provider && (await provider.isAvailable())) {
      const llmSpinner = clack.spinner();
      llmSpinner.start("Generating LLM summaries...");
      try {
        const sumStats = await generateSummaries(root);
        llmSpinner.stop(
          `Summaries: ${sumStats.generated} generated, ${sumStats.skipped} skipped (${sumStats.durationMs}ms)`,
        );
      } catch (err: any) {
        llmSpinner.stop(`Summary generation failed: ${err.message ?? err}`);
      }

      const embSpinner = clack.spinner();
      embSpinner.start("Generating embeddings...");
      try {
        const embStats = await generateEmbeddings(root);
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
      clack.log.info("LLM enrichment skipped (Ollama not available).");
    }
  } catch (error: any) {
    s.stop("Error");
    clack.log.error(error.message);
  }
}

// ─── Config Editor ─────────────────────────────────────────────────────────

async function editConfig(): Promise<void> {
  const config = loadConfig();
  clack.log.info(`Config: ${getConfigPath()}`);

  const section = await clack.select({
    message: "Edit section:",
    options: [
      { value: "view", label: "View current config" },
      { value: "llm", label: "LLM provider" },
      { value: "indexing", label: "Indexing settings" },
      { value: "back", label: "← Back" },
    ],
  });
  if (clack.isCancel(section) || section === "back") return;

  if (section === "view") {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (section === "llm") {
    const provider = await clack.select({
      message: "LLM provider:",
      options: [
        { value: "ollama", label: "Ollama (local)", hint: "Recommended" },
        { value: "none", label: "None", hint: "Disable semantic features" },
      ],
      initialValue: config.llm.provider,
    });
    if (clack.isCancel(provider)) return;

    if (provider === "ollama") {
      const baseUrl = await clack.text({
        message: "Ollama base URL:",
        initialValue: config.llm.ollama.baseUrl,
        validate: (v) => {
          try {
            new URL(v ?? "");
          } catch {
            return "Must be a valid URL";
          }
        },
      });
      if (clack.isCancel(baseUrl)) return;

      const summaryModel = await clack.text({
        message: "Summary model:",
        initialValue: config.llm.ollama.summaryModel,
      });
      if (clack.isCancel(summaryModel)) return;

      const embeddingModel = await clack.text({
        message: "Embedding model:",
        initialValue: config.llm.ollama.embeddingModel,
      });
      if (clack.isCancel(embeddingModel)) return;

      updateConfig({
        llm: {
          provider: "ollama",
          ollama: {
            baseUrl: baseUrl as string,
            summaryModel: summaryModel as string,
            embeddingModel: embeddingModel as string,
          },
        },
      });
    } else {
      updateConfig({ llm: { provider: "none", ollama: config.llm.ollama } });
    }
    clack.log.success("LLM config saved");
  }

  if (section === "indexing") {
    const maxSize = await clack.text({
      message: "Max file size (KB):",
      initialValue: String(config.indexing.maxFileSizeKb),
      validate: (v) => {
        const n = parseInt(v ?? "", 10);
        if (isNaN(n) || n < 1) return "Must be a positive number";
      },
    });
    if (clack.isCancel(maxSize)) return;

    updateConfig({
      indexing: {
        ...config.indexing,
        maxFileSizeKb: parseInt(maxSize as string, 10),
      },
    });
    clack.log.success("Indexing config saved");
  }
}

// ─── Doctor ────────────────────────────────────────────────────────────────

async function runDoctor(): Promise<void> {
  const s = clack.spinner();
  s.start("Running health checks...");

  const config = loadConfig();
  const checks: Array<{ icon: string; text: string }> = [];

  // Node.js
  const major = parseInt(process.version.slice(1), 10);
  checks.push({
    icon: major >= 20 ? "✓" : "✗",
    text: `Node.js ${process.version}${major < 20 ? " (need >= 20)" : ""}`,
  });

  // ripgrep
  const rgOk = await isRipgrepAvailable();
  if (rgOk) {
    try {
      const { stdout } = await execFileAsync("rg", ["--version"]);
      checks.push({ icon: "✓", text: stdout.split("\n")[0] });
    } catch {
      checks.push({ icon: "✓", text: "ripgrep available" });
    }
  } else {
    checks.push({
      icon: "✗",
      text: "ripgrep not found — brew install ripgrep",
    });
  }

  // git
  try {
    const { stdout } = await execFileAsync("git", ["--version"]);
    checks.push({ icon: "✓", text: stdout.trim() });
  } catch {
    checks.push({ icon: "✗", text: "git not found" });
  }

  // Ollama
  if (config.llm.provider === "ollama") {
    const provider = getLlmProvider();
    const available = provider ? await provider.isAvailable() : false;
    if (available) {
      checks.push({
        icon: "✓",
        text: `Ollama connected at ${config.llm.ollama.baseUrl}`,
      });
    } else {
      checks.push({
        icon: "⚠",
        text: `Ollama not reachable at ${config.llm.ollama.baseUrl}`,
      });
    }
  } else {
    checks.push({ icon: "⚠", text: "LLM provider set to 'none'" });
  }

  s.stop("Health Checks");
  clack.log.info(checks.map((c) => `${c.icon} ${c.text}`).join("\n  "));
}
