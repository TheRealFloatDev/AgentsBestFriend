import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseFile } from "@abf/core/analysis";

export function registerDependenciesTool(server: McpServer): void {
  server.tool(
    "abf_dependencies",
    "Show imports and reverse dependencies (imported_by) for a file.",
    {
      file_path: z.string().describe("Path to the file"),
      direction: z
        .enum(["imports", "imported_by", "both"])
        .default("both")
        .describe("Which direction to analyze"),
      depth: z
        .number()
        .int()
        .min(1)
        .max(3)
        .default(1)
        .describe("Depth of transitive dependencies"),
    },
    async ({ file_path, direction, depth }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      const absPath = file_path.startsWith("/")
        ? file_path
        : join(cwd, file_path);
      const relPath = file_path.startsWith("/")
        ? file_path.slice(cwd.length + 1)
        : file_path;

      try {
        const result: string[] = [];

        if (direction === "imports" || direction === "both") {
          const content = readFileSync(absPath, "utf-8");
          const parsed = parseFile(absPath, content);
          result.push(`Imports from ${relPath}:`);
          if (parsed.imports.length === 0) {
            result.push("  (none)");
          } else {
            for (const imp of parsed.imports) {
              const resolved = tryResolve(imp.targetPath, dirname(absPath));
              const syms = imp.importedSymbols.join(", ");
              const resolvedNote = resolved
                ? ` → ${resolved.slice(cwd.length + 1)}`
                : "";
              result.push(`  ${imp.targetPath} {${syms}}${resolvedNote}`);
            }
          }
        }

        if (direction === "imported_by" || direction === "both") {
          if (result.length > 0) result.push("");
          result.push(`Imported by (files that import ${relPath}):`);
          const importedBy = findImportedBy(cwd, relPath);
          if (importedBy.length === 0) {
            result.push("  (none found in tracked files)");
          } else {
            for (const entry of importedBy) {
              result.push(`  ${entry.file} — {${entry.symbols.join(", ")}}`);
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: result.join("\n") }],
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

function tryResolve(importPath: string, fromDir: string): string | null {
  if (!importPath.startsWith(".")) return null; // package import

  const extensions = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    "/index.ts",
    "/index.js",
  ];
  const base = resolve(fromDir, importPath);

  for (const ext of extensions) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface ImportedByEntry {
  file: string;
  symbols: string[];
}

function findImportedBy(cwd: string, targetRelPath: string): ImportedByEntry[] {
  // Read all files from git ls-files and check their imports
  let filePaths: string[];
  try {
    const stdout = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
    ).toString();
    filePaths = stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }

  // Only check files that could have imports (code files)
  const codeExts = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".rb",
    ".php",
  ]);

  const results: ImportedByEntry[] = [];
  const targetName = targetRelPath
    .replace(/\.[^.]+$/, "") // remove extension
    .replace(/\/index$/, ""); // remove /index

  for (const fp of filePaths) {
    const ext = fp.slice(fp.lastIndexOf("."));
    if (!codeExts.has(ext)) continue;

    try {
      const content = readFileSync(join(cwd, fp), "utf-8");
      const parsed = parseFile(join(cwd, fp), content);

      for (const imp of parsed.imports) {
        // Check if this import resolves to our target
        if (
          importMatchesTarget(imp.targetPath, fp, targetRelPath, targetName)
        ) {
          results.push({
            file: fp,
            symbols: imp.importedSymbols,
          });
          break; // one entry per file
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

function importMatchesTarget(
  importPath: string,
  sourceFile: string,
  targetRelPath: string,
  targetName: string,
): boolean {
  if (!importPath.startsWith(".")) return false;

  // Resolve the import relative to the source file
  const sourceDir = dirname(sourceFile);
  const resolved = join(sourceDir, importPath)
    .replace(/\.[^.]+$/, "") // remove extension
    .replace(/\/index$/, "");

  return (
    resolved === targetName ||
    resolved === targetRelPath.replace(/\.[^.]+$/, "")
  );
}
