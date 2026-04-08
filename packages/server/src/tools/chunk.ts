import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "@abf/core/analysis";
import type { ParsedSymbol } from "@abf/core/analysis";

export function registerChunkTool(server: McpServer): void {
  server.tool(
    "abf_chunk",
    "Smart file chunking by symbol boundaries. Without chunk_index: returns chunk overview. With chunk_index: returns that chunk's content.",
    {
      file_path: z.string().describe("Path to the file"),
      chunk_index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Request a specific chunk by index (0-based). Omit for overview.",
        ),
    },
    async ({ file_path, chunk_index }) => {
      const cwd = process.cwd();
      const absPath = file_path.startsWith("/")
        ? file_path
        : join(cwd, file_path);

      try {
        const content = readFileSync(absPath, "utf-8");
        const lines = content.split("\n");
        const { symbols } = parseFile(absPath, content);

        const chunks = buildChunks(symbols, lines.length);

        if (chunk_index !== undefined) {
          if (chunk_index < 0 || chunk_index >= chunks.length) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: chunk_index ${chunk_index} out of range (0-${chunks.length - 1})`,
                },
              ],
            };
          }
          const chunk = chunks[chunk_index];
          const chunkLines = lines.slice(chunk.startLine - 1, chunk.endLine);
          const text = [
            `Chunk ${chunk_index}/${chunks.length - 1}: ${chunk.label} (L${chunk.startLine}-${chunk.endLine})`,
            "---",
            ...chunkLines,
          ].join("\n");
          return { content: [{ type: "text" as const, text }] };
        }

        // Overview mode
        const overview = chunks
          .map(
            (c, i) =>
              `[${i}] ${c.label}  L${c.startLine}-${c.endLine} (${c.endLine - c.startLine + 1} lines)`,
          )
          .join("\n");

        const text = `${chunks.length} chunks in ${file_path}:\n${overview}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    },
  );
}

interface Chunk {
  label: string;
  startLine: number;
  endLine: number;
}

const MAX_CHUNK_LINES = 200;

function buildChunks(symbols: ParsedSymbol[], totalLines: number): Chunk[] {
  if (symbols.length === 0) {
    // No symbols parsed — return the whole file as one chunk
    return [{ label: "(entire file)", startLine: 1, endLine: totalLines }];
  }

  const chunks: Chunk[] = [];

  // Sort top-level symbols by start line
  const sorted = [...symbols].sort((a, b) => a.startLine - b.startLine);

  // Add preamble (imports/headers before first symbol)
  if (sorted[0].startLine > 1) {
    chunks.push({
      label: "(preamble)",
      startLine: 1,
      endLine: sorted[0].startLine - 1,
    });
  }

  for (const sym of sorted) {
    const symLines = sym.endLine - sym.startLine + 1;

    if (symLines <= MAX_CHUNK_LINES) {
      chunks.push({
        label: `${sym.kind} ${sym.name}`,
        startLine: sym.startLine,
        endLine: sym.endLine,
      });
    } else {
      // Split large symbol by its children (methods)
      if (sym.children.length > 0) {
        const childSorted = [...sym.children].sort(
          (a, b) => a.startLine - b.startLine,
        );
        let cursor = sym.startLine;

        for (const child of childSorted) {
          // Gap before this child
          if (child.startLine > cursor) {
            chunks.push({
              label: `${sym.kind} ${sym.name} (header)`,
              startLine: cursor,
              endLine: child.startLine - 1,
            });
          }
          chunks.push({
            label: `${sym.kind} ${sym.name} → ${child.kind} ${child.name}`,
            startLine: child.startLine,
            endLine: child.endLine,
          });
          cursor = child.endLine + 1;
        }

        // Remainder after last child
        if (cursor <= sym.endLine) {
          chunks.push({
            label: `${sym.kind} ${sym.name} (tail)`,
            startLine: cursor,
            endLine: sym.endLine,
          });
        }
      } else {
        // No children — split by line count
        for (
          let start = sym.startLine;
          start <= sym.endLine;
          start += MAX_CHUNK_LINES
        ) {
          const end = Math.min(start + MAX_CHUNK_LINES - 1, sym.endLine);
          chunks.push({
            label: `${sym.kind} ${sym.name} (part)`,
            startLine: start,
            endLine: end,
          });
        }
      }
    }
  }

  // Add epilogue (content after last symbol)
  const lastEnd = sorted[sorted.length - 1].endLine;
  if (lastEnd < totalLines) {
    chunks.push({
      label: "(epilogue)",
      startLine: lastEnd + 1,
      endLine: totalLines,
    });
  }

  return chunks;
}
