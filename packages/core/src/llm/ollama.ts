import type { OllamaConfig } from "../config/schema.js";
import type { LlmProvider, ModelInfo } from "./provider.js";
import { LlmUnavailableError } from "./provider.js";

/**
 * Ollama LLM provider — communicates with a local Ollama instance via HTTP.
 */
export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private summaryModel: string;
  private embeddingModel: string;

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.summaryModel = config.summaryModel;
    this.embeddingModel = config.embeddingModel;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generateSummary(content: string, filePath: string): Promise<string> {
    // Truncate content to avoid excessive token usage
    const maxChars = 6000;
    const truncated =
      content.length > maxChars
        ? content.slice(0, maxChars) + "\n... (truncated)"
        : content;

    const prompt = `Summarize this source file in 2-3 concise sentences. Focus on what the file does, its key exports, and its role in the codebase. Do NOT include code blocks.

File: ${filePath}

\`\`\`
${truncated}
\`\`\`

Summary:`;

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.summaryModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 200,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new LlmUnavailableError("ollama", `${res.status}: ${text}`);
    }

    const data = (await res.json()) as { response: string };
    return data.response.trim();
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    // Truncate for embedding model context window
    const maxChars = 8000;
    const truncated = text.length > maxChars ? text.slice(0, maxChars) : text;

    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.embeddingModel,
        input: truncated,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new LlmUnavailableError("ollama", `embed ${res.status}: ${body}`);
    }

    const data = (await res.json()) as { embeddings: number[][] };
    if (!data.embeddings?.[0]) {
      throw new Error("Empty embedding response from Ollama");
    }

    return new Float32Array(data.embeddings[0]);
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) {
      throw new LlmUnavailableError("ollama", `${res.status}`);
    }

    const data = (await res.json()) as {
      models: { name: string; size: number; modified_at: string }[];
    };

    return (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at,
    }));
  }

  async pullModel(modelName: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: false }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to pull model ${modelName}: ${text}`);
    }

    // Consume the response
    await res.json();
  }
}
