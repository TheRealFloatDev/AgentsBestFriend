import { z } from "zod";

// ─── LLM Provider Schemas ────────────────────────────────────────────────────

const ollamaConfigSchema = z.object({
  baseUrl: z.string().url().default("http://localhost:11434"),
  summaryModel: z.string().default("qwen2.5-coder:1.5b"),
  embeddingModel: z.string().default("nomic-embed-text"),
});

const llmConfigSchema = z.object({
  provider: z.enum(["ollama", "none"]).default("ollama"),
  ollama: ollamaConfigSchema.default({}),
});

// ─── Indexing Config ─────────────────────────────────────────────────────────

const indexingConfigSchema = z.object({
  autoWatch: z.boolean().default(true),
  respectGitignore: z.boolean().default(true),
  maxFileSizeKb: z.number().int().positive().default(512),
  excludedPatterns: z
    .array(z.string())
    .default(["*.min.js", "*.min.css", "*.map", "*.lock", "package-lock.json"]),
});

// ─── Search Config ───────────────────────────────────────────────────────────

const searchConfigSchema = z.object({
  defaultMaxResults: z.number().int().positive().default(20),
  ripgrepPath: z.string().default("rg"),
});

// ─── Portal Config ───────────────────────────────────────────────────────────

const portalConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(4242),
});

// ─── Root Config Schema ──────────────────────────────────────────────────────

export const configSchema = z.object({
  llm: llmConfigSchema.default({}),
  indexing: indexingConfigSchema.default({}),
  search: searchConfigSchema.default({}),
  portal: portalConfigSchema.default({}),
});

export type AbfConfig = z.infer<typeof configSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;
export type OllamaConfig = z.infer<typeof ollamaConfigSchema>;
export type IndexingConfig = z.infer<typeof indexingConfigSchema>;
export type SearchConfig = z.infer<typeof searchConfigSchema>;
export type PortalConfig = z.infer<typeof portalConfigSchema>;

/**
 * Create a valid config with all defaults applied.
 */
export function createDefaultConfig(): AbfConfig {
  return configSchema.parse({});
}
