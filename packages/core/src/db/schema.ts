import {
  sqliteTable,
  text,
  integer,
  blob,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ─── Files Table ─────────────────────────────────────────────────────────────
// Core table: every tracked file in the project
export const files = sqliteTable(
  "files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    path: text("path").notNull().unique(),
    contentHash: text("content_hash").notNull(),
    language: text("language"),
    sizeBytes: integer("size_bytes").notNull(),
    lineCount: integer("line_count").notNull(),
    summary: text("summary"),
    lastIndexedAt: integer("last_indexed_at", {
      mode: "timestamp_ms",
    }).notNull(),
    lastModifiedAt: integer("last_modified_at", {
      mode: "timestamp_ms",
    }).notNull(),
  },
  (table) => [
    uniqueIndex("files_path_idx").on(table.path),
    index("files_language_idx").on(table.language),
  ],
);

// ─── Symbols Table ───────────────────────────────────────────────────────────
// Functions, classes, interfaces, types, variables, methods, exports
export const symbols = sqliteTable(
  "symbols",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: [
        "function",
        "class",
        "interface",
        "type",
        "variable",
        "method",
        "property",
        "export",
        "module",
        "enum",
        "decorator",
      ],
    }).notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    parentId: integer("parent_id").references((): any => symbols.id, {
      onDelete: "cascade",
    }),
    exported: integer("exported", { mode: "boolean" }).notNull().default(false),
    signature: text("signature"),
  },
  (table) => [
    index("symbols_file_id_idx").on(table.fileId),
    index("symbols_name_kind_idx").on(table.name, table.kind),
    index("symbols_kind_idx").on(table.kind),
    index("symbols_parent_id_idx").on(table.parentId),
  ],
);

// ─── Imports Table ───────────────────────────────────────────────────────────
// Tracks import/require/from statements between files
export const imports = sqliteTable(
  "imports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceFileId: integer("source_file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    targetPath: text("target_path").notNull(),
    resolvedFileId: integer("resolved_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    importedSymbols: text("imported_symbols").notNull(), // JSON array or "*"
  },
  (table) => [
    index("imports_source_file_id_idx").on(table.sourceFileId),
    index("imports_resolved_file_id_idx").on(table.resolvedFileId),
  ],
);

// ─── Embeddings Table ────────────────────────────────────────────────────────
// Vector embeddings for semantic search (stored as Float32Array blob)
export const embeddings = sqliteTable(
  "embeddings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" })
      .unique(),
    vector: blob("vector", { mode: "buffer" }).notNull(),
    modelName: text("model_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("embeddings_file_id_idx").on(table.fileId)],
);

// ─── File Chunks Table ───────────────────────────────────────────────────────
// Smart chunks of files (by function/class boundaries)
export const fileChunks = sqliteTable(
  "file_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    symbolId: integer("symbol_id").references(() => symbols.id, {
      onDelete: "set null",
    }),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    index("file_chunks_file_id_idx").on(table.fileId, table.chunkIndex),
  ],
);

// ─── Type Exports ────────────────────────────────────────────────────────────
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;
export type Import = typeof imports.$inferSelect;
export type NewImport = typeof imports.$inferInsert;
export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;
export type FileChunk = typeof fileChunks.$inferSelect;
export type NewFileChunk = typeof fileChunks.$inferInsert;
