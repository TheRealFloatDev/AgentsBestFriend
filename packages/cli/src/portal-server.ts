import express from "express";
import { join, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  saveConfig,
  updateConfig,
  type AbfConfig,
} from "@abf/core/config";
import { getIndexStatus, runIndexPipeline } from "@abf/core/indexer";
import { getLlmProvider } from "@abf/core/llm";
import { isRipgrepAvailable } from "@abf/core/search";

const DEFAULT_PORT = 4242;

/**
 * Start the portal backend (Express) serving the React frontend + REST API.
 */
export async function startPortalServer(
  port = DEFAULT_PORT,
): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());

  // ─── API Routes ──────────────────────────────────────────────────────────

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, version: "0.1.0" });
  });

  // Config
  app.get("/api/config", (_req, res) => {
    try {
      const config = loadConfig();
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/config", (req, res) => {
    try {
      const updated = updateConfig(req.body as Partial<AbfConfig>);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Index status for a project
  app.get("/api/projects/:encodedPath/status", async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.encodedPath);
      const status = await getIndexStatus(projectPath);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger index rebuild
  app.post("/api/projects/:encodedPath/index", async (req, res) => {
    try {
      const projectPath = decodeURIComponent(req.params.encodedPath);
      const stats = await runIndexPipeline(projectPath);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // LLM provider status
  app.get("/api/llm/status", async (_req, res) => {
    try {
      const config = loadConfig();
      const provider = getLlmProvider();

      if (!provider) {
        res.json({
          provider: "none",
          available: false,
          models: [],
        });
        return;
      }

      const available = await provider.isAvailable();
      let models: Array<{ name: string; size: number }> = [];
      if (available) {
        try {
          models = await provider.listModels();
        } catch {
          /* ignore */
        }
      }

      res.json({
        provider: config.llm.provider,
        available,
        baseUrl: config.llm.ollama.baseUrl,
        summaryModel: config.llm.ollama.summaryModel,
        embeddingModel: config.llm.ollama.embeddingModel,
        models,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Doctor / health checks
  app.get("/api/doctor", async (_req, res) => {
    const checks: Array<{
      name: string;
      status: "ok" | "warn" | "error";
      message: string;
    }> = [];

    // Check ripgrep
    const rgAvail = await isRipgrepAvailable();
    checks.push({
      name: "ripgrep",
      status: rgAvail ? "ok" : "error",
      message: rgAvail
        ? "ripgrep (rg) is available"
        : "ripgrep not found — install via: brew install ripgrep",
    });

    // Check git
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      const { stdout } = await exec("git", ["--version"]);
      checks.push({
        name: "git",
        status: "ok",
        message: stdout.trim(),
      });
    } catch {
      checks.push({
        name: "git",
        status: "error",
        message: "git not found in PATH",
      });
    }

    // Check Ollama
    const config = loadConfig();
    if (config.llm.provider === "ollama") {
      const provider = getLlmProvider();
      const ollamaAvail = provider ? await provider.isAvailable() : false;
      checks.push({
        name: "ollama",
        status: ollamaAvail ? "ok" : "warn",
        message: ollamaAvail
          ? `Ollama is reachable at ${config.llm.ollama.baseUrl}`
          : `Ollama not reachable at ${config.llm.ollama.baseUrl}`,
      });
    } else {
      checks.push({
        name: "ollama",
        status: "warn",
        message: "LLM provider set to 'none' — semantic features disabled",
      });
    }

    // Check Node.js version
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1), 10);
    checks.push({
      name: "node",
      status: major >= 20 ? "ok" : "error",
      message: `Node.js ${nodeVersion}${major < 20 ? " (requires >= 20)" : ""}`,
    });

    res.json({ checks });
  });

  // ─── Static Files (Portal Frontend) ────────────────────────────────────

  // Try to find the portal dist directory
  const possiblePortalPaths = [
    // When installed via npm — relative to CLI dist
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "portal", "dist"),
    // Development — monorepo layout
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "portal",
      "dist",
    ),
  ];

  let portalDir: string | null = null;
  for (const p of possiblePortalPaths) {
    if (existsSync(join(p, "index.html"))) {
      portalDir = p;
      break;
    }
  }

  if (portalDir) {
    app.use(express.static(portalDir));
    // SPA fallback — serve index.html for non-API routes
    app.get("*", (req, res) => {
      if (!req.path.startsWith("/api/")) {
        res.sendFile(join(portalDir!, "index.html"));
      }
    });
  }

  // ─── Start Server ────────────────────────────────────────────────────────

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`;
      resolve({
        url,
        close: () => server.close(),
      });
    });
  });
}
