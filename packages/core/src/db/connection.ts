import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type ProjectDb = BetterSQLite3Database<typeof schema>;

/**
 * Create or open a project-level SQLite database at `.abf/index.db`
 * within the given project root directory.
 */
export function createProjectDb(projectRoot: string): ProjectDb {
  const abfDir = join(projectRoot, ".abf");
  const dbPath = join(abfDir, "index.db");

  if (!existsSync(abfDir)) {
    mkdirSync(abfDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);

  // Performance pragmas for local development use
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });

  // Ensure all tables exist (push-based schema)
  ensureSchema(sqlite);

  return db;
}

/**
 * Create all tables if they don't exist.
 * Uses raw SQL because drizzle-kit push is a CLI tool — at runtime
 * we create tables directly.
 */
function ensureSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL,
      language TEXT,
      size_bytes INTEGER NOT NULL,
      line_count INTEGER NOT NULL,
      summary TEXT,
      last_indexed_at INTEGER NOT NULL,
      last_modified_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS files_path_idx ON files(path);
    CREATE INDEX IF NOT EXISTS files_language_idx ON files(language);

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      parent_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
      exported INTEGER NOT NULL DEFAULT 0,
      signature TEXT
    );

    CREATE INDEX IF NOT EXISTS symbols_file_id_idx ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS symbols_name_kind_idx ON symbols(name, kind);
    CREATE INDEX IF NOT EXISTS symbols_kind_idx ON symbols(kind);
    CREATE INDEX IF NOT EXISTS symbols_parent_id_idx ON symbols(parent_id);

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      target_path TEXT NOT NULL,
      resolved_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      imported_symbols TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS imports_source_file_id_idx ON imports(source_file_id);
    CREATE INDEX IF NOT EXISTS imports_resolved_file_id_idx ON imports(resolved_file_id);

    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      model_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS embeddings_file_id_idx ON embeddings(file_id);

    CREATE TABLE IF NOT EXISTS file_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS file_chunks_file_id_idx ON file_chunks(file_id, chunk_index);
  `);

  // FTS5 virtual table for full-text search on file summaries
  // This must be separate because FTS5 uses different syntax
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      path,
      summary,
      content=files,
      content_rowid=id
    );
  `);

  // Triggers to keep FTS5 in sync with the files table
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, path, summary) VALUES (NEW.id, NEW.path, NEW.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS files_fts_delete AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, path, summary) VALUES ('delete', OLD.id, OLD.path, OLD.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, path, summary) VALUES ('delete', OLD.id, OLD.path, OLD.summary);
      INSERT INTO files_fts(rowid, path, summary) VALUES (NEW.id, NEW.path, NEW.summary);
    END;
  `);
}

/**
 * Close the underlying SQLite connection.
 */
export function closeDb(db: ProjectDb): void {
  // Access the underlying better-sqlite3 instance to close it
  // drizzle doesn't expose a close method directly
  const session = (db as any).session;
  if (session?.client?.close) {
    session.client.close();
  }
}
