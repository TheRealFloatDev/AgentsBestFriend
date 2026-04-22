import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseFile } from "@abf/core/analysis";

interface NodeStat {
  file: string;
  depth: number;
  via: string | null;
  importedSymbols: string[];
}

const CODE_EXTS = new Set([
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
const TEST_PATTERNS = [/\.test\./, /\.spec\./, /__tests__\//, /(^|\/)tests?\//];

export function registerBlastRadiusTool(server: McpServer): void {
  server.tool(
    "abf_blast_radius",
    `Compute the transitive blast radius of a file (or symbol's defining file): which files
would be affected if it changes. BFS over the reverse-import graph with depth control and
a heuristic break-risk score.`,
    {
      file_path: z
        .string()
        .describe("Defining file (or any file you want to assess)"),
      depth: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(3)
        .describe("How many hops to traverse outward (max 5)"),
      include_tests: z
        .boolean()
        .default(true)
        .describe("Include test files in the result"),
      max_files: z
        .number()
        .int()
        .min(10)
        .max(2000)
        .default(500)
        .describe("Cap on visited files"),
    },
    async ({ file_path, depth, include_tests, max_files }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      const target = file_path.startsWith("/")
        ? file_path.slice(cwd.length + 1)
        : file_path;

      try {
        const allFiles = listGitFiles(cwd).filter((f) =>
          CODE_EXTS.has(f.slice(f.lastIndexOf("."))),
        );
        if (allFiles.length === 0) {
          return text("No code files discovered (is this a git repo?).");
        }

        // Build reverse-import index once: targetRel -> [{ source, importedSymbols }]
        const reverseIndex = buildReverseImportIndex(cwd, allFiles);

        const visited = new Map<string, NodeStat>();
        visited.set(target, {
          file: target,
          depth: 0,
          via: null,
          importedSymbols: [],
        });
        let frontier: string[] = [target];

        for (let d = 1; d <= depth; d++) {
          const next: string[] = [];
          for (const cur of frontier) {
            const importers = reverseIndex.get(normalizeKey(cur)) ?? [];
            for (const imp of importers) {
              if (visited.has(imp.source)) continue;
              if (visited.size >= max_files) break;
              visited.set(imp.source, {
                file: imp.source,
                depth: d,
                via: cur,
                importedSymbols: imp.importedSymbols,
              });
              next.push(imp.source);
            }
            if (visited.size >= max_files) break;
          }
          frontier = next;
          if (frontier.length === 0) break;
        }

        const all = Array.from(visited.values()).filter(
          (n) => n.file !== target,
        );
        const tests = all.filter((n) => isTestPath(n.file));
        const nonTests = all.filter((n) => !isTestPath(n.file));
        const shown = include_tests ? all : nonTests;

        // Risk scoring
        const distinctImportedSymbols = new Set<string>();
        for (const n of nonTests) {
          for (const s of n.importedSymbols) distinctImportedSymbols.add(s);
        }
        const riskScore = scoreRisk({
          impactedFiles: nonTests.length,
          impactedTests: tests.length,
          distinctSymbols: distinctImportedSymbols.size,
          fanOutAtDepth1: nonTests.filter((n) => n.depth === 1).length,
        });

        // Critical paths: top 5 importers at depth 1 by symbol count
        const depth1 = nonTests
          .filter((n) => n.depth === 1)
          .sort((a, b) => b.importedSymbols.length - a.importedSymbols.length)
          .slice(0, 5);

        const out: string[] = [];
        out.push(`Blast radius for ${target} (depth=${depth}):`);
        out.push(
          `  impacted files (non-test): ${nonTests.length}, tests: ${tests.length}`,
        );
        out.push(
          `  distinct exported symbols consumed by importers: ${distinctImportedSymbols.size}`,
        );
        out.push(
          `  break_risk_score: ${riskScore.score}/100 (${riskScore.label})`,
        );
        out.push("");

        if (depth1.length > 0) {
          out.push("Critical depth-1 importers (highest symbol coupling):");
          for (const n of depth1) {
            out.push(
              `  ${n.file}  uses {${n.importedSymbols.slice(0, 8).join(", ")}${n.importedSymbols.length > 8 ? ", …" : ""}}`,
            );
          }
          out.push("");
        }

        // Per-depth breakdown
        const byDepth = new Map<number, NodeStat[]>();
        for (const n of shown) {
          const list = byDepth.get(n.depth) ?? [];
          list.push(n);
          byDepth.set(n.depth, list);
        }
        const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
        for (const d of depths) {
          const list = byDepth.get(d)!;
          out.push(`Depth ${d} (${list.length} file(s)):`);
          for (const n of list.slice(0, 40)) {
            const via = n.via ? ` via ${n.via}` : "";
            out.push(`  ${n.file}${via}`);
          }
          if (list.length > 40) out.push(`  ... ${list.length - 40} more`);
          out.push("");
        }

        out.push("Recommendation:");
        out.push(`  ${riskScore.recommendation}`);

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

function buildReverseImportIndex(
  cwd: string,
  files: string[],
): Map<string, Array<{ source: string; importedSymbols: string[] }>> {
  const idx = new Map<
    string,
    Array<{ source: string; importedSymbols: string[] }>
  >();

  for (const f of files) {
    const abs = join(cwd, f);
    let content: string;
    try {
      content = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = parseFile(abs, content);
    } catch {
      continue;
    }
    for (const imp of parsed.imports) {
      if (!imp.targetPath.startsWith(".")) continue;
      const resolved = resolveImport(imp.targetPath, dirname(abs), cwd);
      if (!resolved) continue;
      const key = normalizeKey(resolved);
      const list = idx.get(key) ?? [];
      list.push({ source: f, importedSymbols: imp.importedSymbols });
      idx.set(key, list);
    }
  }
  return idx;
}

function resolveImport(
  importPath: string,
  fromDir: string,
  cwd: string,
): string | null {
  const exts = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    "/index.ts",
    "/index.js",
    "/index.tsx",
  ];
  const base = resolve(fromDir, importPath);
  for (const ext of exts) {
    const candidate = base + ext;
    if (existsSync(candidate)) {
      return candidate.startsWith(cwd)
        ? candidate.slice(cwd.length + 1)
        : candidate;
    }
  }
  return null;
}

function normalizeKey(rel: string): string {
  return rel.replace(/\.[^.]+$/, "").replace(/\/index$/, "");
}

function listGitFiles(cwd: string): string[] {
  try {
    return execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, maxBuffer: 20 * 1024 * 1024 },
    )
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isTestPath(p: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(p));
}

function scoreRisk(opts: {
  impactedFiles: number;
  impactedTests: number;
  distinctSymbols: number;
  fanOutAtDepth1: number;
}): { score: number; label: string; recommendation: string } {
  const raw =
    Math.min(40, opts.impactedFiles * 2) +
    Math.min(30, opts.distinctSymbols * 2) +
    Math.min(30, opts.fanOutAtDepth1 * 3);
  const score = Math.min(100, raw);
  let label = "low";
  let rec =
    "change is likely safe — run abf_related_tests on the modified file and proceed";
  if (score >= 70) {
    label = "high";
    rec =
      "high blast radius — split the change, gate it behind a deprecation step, and run full test suite";
  } else if (score >= 40) {
    label = "medium";
    rec =
      "non-trivial blast radius — verify exported API stability with abf_impact_typed and run targeted tests";
  }
  return { score, label, recommendation: rec };
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
