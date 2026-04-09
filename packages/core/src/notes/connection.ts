import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export type NotesDb = Database.Database;

/**
 * Create or open the notes database at `.abf/notes.db`.
 * Separate from index.db so notes survive re-indexing.
 */
export function createNotesDb(projectRoot: string): NotesDb {
  const abfDir = join(projectRoot, ".abf");

  if (!existsSync(abfDir)) {
    mkdirSync(abfDir, { recursive: true });
  }

  const dbPath = join(abfDir, "notes.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

  ensureSchema(db);

  return db;
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS notes_title_idx ON notes(title);
  `);

  // FTS5 for full-text search on title + content + tags
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title,
      content,
      tags,
      content=notes,
      content_rowid=id
    );
  `);

  // Triggers to keep FTS5 in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content, tags)
      VALUES (NEW.id, NEW.title, NEW.content, NEW.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
      VALUES ('delete', OLD.id, OLD.title, OLD.content, OLD.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
      VALUES ('delete', OLD.id, OLD.title, OLD.content, OLD.tags);
      INSERT INTO notes_fts(rowid, title, content, tags)
      VALUES (NEW.id, NEW.title, NEW.content, NEW.tags);
    END;
  `);
}

export function closeNotesDb(db: NotesDb): void {
  db.close();
}
