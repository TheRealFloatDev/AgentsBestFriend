import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { parseFile } from "@abf/core/analysis";

interface TestCandidate {
  file: string;
  score: number;
  reasons: string[];
}

const TEST_FILE_RE = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /_test\.py$/,
  /^test_.*\.py$/,
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /\.test\.go$/,
  /_test\.go$/,
  /Test\.java$/,
  /Tests?\.java$/,
  /\.test\.rs$/,
  /(^|\/)spec\//,
];

export function registerRelatedTestsTool(server: McpServer): void {
  server.tool(
    "abf_related_tests",
    `Find tests that likely cover a given file or symbol. Heuristic ranking based on:
file name match, test-file imports of the source, and direct mention of the symbol name in test code.`,
    {
      file_path: z
        .string()
        .optional()
        .describe("Source file to find related tests for"),
      symbol: z
        .string()
        .optional()
        .describe("Symbol name to look for inside test files"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Cap on returned tests"),
    },
    async ({ file_path, symbol, max_results }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      if (!file_path && !symbol) {
        return errorOut("Provide at least one of file_path or symbol.");
      }

      try {
        const allFiles = listGitFiles(cwd);
        const testFiles = allFiles.filter(isTestFile);
        if (testFiles.length === 0) {
          return text("No test files detected by convention in this repo.");
        }

        const targetRel = file_path
          ? file_path.startsWith("/")
            ? file_path.slice(cwd.length + 1)
            : file_path
          : null;

        const targetBase = targetRel
          ? basename(targetRel).replace(/\.[^.]+$/, "")
          : null;

        const candidates = new Map<string, TestCandidate>();

        const addReason = (file: string, reason: string, score: number) => {
          const c = candidates.get(file) ?? {
            file,
            score: 0,
            reasons: [],
          };
          c.score += score;
          c.reasons.push(reason);
          candidates.set(file, c);
        };

        for (const tf of testFiles) {
          const abs = join(cwd, tf);
          if (!existsSync(abs)) continue;
          let content: string;
          try {
            content = readFileSync(abs, "utf-8");
          } catch {
            continue;
          }

          // Reason 1: name match between test file and source file
          if (targetBase) {
            const tfBase = basename(tf).replace(/\.[^.]+$/, "");
            // tfBase typically looks like "foo.test" or "test_foo"
            const tfCore = tfBase
              .replace(/\.test$/, "")
              .replace(/\.spec$/, "")
              .replace(/^test_/, "")
              .replace(/_test$/, "");
            if (tfCore === targetBase) {
              addReason(tf, `name match (${tfBase} ↔ ${targetBase})`, 60);
            } else if (tfCore.toLowerCase() === targetBase.toLowerCase()) {
              addReason(tf, "case-insensitive name match", 40);
            }
          }

          // Reason 2: import of the source file
          if (targetRel) {
            try {
              const parsed = parseFile(abs, content);
              for (const imp of parsed.imports) {
                if (!imp.targetPath.startsWith(".")) continue;
                const resolved = resolveImport(
                  imp.targetPath,
                  dirname(abs),
                  cwd,
                );
                if (!resolved) continue;
                const k = resolved.replace(/\.[^.]+$/, "");
                const t = targetRel.replace(/\.[^.]+$/, "");
                if (
                  k === t ||
                  k === t.replace(/\/index$/, "") ||
                  k.endsWith(`/${basename(t)}`)
                ) {
                  addReason(tf, `imports source (${imp.targetPath})`, 50);
                  break;
                }
              }
            } catch {
              // ignore parse errors
            }
          }

          // Reason 3: direct symbol mention
          if (symbol) {
            const re = new RegExp(`\\b${escapeRegex(symbol)}\\b`);
            if (re.test(content)) {
              const occurrences =
                content.match(new RegExp(`\\b${escapeRegex(symbol)}\\b`, "g"))
                  ?.length ?? 0;
              const bonus = Math.min(40, 20 + occurrences * 2);
              addReason(tf, `mentions "${symbol}" ×${occurrences}`, bonus);
            }
          }
        }

        const ranked = Array.from(candidates.values())
          .filter((c) => c.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, max_results);

        if (ranked.length === 0) {
          return text(
            `No related tests detected for ${targetRel ?? symbol ?? "input"}.`,
          );
        }

        const out: string[] = [];
        out.push(
          `Related tests (${ranked.length} of ${candidates.size}, ranked by relevance):`,
        );
        for (const c of ranked) {
          const relLabel = relevanceLabel(c.score);
          out.push(`  [${relLabel}/${c.score}] ${c.file}`);
          for (const r of c.reasons) out.push(`     - ${r}`);
        }
        return text(out.join("\n"));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorOut(msg);
      }
    },
  );
}

function isTestFile(p: string): boolean {
  return TEST_FILE_RE.some((re) => re.test(p));
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

function relevanceLabel(score: number): string {
  if (score >= 80) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function errorOut(msg: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}
