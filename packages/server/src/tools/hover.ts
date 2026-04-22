import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { ts } from "ts-morph";
import { makeProject, locateNode } from "./definition.js";

export function registerHoverTool(server: McpServer): void {
  server.tool(
    "abf_hover",
    `Get the inferred type and JSDoc for an identifier in TypeScript/JavaScript code.
Equivalent to a "hover tooltip" in an IDE: returns the symbol's resolved type signature
and any documentation comments. Use this to verify an API's exact shape before calling it.`,
    {
      file_path: z.string().describe("File containing the identifier"),
      line: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based line number of the identifier"),
      column: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based column number of the identifier"),
      symbol: z
        .string()
        .optional()
        .describe(
          "Identifier name to locate inside file_path (used when line/column not given)",
        ),
    },
    async ({ file_path, line, column, symbol }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      const abs = isAbsolute(file_path) ? file_path : join(cwd, file_path);
      if (!existsSync(abs)) return text(`Error: file not found: ${file_path}`);

      try {
        const project = makeProject(cwd);
        const sf = project.addSourceFileAtPath(abs);

        const node = locateNode(sf, { line, column, symbol });
        if (!node) {
          return text(
            symbol
              ? `Symbol "${symbol}" not found in ${file_path}.`
              : `No identifier found at L${line}:${column} in ${file_path}.`,
          );
        }

        const ls = project.getLanguageService().compilerObject;
        const info = ls.getQuickInfoAtPosition(
          sf.getFilePath(),
          node.getStart(),
        );

        if (!info) {
          return text(`No hover info available for "${node.getText()}".`);
        }

        const display = info.displayParts
          ? ts.displayPartsToString(info.displayParts)
          : "";
        const docs = info.documentation
          ? ts.displayPartsToString(info.documentation)
          : "";
        const tags =
          info.tags && info.tags.length > 0
            ? info.tags
                .map(
                  (t) =>
                    `@${t.name}${t.text ? " " + ts.displayPartsToString(t.text) : ""}`,
                )
                .join("\n")
            : "";

        const lc = sf.getLineAndColumnAtPos(node.getStart());
        const out: string[] = [
          `${node.getText()} — ${file_path}:L${lc.line}:${lc.column}`,
          "",
          "Type:",
          display || "  (none)",
        ];
        if (docs) {
          out.push("", "Docs:", docs);
        }
        if (tags) {
          out.push("", "Tags:", tags);
        }

        return text(out.join("\n"));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return text(`Error: ${msg}`);
      }
    },
  );
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
