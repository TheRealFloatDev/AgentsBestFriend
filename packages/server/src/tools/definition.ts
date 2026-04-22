import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { Project, SyntaxKind, ts, type Node, type SourceFile } from "ts-morph";

export function registerDefinitionTool(server: McpServer): void {
  server.tool(
    "abf_definition",
    `Jump to a symbol's definition in TypeScript/JavaScript code.
Provide either (line + column) for a position-based lookup or (symbol) to find a named identifier in the file first.
Returns absolute file path, line range, and a short source preview — replaces "search for the definition" round-trips.`,
    {
      file_path: z.string().describe("File where the lookup originates"),
      line: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based line number of the identifier in file_path"),
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
          "Name of the identifier to locate inside file_path (used when line/column not given)",
        ),
      preview_lines: z
        .number()
        .int()
        .min(0)
        .max(40)
        .default(8)
        .describe("Lines of source preview around each definition"),
    },
    async ({ file_path, line, column, symbol, preview_lines }) => {
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

        const ls = project.getLanguageService();
        const defs = ls.getDefinitionsAtPosition(sf, node.getStart());

        if (!defs || defs.length === 0) {
          return text(
            `No definition found for "${node.getText()}" at L${node.getStartLineNumber()}.`,
          );
        }

        const out: string[] = [
          `Definitions for "${node.getText()}" (${defs.length}):`,
          "",
        ];

        for (const d of defs) {
          const dsf = d.getSourceFile();
          const start = d.getNode().getStart();
          const end = d.getNode().getEnd();
          const startLine = dsf.getLineAndColumnAtPos(start).line;
          const endLine = dsf.getLineAndColumnAtPos(end).line;
          const file = relative(cwd, dsf.getFilePath());
          out.push(
            `  ${file}:L${startLine}-${endLine}  ${d.getKind?.() ?? ""} ${d.getName?.() ?? ""}`.trim(),
          );

          if (preview_lines > 0) {
            const previewStart = Math.max(1, startLine);
            const previewEnd = Math.min(
              dsf.getEndLineNumber(),
              startLine + preview_lines - 1,
            );
            const lines = dsf.getFullText().split("\n");
            for (let i = previewStart; i <= previewEnd; i++) {
              out.push(
                `    ${i.toString().padStart(4)} | ${lines[i - 1] ?? ""}`,
              );
            }
            out.push("");
          }
        }

        return text(out.join("\n").trimEnd());
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

export function makeProject(cwd: string): Project {
  const tsconfig = join(cwd, "tsconfig.json");
  return new Project({
    tsConfigFilePath: existsSync(tsconfig) ? tsconfig : undefined,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: existsSync(tsconfig)
      ? undefined
      : {
          allowJs: true,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        },
  });
}

export function locateNode(
  sf: SourceFile,
  loc: { line?: number; column?: number; symbol?: string },
): Node | undefined {
  if (loc.line && loc.column) {
    const pos = sf.compilerNode.getPositionOfLineAndCharacter(
      loc.line - 1,
      loc.column - 1,
    );
    let found: Node | undefined;
    sf.forEachDescendant((node) => {
      if (found) return;
      if (
        node.getKind() === SyntaxKind.Identifier &&
        node.getStart() <= pos &&
        node.getEnd() >= pos
      ) {
        found = node;
      }
    });
    return found;
  }
  if (loc.symbol) {
    let found: Node | undefined;
    sf.forEachDescendant((node) => {
      if (found) return;
      if (
        node.getKind() === SyntaxKind.Identifier &&
        node.getText() === loc.symbol
      ) {
        found = node;
      }
    });
    return found;
  }
  return undefined;
}
