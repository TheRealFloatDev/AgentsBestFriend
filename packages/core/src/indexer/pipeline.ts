import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createProjectDb, closeDb, type ProjectDb } from "../db/connection.js";
import { files, symbols, imports } from "../db/schema.js";
import { discoverFiles, type DiscoveredFile } from "./discovery.js";
import { hashFileContent, detectLanguage, countLines } from "../utils/index.js";
import { parseFile } from "../analysis/parse.js";
import type { ParsedSymbol } from "../analysis/parser-types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IndexStats {
  totalDiscovered: number;
  indexed: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export interface IndexStatus {
  indexedFiles: number;
  totalTrackedFiles: number;
  lastUpdated: Date | null;
  staleFiles: number;
  indexSizeBytes: number;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Run the full indexing pipeline for a project.
 * Discovers files, hashes them, upserts into DB, removes stale entries.
 */
export async function runIndexPipeline(
  projectRoot: string,
): Promise<IndexStats> {
  const start = Date.now();
  const db = createProjectDb(projectRoot);

  try {
    const discovered = await discoverFiles({ projectRoot });
    const stats: IndexStats = {
      totalDiscovered: discovered.length,
      indexed: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
    };

    // Get existing indexed files for comparison
    const existingFiles = db
      .select({ path: files.path, contentHash: files.contentHash })
      .from(files)
      .all();
    const existingMap = new Map(
      existingFiles.map((f) => [f.path, f.contentHash]),
    );

    const discoveredPaths = new Set<string>();

    // Process files in batches
    const BATCH = 50;
    for (let i = 0; i < discovered.length; i += BATCH) {
      const batch = discovered.slice(i, i + BATCH);
      await Promise.all(
        batch.map((file) =>
          processFile(
            db,
            projectRoot,
            file,
            existingMap,
            discoveredPaths,
            stats,
          ),
        ),
      );
    }

    // Remove stale entries (files that no longer exist)
    for (const [existingPath] of existingMap) {
      if (!discoveredPaths.has(existingPath)) {
        db.delete(files).where(eq(files.path, existingPath)).run();
        stats.removed++;
      }
    }

    stats.durationMs = Date.now() - start;
    return stats;
  } finally {
    closeDb(db);
  }
}

async function processFile(
  db: ProjectDb,
  projectRoot: string,
  file: DiscoveredFile,
  existingMap: Map<string, string>,
  discoveredPaths: Set<string>,
  stats: IndexStats,
): Promise<void> {
  discoveredPaths.add(file.relativePath);

  try {
    const content = await readFile(file.absolutePath, "utf-8");
    const hash = hashFileContent(content);
    const existingHash = existingMap.get(file.relativePath);

    // Skip if unchanged
    if (existingHash === hash) {
      stats.skipped++;
      return;
    }

    const language = detectLanguage(file.relativePath);
    const lineCount = countLines(content);
    const now = new Date();

    if (existingHash) {
      // Update existing entry
      db.update(files)
        .set({
          contentHash: hash,
          language,
          sizeBytes: file.sizeBytes,
          lineCount,
          lastIndexedAt: now,
          lastModifiedAt: new Date(file.lastModifiedAt),
        })
        .where(eq(files.path, file.relativePath))
        .run();

      // Re-parse symbols for updated file
      const fileRow = db
        .select({ id: files.id })
        .from(files)
        .where(eq(files.path, file.relativePath))
        .get();
      if (fileRow) {
        indexSymbolsAndImports(db, fileRow.id, file.relativePath, content);
      }
      stats.updated++;
    } else {
      // Insert new entry
      const result = db
        .insert(files)
        .values({
          path: file.relativePath,
          contentHash: hash,
          language,
          sizeBytes: file.sizeBytes,
          lineCount,
          lastIndexedAt: now,
          lastModifiedAt: new Date(file.lastModifiedAt),
        })
        .run();

      // Parse and store symbols + imports
      const fileId = Number(result.lastInsertRowid);
      indexSymbolsAndImports(db, fileId, file.relativePath, content);
      stats.indexed++;
    }
  } catch {
    stats.errors++;
  }
}

/**
 * Get the current index status for a project.
 */
export async function getIndexStatus(
  projectRoot: string,
): Promise<IndexStatus> {
  const db = createProjectDb(projectRoot);

  try {
    const allFiles = db
      .select({
        path: files.path,
        lastIndexedAt: files.lastIndexedAt,
        lastModifiedAt: files.lastModifiedAt,
      })
      .from(files)
      .all();

    const discovered = await discoverFiles({ projectRoot });

    // Find stale files: indexed but content may have changed
    const indexedPaths = new Set(allFiles.map((f) => f.path));
    const discoveredPaths = new Set(discovered.map((f) => f.relativePath));
    let stale = 0;
    for (const path of indexedPaths) {
      if (!discoveredPaths.has(path)) stale++;
    }

    const lastUpdated =
      allFiles.length > 0
        ? new Date(
            Math.max(
              ...allFiles.map((f) => (f.lastIndexedAt as Date).getTime()),
            ),
          )
        : null;

    // Get DB file size
    const { statSync } = await import("node:fs");
    const { join } = await import("node:path");
    let indexSizeBytes = 0;
    try {
      const dbPath = join(projectRoot, ".abf", "index.db");
      indexSizeBytes = statSync(dbPath).size;
    } catch {
      /* db doesn't exist yet */
    }

    return {
      indexedFiles: allFiles.length,
      totalTrackedFiles: discovered.length,
      lastUpdated,
      staleFiles: stale,
      indexSizeBytes,
    };
  } finally {
    closeDb(db);
  }
}

// ─── Symbol & Import Indexing ────────────────────────────────────────────────

export function indexSymbolsAndImports(
  db: ProjectDb,
  fileId: number,
  filePath: string,
  content: string,
): void {
  // Clear existing symbols + imports for this file
  db.delete(symbols).where(eq(symbols.fileId, fileId)).run();
  db.delete(imports).where(eq(imports.sourceFileId, fileId)).run();

  try {
    const parsed = parseFile(filePath, content);

    // Insert symbols (flatten hierarchy, preserving parent_id)
    insertSymbols(db, fileId, parsed.symbols, null);

    // Insert imports
    for (const imp of parsed.imports) {
      db.insert(imports)
        .values({
          sourceFileId: fileId,
          targetPath: imp.targetPath,
          importedSymbols: JSON.stringify(imp.importedSymbols),
        })
        .run();
    }
  } catch {
    // Parsing errors should not break indexing
  }
}

function insertSymbols(
  db: ProjectDb,
  fileId: number,
  syms: ParsedSymbol[],
  parentId: number | null,
): void {
  for (const sym of syms) {
    const result = db
      .insert(symbols)
      .values({
        fileId,
        name: sym.name,
        kind: sym.kind,
        startLine: sym.startLine,
        endLine: sym.endLine,
        parentId,
        exported: sym.exported,
        signature: sym.signature ?? null,
      })
      .run();

    if (sym.children.length > 0) {
      const newId = Number(result.lastInsertRowid);
      insertSymbols(db, fileId, sym.children, newId);
    }
  }
}
