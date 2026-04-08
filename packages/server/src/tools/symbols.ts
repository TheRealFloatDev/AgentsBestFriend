import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "@abf/core/analysis";
import type { ParsedSymbol } from "@abf/core/analysis";

export function registerSymbolsTool(server: McpServer): void {
  server.tool(
    "abf_symbols",
    "Get the symbol outline (functions, classes, methods, types) of a file.",
    {
      file_path: z.string().describe("Path to the file (relative or absolute)"),
      depth: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(2)
        .describe("How deep to show nested symbols"),
    },
    async ({ file_path, depth }) => {
      const cwd = process.cwd();
      const absPath = file_path.startsWith("/")
        ? file_path
        : join(cwd, file_path);

      try {
        const content = readFileSync(absPath, "utf-8");
        const { symbols } = parseFile(absPath, content);

        if (symbols.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No symbols found in ${file_path}`,
              },
            ],
          };
        }

        const text = formatSymbolTree(symbols, depth, 0);
        return { content: [{ type: "text" as const, text }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    },
  );
}

function formatSymbolTree(
  symbols: ParsedSymbol[],
  maxDepth: number,
  currentDepth: number,
): string {
  const lines: string[] = [];
  const indent = "  ".repeat(currentDepth);

  for (const sym of symbols) {
    const exported = sym.exported ? "★ " : "";
    const sig = sym.signature ?? sym.name;
    const range = `L${sym.startLine}-${sym.endLine}`;
    lines.push(`${indent}${exported}${sym.kind} ${sig}  (${range})`);

    if (sym.children.length > 0 && currentDepth < maxDepth - 1) {
      lines.push(formatSymbolTree(sym.children, maxDepth, currentDepth + 1));
    }
  }

  return lines.join("\n");
}
