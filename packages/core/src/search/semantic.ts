import { createProjectDb, closeDb } from "../db/connection.js";
import { files, embeddings } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { getLlmProvider } from "../llm/index.js";
import { LlmUnavailableError } from "../llm/provider.js";

export interface SemanticMatch {
  filePath: string;
  score: number;
  summary: string | null;
  language: string | null;
}

export interface SemanticSearchResult {
  matches: SemanticMatch[];
  queryEmbeddingMs: number;
  searchMs: number;
}

/**
 * Semantic search: embed the query, then find the most similar files
 * by cosine similarity against stored embeddings.
 */
export async function semanticSearch(opts: {
  query: string;
  cwd: string;
  maxResults?: number;
}): Promise<SemanticSearchResult> {
  const provider = getLlmProvider();
  if (!provider) {
    throw new LlmUnavailableError("none", "LLM provider is set to 'none'");
  }

  if (!(await provider.isAvailable())) {
    throw new LlmUnavailableError(
      provider.name,
      "Cannot reach Ollama for semantic search",
    );
  }

  const maxResults = opts.maxResults ?? 10;

  // 1. Embed the query
  const embedStart = Date.now();
  const queryVector = await provider.generateEmbedding(opts.query);
  const queryEmbeddingMs = Date.now() - embedStart;

  // 2. Load all embeddings from DB and compute cosine similarity
  const searchStart = Date.now();
  const db = createProjectDb(opts.cwd);

  try {
    const rows = db
      .select({
        fileId: embeddings.fileId,
        vector: embeddings.vector,
        path: files.path,
        summary: files.summary,
        language: files.language,
      })
      .from(embeddings)
      .innerJoin(files, eq(embeddings.fileId, files.id))
      .all();

    // Score each file
    const scored: SemanticMatch[] = [];
    for (const row of rows) {
      const fileVector = new Float32Array(
        (row.vector as Buffer).buffer,
        (row.vector as Buffer).byteOffset,
        (row.vector as Buffer).byteLength / 4,
      );

      const score = cosineSimilarity(queryVector, fileVector);
      scored.push({
        filePath: row.path,
        score,
        summary: row.summary,
        language: row.language,
      });
    }

    // Sort by similarity (highest first) and take top N
    scored.sort((a, b) => b.score - a.score);
    const matches = scored.slice(0, maxResults);

    const searchMs = Date.now() - searchStart;
    return { matches, queryEmbeddingMs, searchMs };
  } finally {
    closeDb(db);
  }
}

/**
 * Cosine similarity between two Float32Arrays.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
