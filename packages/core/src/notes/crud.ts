import type { NotesDb } from "./connection.js";

export interface Note {
  id: number;
  title: string;
  content: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteSearchResult {
  id: number;
  title: string;
  content: string;
  tags: string | null;
  rank: number;
}

export function saveNote(
  db: NotesDb,
  input: { title: string; content: string; tags?: string },
): Note {
  const stmt = db.prepare(
    `INSERT INTO notes (title, content, tags) VALUES (?, ?, ?) RETURNING *`,
  );
  return stmt.get(input.title, input.content, input.tags ?? null) as Note;
}

export function getNote(
  db: NotesDb,
  input: { id?: number; title?: string },
): Note | null {
  if (input.id != null) {
    return (
      (db.prepare(`SELECT * FROM notes WHERE id = ?`).get(input.id) as Note) ??
      null
    );
  }
  if (input.title) {
    return (
      (db
        .prepare(`SELECT * FROM notes WHERE title = ?`)
        .get(input.title) as Note) ?? null
    );
  }
  return null;
}

export function listNotes(
  db: NotesDb,
  input?: { limit?: number; tag?: string },
): Note[] {
  const limit = input?.limit ?? 50;
  if (input?.tag) {
    return db
      .prepare(
        `SELECT * FROM notes WHERE ',' || tags || ',' LIKE '%,' || ? || ',%' ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(input.tag, limit) as Note[];
  }
  return db
    .prepare(`SELECT * FROM notes ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as Note[];
}

export function searchNotes(
  db: NotesDb,
  input: { query: string; mode?: "and" | "or"; limit?: number },
): NoteSearchResult[] {
  const limit = input.limit ?? 20;
  const query =
    input.mode === "or"
      ? input.query.split(/\s+/).filter(Boolean).join(" OR ")
      : input.query;

  return db
    .prepare(
      `SELECT n.id, n.title, n.content, n.tags, bm25(notes_fts) AS rank
       FROM notes_fts
       JOIN notes n ON notes_fts.rowid = n.id
       WHERE notes_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, limit) as NoteSearchResult[];
}

export function updateNote(
  db: NotesDb,
  input: { id: number; title?: string; content?: string; tags?: string },
): Note | null {
  const existing = getNote(db, { id: input.id });
  if (!existing) return null;

  const title = input.title ?? existing.title;
  const content = input.content ?? existing.content;
  const tags = input.tags !== undefined ? input.tags : existing.tags;

  const stmt = db.prepare(
    `UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
  );
  return stmt.get(title, content, tags, input.id) as Note;
}

export function deleteNote(db: NotesDb, input: { id: number }): boolean {
  const result = db.prepare(`DELETE FROM notes WHERE id = ?`).run(input.id);
  return result.changes > 0;
}
