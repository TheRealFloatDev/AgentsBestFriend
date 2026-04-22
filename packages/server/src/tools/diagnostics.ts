import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { Project, ts } from "ts-morph";

const TS_EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JS_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs"]);

export function registerDiagnosticsTool(server: McpServer): void {
  server.tool(
    "abf_diagnostics",
    `Run TypeScript diagnostics on a single file or every git-tracked TS/JS file.
Surfaces type errors, missing imports, and other compile-time issues without running a full build.
Use this AFTER editing TS/JS code to verify correctness before declaring a task done.`,
    {
      file_path: z
        .string()
        .optional()
        .describe(
          "Optional: scope diagnostics to a single file. Otherwise scans all tracked TS/JS files (capped).",
        ),
      max_files: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .default(200)
        .describe("Cap on files when no file_path is given"),
      max_diagnostics: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe("Cap on diagnostics returned"),
      include_warnings: z
        .boolean()
        .default(true)
        .describe("Include suggestion/warning category diagnostics"),
    },
    async ({ file_path, max_files, max_diagnostics, include_warnings }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();

      try {
        const tsconfig = findNearestTsconfig(cwd, file_path);

        const project = new Project({
          tsConfigFilePath: tsconfig ?? undefined,
          skipAddingFilesFromTsConfig: true,
          skipFileDependencyResolution: false,
          compilerOptions: tsconfig
            ? undefined
            : {
                allowJs: true,
                checkJs: false,
                noEmit: true,
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                strict: false,
              },
        });

        const targets = collectTargets(cwd, file_path, max_files);
        if (targets.length === 0) {
          return text("No TypeScript or JavaScript files found to diagnose.");
        }

        for (const abs of targets) {
          if (!project.getSourceFile(abs)) {
            try {
              project.addSourceFileAtPath(abs);
            } catch {
              // ignore unreadable files
            }
          }
        }

        const diagnostics = project.getPreEmitDiagnostics();

        type Row = {
          file: string;
          line: number;
          column: number;
          code: number;
          category: string;
          message: string;
        };

        const rows: Row[] = [];
        for (const diag of diagnostics) {
          if (rows.length >= max_diagnostics) break;
          const sf = diag.getSourceFile();
          if (!sf) continue;
          const abs = sf.getFilePath();

          // Filter to requested scope
          if (file_path) {
            const wanted = absolutize(cwd, file_path);
            if (abs !== wanted) continue;
          }
          // Skip node_modules noise
          if (abs.includes("/node_modules/")) continue;

          const start = diag.getStart();
          let line = 0;
          let column = 0;
          if (start !== undefined) {
            const lc = sf.getLineAndColumnAtPos(start);
            line = lc.line;
            column = lc.column;
          }

          const category = ts.DiagnosticCategory[diag.getCategory()];
          if (
            !include_warnings &&
            (category === "Suggestion" || category === "Message")
          ) {
            continue;
          }

          const messageText = diag.getMessageText();
          const message =
            typeof messageText === "string"
              ? messageText
              : messageText.getMessageText();

          rows.push({
            file: relative(cwd, abs),
            line,
            column,
            code: diag.getCode(),
            category,
            message,
          });
        }

        if (rows.length === 0) {
          return text(
            file_path
              ? `No diagnostics for ${file_path}.`
              : `No diagnostics across ${targets.length} file(s). ✓`,
          );
        }

        const errorCount = rows.filter((r) => r.category === "Error").length;
        const warnCount = rows.filter((r) => r.category === "Warning").length;
        const infoCount = rows.length - errorCount - warnCount;

        const lines: string[] = [
          `Diagnostics: ${errorCount} error(s), ${warnCount} warning(s), ${infoCount} info — across ${targets.length} file(s)${tsconfig ? ` (tsconfig: ${relative(cwd, tsconfig)})` : " (default compiler options)"}`,
          "",
        ];

        // Group by file
        const byFile = new Map<string, Row[]>();
        for (const r of rows) {
          const list = byFile.get(r.file) ?? [];
          list.push(r);
          byFile.set(r.file, list);
        }

        for (const [file, list] of byFile) {
          lines.push(`${file}:`);
          for (const r of list) {
            lines.push(
              `  L${r.line}:${r.column} [${r.category}/TS${r.code}] ${r.message}`,
            );
          }
        }

        if (diagnostics.length > rows.length) {
          lines.push(
            "",
            `(truncated: ${diagnostics.length - rows.length} more diagnostic(s) not shown)`,
          );
        }

        return text(lines.join("\n"));
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

function absolutize(cwd: string, p: string): string {
  return isAbsolute(p) ? p : join(cwd, p);
}

function collectTargets(
  cwd: string,
  filePath: string | undefined,
  maxFiles: number,
): string[] {
  if (filePath) {
    const abs = absolutize(cwd, filePath);
    return existsSync(abs) ? [abs] : [];
  }

  let files: string[] = [];
  try {
    const stdout = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, maxBuffer: 20 * 1024 * 1024 },
    ).toString();
    files = stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const rel of files) {
    const ext = rel.slice(rel.lastIndexOf("."));
    if (!TS_EXTS.has(ext) && !JS_EXTS.has(ext)) continue;
    if (rel.includes("node_modules/")) continue;
    if (rel.includes("/dist/") || rel.startsWith("dist/")) continue;
    out.push(join(cwd, rel));
    if (out.length >= maxFiles) break;
  }
  return out;
}

function findNearestTsconfig(
  cwd: string,
  filePath: string | undefined,
): string | null {
  // Walk upward from the file (or cwd) to find a tsconfig.json
  const start = filePath ? absolutize(cwd, filePath) : cwd;
  let dir =
    existsSync(start) && start.endsWith(".ts")
      ? start.slice(0, start.lastIndexOf("/"))
      : start;

  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    if (!parent || parent === dir) break;
    dir = parent;
  }
  // Last resort: project root tsconfig
  const rootTs = join(cwd, "tsconfig.json");
  return existsSync(rootTs) ? rootTs : null;
}
