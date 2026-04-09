import { watch } from "node:fs";
import { join, relative } from "node:path";
import { eq } from "drizzle-orm";
import { readFile, stat } from "node:fs/promises";
import { createProjectDb, closeDb, type ProjectDb } from "../db/connection.js";
import { files } from "../db/schema.js";
import {
  hashFileContent,
  detectLanguage,
  countLines,
  isBinaryFile,
} from "../utils/index.js";
import { loadConfig } from "../config/manager.js";
import { indexSymbolsAndImports } from "./pipeline.js";

export interface WatcherHandle {
  close(): void;
}

/**
 * Watch a project directory for file changes and update the index incrementally.
 * Uses Node.js native fs.watch (recursive) which works on macOS and Windows.
 * For Linux, @parcel/watcher can be added later as an optional dependency.
 */
export function watchProject(projectRoot: string): WatcherHandle {
  const config = loadConfig();
  const maxSizeBytes = config.indexing.maxFileSizeKb * 1024;
  const debounceMs = 300;
  const pending = new Map<string, NodeJS.Timeout>();

  const watcher = watch(
    projectRoot,
    { recursive: true },
    (_event, filename) => {
      if (!filename) return;

      // Skip directories we never care about
      if (shouldIgnore(filename)) return;

      // Debounce: wait for rapid edits to settle
      const existing = pending.get(filename);
      if (existing) clearTimeout(existing);

      pending.set(
        filename,
        setTimeout(() => {
          pending.delete(filename);
          handleChange(projectRoot, filename, maxSizeBytes).catch(() => {
            // silently ignore watcher errors
          });
        }, debounceMs),
      );
    },
  );

  return {
    close() {
      watcher.close();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}

const IGNORE_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".abf",
  "__pycache__",
  ".tox",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".turbo",
]);

function shouldIgnore(filePath: string): boolean {
  const parts = filePath.split("/");
  return parts.some((p) => IGNORE_SEGMENTS.has(p));
}

async function handleChange(
  projectRoot: string,
  relPath: string,
  maxSizeBytes: number,
): Promise<void> {
  const absPath = join(projectRoot, relPath);
  const db = createProjectDb(projectRoot);

  try {
    let st;
    try {
      st = await stat(absPath);
    } catch {
      // File deleted — remove from index
      db.delete(files).where(eq(files.path, relPath)).run();
      return;
    }

    if (!st.isFile()) return;
    if (st.size > maxSizeBytes || st.size === 0) return;
    if (isBinaryFile(absPath)) return;

    const content = await readFile(absPath, "utf-8");
    const hash = hashFileContent(content);
    const language = detectLanguage(relPath);
    const lineCount = countLines(content);
    const now = new Date();

    const existing = db
      .select({ contentHash: files.contentHash })
      .from(files)
      .where(eq(files.path, relPath))
      .get();

    if (existing) {
      if (existing.contentHash === hash) return; // unchanged
      db.update(files)
        .set({
          contentHash: hash,
          language,
          sizeBytes: st.size,
          lineCount,
          lastIndexedAt: now,
          lastModifiedAt: new Date(st.mtimeMs),
        })
        .where(eq(files.path, relPath))
        .run();

      // Re-parse symbols and imports for updated file
      const fileRow = db
        .select({ id: files.id })
        .from(files)
        .where(eq(files.path, relPath))
        .get();
      if (fileRow) {
        indexSymbolsAndImports(db, fileRow.id, relPath, content);
      }
    } else {
      const result = db
        .insert(files)
        .values({
          path: relPath,
          contentHash: hash,
          language,
          sizeBytes: st.size,
          lineCount,
          lastIndexedAt: now,
          lastModifiedAt: new Date(st.mtimeMs),
        })
        .run();

      // Parse symbols and imports for new file
      const fileId = Number(result.lastInsertRowid);
      indexSymbolsAndImports(db, fileId, relPath, content);
    }
  } finally {
    closeDb(db);
  }
}
