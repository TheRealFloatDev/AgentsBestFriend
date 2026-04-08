/*
 *   Copyright (c) 2026 Garmingo UG (haftungsbeschraenkt)
 *   All rights reserved.
 *   Unauthorized use, reproduction, and distribution of this source code is strictly prohibited.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ripgrepSearch } from "@abf/core/search";

export function registerImpactTool(server: McpServer): void {
  server.tool(
    "abf_impact",
    "Find all files and lines that reference a given symbol name. Useful for change impact analysis.",
    {
      symbol_name: z
        .string()
        .describe(
          "The symbol (function, class, variable) name to find references for",
        ),
      file_path: z
        .string()
        .optional()
        .describe(
          "Optional: scope search to usages of this symbol from this file",
        ),
    },
    async ({ symbol_name, file_path }) => {
      const cwd = process.cwd();

      try {
        // Use ripgrep to find all occurrences of the symbol name
        const results = await ripgrepSearch({
          query: `\\b${escapeRegex(symbol_name)}\\b`,
          cwd,
          maxResults: 50,
          regex: true,
          contextLines: 0,
        });

        if (results.matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No references found for "${symbol_name}".`,
              },
            ],
          };
        }

        // Group by file
        const byFile = new Map<
          string,
          { line: number; text: string; usage: string }[]
        >();
        for (const match of results.matches) {
          const group = byFile.get(match.filePath) ?? [];
          group.push({
            line: match.lineNumber,
            text: match.lineText.trim(),
            usage: classifyUsage(match.lineText, symbol_name),
          });
          byFile.set(match.filePath, group);
        }

        const lines: string[] = [
          `${results.totalMatches} references to "${symbol_name}" in ${byFile.size} files:`,
          "",
        ];

        for (const [filePath, refs] of byFile) {
          lines.push(`${filePath}:`);
          for (const ref of refs) {
            lines.push(`  L${ref.line} [${ref.usage}] ${ref.text}`);
          }
        }

        if (results.truncated) {
          lines.push("", "(results truncated)");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
        };
      }
    },
  );
}

function classifyUsage(lineText: string, symbolName: string): string {
  const trimmed = lineText.trim();

  if (
    /^import\b/.test(trimmed) ||
    /^from\b/.test(trimmed) ||
    /require\(/.test(trimmed)
  ) {
    return "import";
  }
  if (
    new RegExp(
      `^(export\\s+)?(class|interface|type|enum)\\s+${escapeRegex(symbolName)}`,
    ).test(trimmed)
  ) {
    return "definition";
  }
  if (
    new RegExp(
      `^(export\\s+)?(function|const|let|var|async\\s+function)\\s+${escapeRegex(symbolName)}`,
    ).test(trimmed)
  ) {
    return "definition";
  }
  if (new RegExp(`^(pub\\s+)?fn\\s+${escapeRegex(symbolName)}`).test(trimmed)) {
    return "definition";
  }
  if (new RegExp(`^def\\s+${escapeRegex(symbolName)}`).test(trimmed)) {
    return "definition";
  }
  if (new RegExp(`extends\\s+${escapeRegex(symbolName)}`).test(trimmed)) {
    return "extends";
  }
  if (new RegExp(`implements\\s+.*${escapeRegex(symbolName)}`).test(trimmed)) {
    return "implements";
  }
  if (
    new RegExp(`:\\s*${escapeRegex(symbolName)}[<\\[|\\s,;>)]`).test(trimmed)
  ) {
    return "type_ref";
  }
  if (new RegExp(`${escapeRegex(symbolName)}\\s*\\(`).test(trimmed)) {
    return "call";
  }

  return "reference";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
