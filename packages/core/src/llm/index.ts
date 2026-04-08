export type { LlmProvider, ModelInfo } from "./provider.js";
export { LlmUnavailableError } from "./provider.js";
export { OllamaProvider } from "./ollama.js";
export {
  generateSummaries,
  generateEmbeddings,
  type SummaryStats,
  type EmbeddingStats,
} from "./pipelines.js";

import { loadConfig } from "../config/manager.js";
import type { LlmProvider } from "./provider.js";
import { OllamaProvider } from "./ollama.js";

let _cachedProvider: LlmProvider | null = null;

/**
 * Get the configured LLM provider (singleton per process).
 * Returns null if provider is set to "none".
 */
export function getLlmProvider(): LlmProvider | null {
  if (_cachedProvider) return _cachedProvider;

  const config = loadConfig();

  if (config.llm.provider === "none") return null;

  _cachedProvider = new OllamaProvider(config.llm.ollama);
  return _cachedProvider;
}

/** Reset cached provider (for testing or config changes) */
export function resetLlmProvider(): void {
  _cachedProvider = null;
}
