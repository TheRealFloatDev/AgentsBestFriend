// ─── LLM Provider Abstraction ────────────────────────────────────────────────

export interface LlmProvider {
  readonly name: string;

  /** Check if the provider is reachable */
  isAvailable(): Promise<boolean>;

  /** Generate a short summary of file content */
  generateSummary(content: string, filePath: string): Promise<string>;

  /** Generate an embedding vector for text */
  generateEmbedding(text: string): Promise<Float32Array>;

  /** List available models */
  listModels(): Promise<ModelInfo[]>;
}

export interface ModelInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export class LlmUnavailableError extends Error {
  constructor(provider: string, reason?: string) {
    super(
      `LLM provider "${provider}" is not available${reason ? `: ${reason}` : ""}. Configure in ~/.abf/config.json or run \`abf doctor\`.`,
    );
    this.name = "LlmUnavailableError";
  }
}
