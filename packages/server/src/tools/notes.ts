import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createNotesDb,
  closeNotesDb,
  saveNote,
  getNote,
  listNotes,
  searchNotes,
  updateNote,
  deleteNote,
} from "@abf/core/notes";

export function registerNotesTool(server: McpServer): void {
  server.tool(
    "abf_notes",
    `Agent notepad — persist notes across sessions in a local SQLite database (.abf/notes.db).
Supports save, get, list, search (full-text via FTS5), update, and delete actions.
Use this to store task context, decisions, TODOs, or anything that should survive between conversations.
Notes are project-scoped and independent from the code index (survive re-indexing).`,
    {
      action: z
        .enum(["save", "get", "list", "search", "update", "delete"])
        .describe("The operation to perform"),

      // save / update fields
      title: z
        .string()
        .optional()
        .describe("Note title (required for save, optional for update)"),
      content: z
        .string()
        .optional()
        .describe("Note body (required for save, optional for update)"),
      tags: z
        .string()
        .optional()
        .describe('Comma-separated tags, e.g. "todo,architecture,auth"'),

      // get / update / delete
      id: z
        .number()
        .int()
        .optional()
        .describe("Note ID (for get, update, delete)"),

      // search
      query: z
        .string()
        .optional()
        .describe("Search query for full-text search (FTS5)"),
      match_mode: z
        .enum(["and", "or"])
        .optional()
        .default("or")
        .describe(
          '"or": match notes with ANY keyword (default). "and": require ALL keywords.',
        ),

      // list
      tag: z
        .string()
        .optional()
        .describe("Filter notes by a specific tag (for list)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .default(20)
        .describe("Max results for list/search (default: 20)"),
    },
    async ({
      action,
      title,
      content,
      tags,
      id,
      query,
      match_mode,
      tag,
      limit,
    }) => {
      const projectRoot = process.env.ABF_PROJECT_ROOT || process.cwd();

      try {
        const db = createNotesDb(projectRoot);

        try {
          switch (action) {
            case "save": {
              if (!title || !content) {
                return err("save requires 'title' and 'content'");
              }
              const note = saveNote(db, { title, content, tags });
              return ok(
                `Note #${note.id} saved:\n  Title: ${note.title}\n  Tags: ${note.tags ?? "(none)"}\n  Created: ${note.created_at}`,
              );
            }

            case "get": {
              if (id == null && !title) {
                return err("get requires 'id' or 'title'");
              }
              const note = getNote(db, { id: id ?? undefined, title });
              if (!note) return ok("Note not found.");
              return ok(formatNote(note));
            }

            case "list": {
              const notes = listNotes(db, { limit, tag });
              if (notes.length === 0) {
                return ok(
                  tag
                    ? `No notes with tag "${tag}".`
                    : "No notes yet. Use action=save to create one.",
                );
              }
              const lines = [`${notes.length} note(s):\n`];
              for (const n of notes) {
                lines.push(
                  `#${n.id}  ${n.title}  [${n.tags ?? ""}]  (${n.updated_at})`,
                );
              }
              return ok(lines.join("\n"));
            }

            case "search": {
              if (!query) {
                return err("search requires 'query'");
              }
              const results = searchNotes(db, {
                query,
                mode: match_mode,
                limit,
              });
              if (results.length === 0) {
                return ok(`No notes matching "${query}".`);
              }
              const lines = [`${results.length} result(s) for "${query}":\n`];
              for (const r of results) {
                lines.push(`#${r.id}  ${r.title}  [${r.tags ?? ""}]`);
                // Show first 200 chars of content as preview
                const preview =
                  r.content.length > 200
                    ? r.content.slice(0, 200) + "…"
                    : r.content;
                lines.push(`  ${preview}\n`);
              }
              return ok(lines.join("\n"));
            }

            case "update": {
              if (id == null) {
                return err("update requires 'id'");
              }
              const updated = updateNote(db, {
                id,
                title: title ?? undefined,
                content: content ?? undefined,
                tags,
              });
              if (!updated) return ok(`Note #${id} not found.`);
              return ok(
                `Note #${updated.id} updated:\n  Title: ${updated.title}\n  Tags: ${updated.tags ?? "(none)"}\n  Updated: ${updated.updated_at}`,
              );
            }

            case "delete": {
              if (id == null) {
                return err("delete requires 'id'");
              }
              const deleted = deleteNote(db, { id });
              return ok(
                deleted ? `Note #${id} deleted.` : `Note #${id} not found.`,
              );
            }
          }
        } finally {
          closeNotesDb(db);
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Notes error: ${error.message ?? String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${text}` }],
    isError: true,
  };
}

function formatNote(n: {
  id: number;
  title: string;
  content: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}): string {
  return [
    `── Note #${n.id} ──`,
    `Title:   ${n.title}`,
    `Tags:    ${n.tags ?? "(none)"}`,
    `Created: ${n.created_at}`,
    `Updated: ${n.updated_at}`,
    ``,
    n.content,
  ].join("\n");
}
