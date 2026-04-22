import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { Project, SyntaxKind, ts, type Node, type SourceFile } from "ts-morph";

interface CallEdge {
  from: { file: string; symbol: string; line: number };
  to: { file: string; symbol: string; line: number };
}

const TS_EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JS_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs"]);

export function registerCallGraphTool(server: McpServer): void {
  server.tool(
    "abf_call_graph",
    `Build a call graph around a function or method (TypeScript/JavaScript only, ts-morph).
Modes:
- "callers": who calls the symbol (transitive, by depth)
- "callees": what the symbol calls (transitive, by depth)
- "both": combined view
Use this to answer "what happens when this function runs?" or "who triggers this code path?" in one call.`,
    {
      symbol: z
        .string()
        .describe(
          "Function or method name to analyze (must be defined in file_path)",
        ),
      file_path: z
        .string()
        .describe(
          "File where the symbol is defined (relative to project root or absolute)",
        ),
      direction: z
        .enum(["callers", "callees", "both"])
        .default("both")
        .describe("Which side(s) of the call graph to walk"),
      depth: z
        .number()
        .int()
        .min(1)
        .max(4)
        .default(2)
        .describe("How many transitive hops to follow"),
      max_files: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(200)
        .describe("Cap on TS/JS files loaded into the project"),
      max_edges: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .default(300)
        .describe("Cap on call edges returned"),
    },
    async ({ symbol, file_path, direction, depth, max_files, max_edges }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      const abs = isAbsolute(file_path) ? file_path : join(cwd, file_path);
      if (!existsSync(abs)) return text(`Error: file not found: ${file_path}`);

      try {
        const project = makeProject(cwd);

        // Load tracked TS/JS files (cheaper than the whole tsconfig graph)
        const files = collectFiles(cwd, max_files);
        for (const f of files) {
          if (!project.getSourceFile(f)) {
            try {
              project.addSourceFileAtPath(f);
            } catch {
              // skip unreadable
            }
          }
        }
        if (!project.getSourceFile(abs)) {
          project.addSourceFileAtPath(abs);
        }

        const root = findFunctionDefinition(project, abs, symbol);
        if (!root) {
          return text(
            `Symbol "${symbol}" not found as a function/method in ${file_path}.`,
          );
        }

        const out: string[] = [
          `Call graph for ${symbol} (${file_path}, depth=${depth}):`,
        ];

        if (direction === "callers" || direction === "both") {
          const edges = walkCallers(project, root, depth, max_edges);
          out.push("", `Callers (${edges.length}):`);
          if (edges.length === 0) out.push("  (none — likely an entry point)");
          for (const e of edges) {
            out.push(
              `  ${formatEdge(cwd, e.from)}  →  ${formatEdge(cwd, e.to)}`,
            );
          }
        }

        if (direction === "callees" || direction === "both") {
          const edges = walkCallees(project, root, depth, max_edges);
          out.push("", `Callees (${edges.length}):`);
          if (edges.length === 0) out.push("  (none — leaf function)");
          for (const e of edges) {
            out.push(
              `  ${formatEdge(cwd, e.from)}  →  ${formatEdge(cwd, e.to)}`,
            );
          }
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

function formatEdge(
  cwd: string,
  e: { file: string; symbol: string; line: number },
): string {
  const f = e.file.startsWith("/") ? relative(cwd, e.file) : e.file;
  return `${e.symbol} (${f}:L${e.line})`;
}

function makeProject(cwd: string): Project {
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

function collectFiles(cwd: string, max: number): string[] {
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
    if (rel.includes("node_modules/") || rel.startsWith("dist/")) continue;
    out.push(join(cwd, rel));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Find the function/method *declaration* node for `symbol` in the given file.
 * Supports: function declarations, arrow function or function expression
 * assigned to const/let/var, exported defaults, and class methods.
 */
function findFunctionDefinition(
  project: Project,
  abs: string,
  symbol: string,
): Node | undefined {
  const sf = project.getSourceFile(abs);
  if (!sf) return undefined;

  let found: Node | undefined;
  sf.forEachDescendant((node) => {
    if (found) return;
    if (
      node.getKind() === SyntaxKind.FunctionDeclaration ||
      node.getKind() === SyntaxKind.MethodDeclaration
    ) {
      const name = (node as any).getName?.();
      if (name === symbol) found = node;
    } else if (
      node.getKind() === SyntaxKind.VariableDeclaration ||
      node.getKind() === SyntaxKind.PropertyDeclaration
    ) {
      const name = (node as any).getName?.();
      if (name !== symbol) return;
      const init = (node as any).getInitializer?.();
      if (
        init &&
        (init.getKind() === SyntaxKind.ArrowFunction ||
          init.getKind() === SyntaxKind.FunctionExpression)
      ) {
        found = node;
      }
    }
  });
  return found;
}

/** Get the enclosing function/method node of any AST node, or undefined. */
function enclosingFunction(node: Node): Node | undefined {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    const k = cur.getKind();
    if (
      k === SyntaxKind.FunctionDeclaration ||
      k === SyntaxKind.MethodDeclaration ||
      k === SyntaxKind.FunctionExpression ||
      k === SyntaxKind.ArrowFunction
    ) {
      return cur;
    }
    cur = cur.getParent();
  }
  return undefined;
}

/** Best-effort name for a function-like node. */
function functionName(node: Node): string {
  const k = node.getKind();
  if (
    k === SyntaxKind.FunctionDeclaration ||
    k === SyntaxKind.MethodDeclaration
  ) {
    return (node as any).getName?.() ?? "<anonymous>";
  }
  if (k === SyntaxKind.FunctionExpression || k === SyntaxKind.ArrowFunction) {
    const parent = node.getParent();
    if (parent) {
      const pk = parent.getKind();
      if (
        pk === SyntaxKind.VariableDeclaration ||
        pk === SyntaxKind.PropertyAssignment ||
        pk === SyntaxKind.PropertyDeclaration
      ) {
        return (parent as any).getName?.() ?? "<anonymous>";
      }
    }
    return "<anonymous>";
  }
  return "<unknown>";
}

function nodeLocation(node: Node): { file: string; line: number } {
  const sf = node.getSourceFile();
  return {
    file: sf.getFilePath(),
    line: node.getStartLineNumber(),
  };
}

function nodeKey(node: Node): string {
  const sf = node.getSourceFile();
  return `${sf.getFilePath()}:${node.getStart()}`;
}

/**
 * BFS over callers: identifiers that reference the function and live inside
 * another function — that other function becomes the next BFS node.
 */
function walkCallers(
  project: Project,
  root: Node,
  depth: number,
  maxEdges: number,
): CallEdge[] {
  const ls = project.getLanguageService();
  const edges: CallEdge[] = [];
  const visited = new Set<string>([nodeKey(root)]);
  let frontier: Node[] = [root];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: Node[] = [];
    for (const fn of frontier) {
      const refs = safeFindRefs(ls, fn);
      for (const r of refs) {
        if (edges.length >= maxEdges) return edges;
        const refSf = r.getSourceFile();
        const refNode = refSf.getDescendantAtPos(r.getTextSpan().getStart());
        if (!refNode) continue;
        const enc = enclosingFunction(refNode);
        if (!enc) continue;
        if (nodeKey(enc) === nodeKey(fn)) continue; // self-ref
        edges.push({
          from: {
            ...nodeLocation(enc),
            symbol: functionName(enc),
          },
          to: {
            ...nodeLocation(fn),
            symbol: functionName(fn),
          },
        });
        const k = nodeKey(enc);
        if (!visited.has(k)) {
          visited.add(k);
          next.push(enc);
        }
      }
    }
    frontier = next;
  }
  return edges;
}

/** BFS over callees: walk CallExpressions inside the function body. */
function walkCallees(
  project: Project,
  root: Node,
  depth: number,
  maxEdges: number,
): CallEdge[] {
  const edges: CallEdge[] = [];
  const visited = new Set<string>([nodeKey(root)]);
  let frontier: Node[] = [root];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: Node[] = [];
    for (const fn of frontier) {
      const body = (fn as any).getBody?.() ?? fn;
      if (!body) continue;
      body.forEachDescendant((node: Node) => {
        if (edges.length >= maxEdges) return;
        if (node.getKind() !== SyntaxKind.CallExpression) return;
        const expr = (node as any).getExpression?.();
        if (!expr) return;

        // Resolve symbol → declaration
        const sym = expr.getSymbol?.();
        const decls = sym?.getDeclarations?.() ?? [];
        const target = decls.find((d: Node) => isFunctionLike(d));
        if (!target) return;

        edges.push({
          from: {
            ...nodeLocation(fn),
            symbol: functionName(fn),
          },
          to: {
            ...nodeLocation(target),
            symbol: functionName(target),
          },
        });
        const k = nodeKey(target);
        if (!visited.has(k)) {
          visited.add(k);
          next.push(target);
        }
      });
    }
    frontier = next;
  }
  return edges;
}

function isFunctionLike(node: Node): boolean {
  const k = node.getKind();
  return (
    k === SyntaxKind.FunctionDeclaration ||
    k === SyntaxKind.MethodDeclaration ||
    k === SyntaxKind.FunctionExpression ||
    k === SyntaxKind.ArrowFunction
  );
}

function safeFindRefs(
  ls: ReturnType<Project["getLanguageService"]>,
  node: Node,
): { getSourceFile(): SourceFile; getTextSpan(): { getStart(): number } }[] {
  try {
    const all = ls.findReferences(node);
    const out: any[] = [];
    for (const r of all) {
      for (const ref of r.getReferences()) {
        if (ref.isDefinition()) continue;
        out.push(ref);
      }
    }
    return out;
  } catch {
    return [];
  }
}
