import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Project, SyntaxKind, Node } from "ts-morph";
import { ripgrepSearch } from "@abf/core/search";

type RefKind =
  | "definition"
  | "import"
  | "export"
  | "call"
  | "type_ref"
  | "jsx"
  | "reference";

interface TypedRef {
  file: string;
  line: number;
  column: number;
  kind: RefKind;
  confidence: "high" | "medium" | "low";
  preview: string;
}

const TS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export function registerImpactTypedTool(server: McpServer): void {
  server.tool(
    "abf_impact_typed",
    `AST-aware impact analysis for TS/JS — eliminates string/comment false positives.
For non-TS/JS files, falls back to enriched ripgrep with comment filtering.
Use this BEFORE renaming or removing a symbol when accuracy matters.`,
    {
      symbol: z
        .string()
        .describe("Symbol name (function, class, variable, type)"),
      file_path: z
        .string()
        .optional()
        .describe(
          "Optional: scope analysis to references reachable from this file's import graph",
        ),
      include_kinds: z
        .array(
          z.enum([
            "definition",
            "import",
            "export",
            "call",
            "type_ref",
            "jsx",
            "reference",
          ]),
        )
        .optional()
        .describe("Restrict result kinds. Default: all."),
      max_files: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(150)
        .describe("Cap on files analyzed"),
    },
    async ({ symbol, file_path, include_kinds, max_files }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      const allow =
        include_kinds && include_kinds.length > 0
          ? new Set<RefKind>(include_kinds as RefKind[])
          : null;

      try {
        // Step 1: narrow candidate file set with ripgrep (cheap, broad)
        const candidates = await ripgrepSearch({
          query: `\\b${escapeRegex(symbol)}\\b`,
          cwd,
          maxResults: 5000,
          regex: true,
          contextLines: 0,
        });

        if (candidates.matches.length === 0) {
          return text(`No references found for "${symbol}".`);
        }

        // Bucket by file, dedupe
        const filesSeen = new Set<string>();
        for (const m of candidates.matches) filesSeen.add(m.filePath);

        // Optional scope filter: only files in the import graph of file_path
        let scopedFiles: Set<string> | null = null;
        if (file_path) {
          scopedFiles = computeImportClosure(cwd, file_path, max_files);
        }

        const files = Array.from(filesSeen)
          .filter((f) => (scopedFiles ? scopedFiles.has(f) : true))
          .slice(0, max_files);

        // Step 2: typed analysis per file
        const project = new Project({
          useInMemoryFileSystem: true,
          compilerOptions: { allowJs: true, jsx: 1 },
        });
        const refs: TypedRef[] = [];

        for (const rel of files) {
          const abs = join(cwd, rel);
          if (!existsSync(abs)) continue;
          const ext = rel.slice(rel.lastIndexOf("."));
          let content: string;
          try {
            content = readFileSync(abs, "utf-8");
          } catch {
            continue;
          }

          if (TS_EXTS.has(ext)) {
            extractTypedTsRefs(project, rel, content, symbol, refs);
          } else {
            extractFallbackRefs(rel, content, symbol, refs);
          }
        }

        // Filter by include_kinds
        const filtered = allow ? refs.filter((r) => allow.has(r.kind)) : refs;

        if (filtered.length === 0) {
          return text(
            `No typed references for "${symbol}" after AST verification (raw candidates: ${candidates.matches.length}).`,
          );
        }

        // Group by file
        const byFile = new Map<string, TypedRef[]>();
        for (const r of filtered) {
          const list = byFile.get(r.file) ?? [];
          list.push(r);
          byFile.set(r.file, list);
        }

        const out: string[] = [];
        out.push(
          `${filtered.length} typed reference(s) to "${symbol}" in ${byFile.size} file(s)` +
            (file_path ? ` (scoped to import closure of ${file_path})` : "") +
            `:`,
        );
        out.push("");
        for (const [file, list] of byFile) {
          out.push(`${file}:`);
          for (const r of list.slice(0, 50)) {
            out.push(
              `  L${r.line}:${r.column} [${r.kind}/${r.confidence}] ${truncate(r.preview, 100)}`,
            );
          }
          if (list.length > 50) {
            out.push(`  ... ${list.length - 50} more`);
          }
        }

        const counts = new Map<RefKind, number>();
        for (const r of filtered)
          counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
        out.push("");
        out.push(
          "Summary: " +
            Array.from(counts.entries())
              .map(([k, v]) => `${k}=${v}`)
              .join(", "),
        );

        return text(out.join("\n"));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

function extractTypedTsRefs(
  project: Project,
  relPath: string,
  content: string,
  symbol: string,
  refs: TypedRef[],
): void {
  const ext = relPath.slice(relPath.lastIndexOf("."));
  const safeExt =
    ext === ".tsx"
      ? ".tsx"
      : ext === ".jsx"
        ? ".jsx"
        : ext === ".js" || ext === ".mjs" || ext === ".cjs"
          ? ".js"
          : ".ts";
  const tempName = `__abf_typed_${Date.now()}_${Math.random().toString(36).slice(2)}${safeExt}`;
  let sourceFile;
  try {
    sourceFile = project.createSourceFile(tempName, content, {
      overwrite: true,
    });
  } catch {
    // ts-morph could not parse — fall back
    extractFallbackRefs(relPath, content, symbol, refs);
    return;
  }

  try {
    sourceFile.forEachDescendant((node: Node) => {
      if (node.getKind() !== SyntaxKind.Identifier) return;
      if (node.getText() !== symbol) return;

      const start = node.getStart();
      const { line, column } = sourceFile.getLineAndColumnAtPos(start);
      const lineText =
        sourceFile.getFullText().split("\n")[line - 1]?.trim() ?? "";

      const kind = classifyTsNode(node);
      refs.push({
        file: relPath,
        line,
        column,
        kind,
        confidence: "high",
        preview: lineText,
      });
    });
  } finally {
    project.removeSourceFile(sourceFile);
  }
}

function classifyTsNode(node: Node): RefKind {
  const parent = node.getParent();
  if (!parent) return "reference";
  const pk = parent.getKind();

  // Definitions
  if (
    pk === SyntaxKind.FunctionDeclaration ||
    pk === SyntaxKind.ClassDeclaration ||
    pk === SyntaxKind.InterfaceDeclaration ||
    pk === SyntaxKind.TypeAliasDeclaration ||
    pk === SyntaxKind.EnumDeclaration ||
    pk === SyntaxKind.MethodDeclaration ||
    pk === SyntaxKind.MethodSignature ||
    pk === SyntaxKind.PropertyDeclaration ||
    pk === SyntaxKind.PropertySignature
  ) {
    // Identifier is name of declaration when parent.getNameNode?.() === node
    const named = (parent as any).getNameNode?.();
    if (named && named === node) return "definition";
  }
  if (pk === SyntaxKind.VariableDeclaration) {
    const named = (parent as any).getNameNode?.();
    if (named && named === node) return "definition";
  }

  // Imports
  if (
    pk === SyntaxKind.ImportSpecifier ||
    pk === SyntaxKind.ImportClause ||
    pk === SyntaxKind.NamespaceImport
  ) {
    return "import";
  }
  // Export specifiers
  if (pk === SyntaxKind.ExportSpecifier) return "export";

  // Type references
  if (
    pk === SyntaxKind.TypeReference ||
    pk === SyntaxKind.ExpressionWithTypeArguments ||
    pk === SyntaxKind.HeritageClause
  ) {
    return "type_ref";
  }

  // JSX usage
  if (
    pk === SyntaxKind.JsxOpeningElement ||
    pk === SyntaxKind.JsxClosingElement ||
    pk === SyntaxKind.JsxSelfClosingElement
  ) {
    return "jsx";
  }

  // Calls: Identifier is the expression of a CallExpression
  if (pk === SyntaxKind.CallExpression) {
    const expr = (parent as any).getExpression?.();
    if (expr === node) return "call";
  }

  return "reference";
}

function extractFallbackRefs(
  relPath: string,
  content: string,
  symbol: string,
  refs: TypedRef[],
): void {
  const lines = content.split("\n");
  const re = new RegExp(`\\b${escapeRegex(symbol)}\\b`);
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (!re.test(lineText)) continue;
    const trimmed = lineText.trim();
    // Skip obvious comment lines
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("*")
    ) {
      continue;
    }
    refs.push({
      file: relPath,
      line: i + 1,
      column: lineText.indexOf(symbol) + 1,
      kind: classifyByLine(trimmed, symbol),
      confidence: "low",
      preview: trimmed,
    });
  }
}

function classifyByLine(line: string, name: string): RefKind {
  if (/^import\b|^from\b|require\(/.test(line)) return "import";
  if (
    new RegExp(
      `^(export\\s+)?(class|interface|type|enum|function|const|let|var|def)\\s+${escapeRegex(name)}\\b`,
    ).test(line)
  ) {
    return "definition";
  }
  if (new RegExp(`${escapeRegex(name)}\\s*\\(`).test(line)) return "call";
  return "reference";
}

function computeImportClosure(
  cwd: string,
  filePath: string,
  maxFiles: number,
): Set<string> {
  // Reverse-import closure: files that (transitively) import filePath plus the file itself.
  const out = new Set<string>();
  const target = filePath.startsWith("/")
    ? filePath.slice(cwd.length + 1)
    : filePath;
  out.add(target);

  let allFiles: string[];
  try {
    allFiles = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
    )
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return out;
  }

  // Cheap heuristic closure: any file whose content references the target file's basename
  // without extension. Avoids parsing the whole repo.
  const baseName = target
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "");
  const re = new RegExp(`\\b${escapeRegex(baseName)}\\b`);
  for (const f of allFiles) {
    if (out.size >= maxFiles) break;
    try {
      const c = readFileSync(join(cwd, f), "utf-8");
      if (re.test(c)) out.add(f);
    } catch {
      // ignore
    }
  }
  return out;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
