import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, isNull, and } from "drizzle-orm";
import { createProjectDb, closeDb, type ProjectDb } from "../db/connection.js";
import { files, embeddings } from "../db/schema.js";
import { getLlmProvider } from "../llm/index.js";
import { LlmUnavailableError } from "../llm/provider.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SummaryStats {
  generated: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export interface EmbeddingStats {
  generated: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

// ─── Summary Pipeline ────────────────────────────────────────────────────────

/**
 * Generate LLM summaries for all files that don't have one yet.
 * Requires an active LLM provider (Ollama).
 */
export async function generateSummaries(
  projectRoot: string,
  opts?: { force?: boolean; batchSize?: number },
): Promise<SummaryStats> {
  const start = Date.now();
  const provider = getLlmProvider();
  if (!provider) {
    throw new LlmUnavailableError("none", "LLM provider is set to 'none'");
  }

  if (!(await provider.isAvailable())) {
    throw new LlmUnavailableError(
      provider.name,
      "Cannot reach Ollama. Is it running?",
    );
  }

  const db = createProjectDb(projectRoot);
  const stats: SummaryStats = {
    generated: 0,
    skipped: 0,
    errors: 0,
    durationMs: 0,
  };

  try {
    // Get files needing summaries
    const rows = opts?.force
      ? db.select({ id: files.id, path: files.path }).from(files).all()
      : db
          .select({ id: files.id, path: files.path })
          .from(files)
          .where(isNull(files.summary))
          .all();

    const batchSize = opts?.batchSize ?? 5;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      // Process serially within batch to avoid overwhelming Ollama
      for (const row of batch) {
        try {
          const absPath = join(projectRoot, row.path);
          const content = await readFile(absPath, "utf-8");

          const summary = await provider.generateSummary(content, row.path);

          db.update(files).set({ summary }).where(eq(files.id, row.id)).run();

          stats.generated++;
        } catch (err) {
          if (err instanceof LlmUnavailableError) throw err;
          stats.errors++;
        }
      }
    }

    stats.skipped =
      rows.length === 0
        ? db.select({ id: files.id }).from(files).all().length
        : 0;

    stats.durationMs = Date.now() - start;
    return stats;
  } finally {
    closeDb(db);
  }
}

// ─── Embedding Pipeline ──────────────────────────────────────────────────────

/**
 * Generate embeddings for all files that don't have one yet.
 * Requires an active LLM provider (Ollama) with an embedding model.
 */
export async function generateEmbeddings(
  projectRoot: string,
  opts?: { force?: boolean; batchSize?: number },
): Promise<EmbeddingStats> {
  const start = Date.now();
  const provider = getLlmProvider();
  if (!provider) {
    throw new LlmUnavailableError("none", "LLM provider is set to 'none'");
  }

  if (!(await provider.isAvailable())) {
    throw new LlmUnavailableError(
      provider.name,
      "Cannot reach Ollama. Is it running?",
    );
  }

  const db = createProjectDb(projectRoot);
  const stats: EmbeddingStats = {
    generated: 0,
    skipped: 0,
    errors: 0,
    durationMs: 0,
  };

  try {
    // Get files needing embeddings
    const allFiles = db
      .select({ id: files.id, path: files.path })
      .from(files)
      .all();

    const existingEmbeddings = opts?.force
      ? new Set<number>()
      : new Set(
          db
            .select({ fileId: embeddings.fileId })
            .from(embeddings)
            .all()
            .map((e) => e.fileId),
        );

    const needsEmbedding = allFiles.filter(
      (f) => !existingEmbeddings.has(f.id),
    );

    const batchSize = opts?.batchSize ?? 5;

    for (let i = 0; i < needsEmbedding.length; i += batchSize) {
      const batch = needsEmbedding.slice(i, i + batchSize);

      for (const row of batch) {
        try {
          const absPath = join(projectRoot, row.path);
          const content = await readFile(absPath, "utf-8");

          const vector = await provider.generateEmbedding(content);
          const buffer = Buffer.from(vector.buffer);
          const now = new Date();

          if (opts?.force) {
            // Delete existing embedding if force mode
            db.delete(embeddings).where(eq(embeddings.fileId, row.id)).run();
          }

          db.insert(embeddings)
            .values({
              fileId: row.id,
              vector: buffer,
              modelName: "nomic-embed-text", // from config
              createdAt: now,
            })
            .run();

          stats.generated++;
        } catch (err) {
          if (err instanceof LlmUnavailableError) throw err;
          stats.errors++;
        }
      }
    }

    stats.skipped = existingEmbeddings.size;
    stats.durationMs = Date.now() - start;
    return stats;
  } finally {
    closeDb(db);
  }
}
