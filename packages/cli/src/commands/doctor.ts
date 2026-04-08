import * as clack from "@clack/prompts";
import { loadConfig } from "@abf/core/config";
import { isRipgrepAvailable } from "@abf/core/search";
import { getLlmProvider } from "@abf/core/llm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface Check {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

export async function doctorCommand(): Promise<void> {
  clack.intro("ABF Doctor");

  const checks: Check[] = [];

  const s = clack.spinner();
  s.start("Running health checks...");

  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    name: "Node.js",
    status: major >= 20 ? "ok" : "error",
    message: `${nodeVersion}${major < 20 ? " — requires >= 20" : ""}`,
  });

  // ripgrep
  const rgAvail = await isRipgrepAvailable();
  if (rgAvail) {
    try {
      const { stdout } = await execFileAsync("rg", ["--version"]);
      checks.push({
        name: "ripgrep",
        status: "ok",
        message: stdout.split("\n")[0],
      });
    } catch {
      checks.push({ name: "ripgrep", status: "ok", message: "available" });
    }
  } else {
    checks.push({
      name: "ripgrep",
      status: "error",
      message: "Not found — install: brew install ripgrep",
    });
  }

  // git
  try {
    const { stdout } = await execFileAsync("git", ["--version"]);
    checks.push({ name: "git", status: "ok", message: stdout.trim() });
  } catch {
    checks.push({
      name: "git",
      status: "error",
      message: "Not found in PATH",
    });
  }

  // Ollama
  const config = loadConfig();
  if (config.llm.provider === "ollama") {
    const provider = getLlmProvider();
    if (provider) {
      const available = await provider.isAvailable();
      if (available) {
        const models = await provider.listModels();
        const modelNames = models.map((m) => m.name).join(", ");
        checks.push({
          name: "Ollama",
          status: "ok",
          message: `Connected at ${config.llm.ollama.baseUrl} — models: ${modelNames || "(none)"}`,
        });

        // Check if required models are present
        const hasEmbed = models.some((m) =>
          m.name.startsWith(config.llm.ollama.embeddingModel),
        );
        const hasSummary = models.some((m) =>
          m.name.startsWith(config.llm.ollama.summaryModel),
        );
        if (!hasEmbed) {
          checks.push({
            name: "Embedding model",
            status: "warn",
            message: `${config.llm.ollama.embeddingModel} not found — run: ollama pull ${config.llm.ollama.embeddingModel}`,
          });
        }
        if (!hasSummary) {
          checks.push({
            name: "Summary model",
            status: "warn",
            message: `${config.llm.ollama.summaryModel} not found — run: ollama pull ${config.llm.ollama.summaryModel}`,
          });
        }
      } else {
        checks.push({
          name: "Ollama",
          status: "warn",
          message: `Not reachable at ${config.llm.ollama.baseUrl} — start with: ollama serve`,
        });
      }
    }
  } else {
    checks.push({
      name: "Ollama",
      status: "warn",
      message: "LLM provider set to 'none' — semantic features disabled",
    });
  }

  s.stop("Checks complete");

  // Display results
  for (const check of checks) {
    const icon =
      check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    const method =
      check.status === "ok"
        ? clack.log.success
        : check.status === "warn"
          ? clack.log.warn
          : clack.log.error;
    method(`${icon} ${check.name}: ${check.message}`);
  }

  const errors = checks.filter((c) => c.status === "error");
  const warns = checks.filter((c) => c.status === "warn");

  if (errors.length > 0) {
    clack.outro(`${errors.length} error(s), ${warns.length} warning(s)`);
    process.exit(1);
  } else if (warns.length > 0) {
    clack.outro(`All good with ${warns.length} warning(s)`);
  } else {
    clack.outro("All checks passed!");
  }
}
