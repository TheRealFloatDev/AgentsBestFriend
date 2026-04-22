import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "@abf/core/analysis";
import type { ParsedSymbol } from "@abf/core/analysis";
import { ripgrepSearch } from "@abf/core/search";

interface SymbolDelta {
  name: string;
  kind: string;
  change: "added" | "removed" | "modified" | "moved";
  oldRange?: string;
  newRange?: string;
  exported: boolean;
}

export function registerPreviewChangesTool(server: McpServer): void {
  server.tool(
    "abf_preview_changes",
    `Preview a planned file change WITHOUT writing to disk. Returns a structured diff plus
symbol-level deltas, exported-API impact warnings, and a quick external-usage probe for
removed/renamed exports. Use BEFORE editing to validate scope and risk.`,
    {
      file_path: z.string().describe("Target file path (relative or absolute)"),
      new_content: z.string().describe("Full proposed new content of the file"),
      old_content: z
        .string()
        .optional()
        .describe(
          "Optional explicit old content. If omitted, the file is read from disk.",
        ),
      probe_external_usage: z
        .boolean()
        .default(true)
        .describe(
          "If true, run a quick repo-wide ripgrep for removed/renamed exported symbols.",
        ),
      max_diff_hunks: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(40)
        .describe("Cap the number of diff hunks returned"),
    },
    async ({
      file_path,
      new_content,
      old_content,
      probe_external_usage,
      max_diff_hunks,
    }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      const absPath = file_path.startsWith("/")
        ? file_path
        : join(cwd, file_path);

      try {
        let resolvedOld = old_content;
        if (resolvedOld === undefined) {
          if (!existsSync(absPath)) {
            resolvedOld = "";
          } else {
            resolvedOld = readFileSync(absPath, "utf-8");
          }
        }

        const oldLines = resolvedOld.split("\n");
        const newLines = new_content.split("\n");

        const oldParsed = safeParse(absPath, resolvedOld);
        const newParsed = safeParse(absPath, new_content);

        const symbolDeltas = diffSymbols(oldParsed.symbols, newParsed.symbols);
        const importDeltas = diffImports(
          oldParsed.imports.map((i) => i.targetPath),
          newParsed.imports.map((i) => i.targetPath),
        );
        const hunks = computeHunks(oldLines, newLines, max_diff_hunks);

        // External-usage probe for removed or renamed EXPORTED symbols only
        const externalUsage: Array<{ symbol: string; references: number }> = [];
        if (probe_external_usage) {
          const candidates = symbolDeltas.filter(
            (d) =>
              d.exported && (d.change === "removed" || d.change === "modified"),
          );
          for (const c of candidates.slice(0, 10)) {
            const probe = await ripgrepSearch({
              query: `\\b${escapeRegex(c.name)}\\b`,
              cwd,
              maxResults: 200,
              regex: true,
              contextLines: 0,
            });
            // Exclude matches inside the target file itself
            const external = probe.matches.filter(
              (m) => !absPath.endsWith(m.filePath),
            );
            externalUsage.push({
              symbol: c.name,
              references: external.length,
            });
          }
        }

        const riskFlags = buildRiskFlags(symbolDeltas, externalUsage);
        const suggestedChecks = buildSuggestedChecks(
          symbolDeltas,
          importDeltas,
        );

        const out: string[] = [];
        out.push(`Preview for ${file_path}`);
        out.push(
          `Lines: ${oldLines.length} -> ${newLines.length} (${signed(newLines.length - oldLines.length)})`,
        );
        out.push("");

        out.push("Symbol changes:");
        if (symbolDeltas.length === 0) {
          out.push("  (none detected)");
        } else {
          for (const d of symbolDeltas) {
            const tag = d.exported ? "exported " : "";
            const range =
              d.change === "added"
                ? d.newRange
                : d.change === "removed"
                  ? d.oldRange
                  : `${d.oldRange} -> ${d.newRange}`;
            out.push(`  [${d.change}] ${tag}${d.kind} ${d.name} (${range})`);
          }
        }
        out.push("");

        out.push("Import changes:");
        if (
          importDeltas.added.length === 0 &&
          importDeltas.removed.length === 0
        ) {
          out.push("  (none)");
        } else {
          for (const a of importDeltas.added) out.push(`  + ${a}`);
          for (const r of importDeltas.removed) out.push(`  - ${r}`);
        }
        out.push("");

        if (externalUsage.length > 0) {
          out.push("External usage probe (exported symbols affected):");
          for (const u of externalUsage) {
            const note =
              u.references === 0
                ? "no external references"
                : `${u.references} possible external references`;
            out.push(`  ${u.symbol}: ${note}`);
          }
          out.push("");
        }

        out.push("Risk flags:");
        if (riskFlags.length === 0) out.push("  (none)");
        else for (const r of riskFlags) out.push(`  - ${r}`);
        out.push("");

        out.push("Suggested checks:");
        for (const s of suggestedChecks) out.push(`  - ${s}`);
        out.push("");

        out.push(
          `Diff hunks (${hunks.shown} of ${hunks.total}${hunks.truncated ? ", truncated" : ""}):`,
        );
        for (const h of hunks.lines) out.push(h);

        return {
          content: [{ type: "text" as const, text: out.join("\n") }],
        };
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

function safeParse(filePath: string, content: string) {
  try {
    return parseFile(filePath, content);
  } catch {
    return { symbols: [] as ParsedSymbol[], imports: [] };
  }
}

function diffSymbols(
  oldSyms: ParsedSymbol[],
  newSyms: ParsedSymbol[],
): SymbolDelta[] {
  const flat = (xs: ParsedSymbol[]): ParsedSymbol[] => {
    const out: ParsedSymbol[] = [];
    const walk = (s: ParsedSymbol) => {
      out.push(s);
      for (const c of s.children) walk(c);
    };
    for (const s of xs) walk(s);
    return out;
  };

  const oldFlat = flat(oldSyms);
  const newFlat = flat(newSyms);
  const keyOf = (s: ParsedSymbol) => `${s.kind}::${s.name}`;
  const oldMap = new Map(oldFlat.map((s) => [keyOf(s), s]));
  const newMap = new Map(newFlat.map((s) => [keyOf(s), s]));

  const deltas: SymbolDelta[] = [];

  for (const [key, oldSym] of oldMap) {
    const newSym = newMap.get(key);
    if (!newSym) {
      deltas.push({
        name: oldSym.name,
        kind: oldSym.kind,
        change: "removed",
        oldRange: `L${oldSym.startLine}-${oldSym.endLine}`,
        exported: oldSym.exported,
      });
      continue;
    }
    const movedOrResized =
      oldSym.startLine !== newSym.startLine ||
      oldSym.endLine !== newSym.endLine;
    if (movedOrResized) {
      deltas.push({
        name: newSym.name,
        kind: newSym.kind,
        change:
          oldSym.endLine - oldSym.startLine ===
          newSym.endLine - newSym.startLine
            ? "moved"
            : "modified",
        oldRange: `L${oldSym.startLine}-${oldSym.endLine}`,
        newRange: `L${newSym.startLine}-${newSym.endLine}`,
        exported: newSym.exported,
      });
    }
  }

  for (const [key, newSym] of newMap) {
    if (!oldMap.has(key)) {
      deltas.push({
        name: newSym.name,
        kind: newSym.kind,
        change: "added",
        newRange: `L${newSym.startLine}-${newSym.endLine}`,
        exported: newSym.exported,
      });
    }
  }

  return deltas;
}

function diffImports(oldPaths: string[], newPaths: string[]) {
  const oldSet = new Set(oldPaths);
  const newSet = new Set(newPaths);
  const added: string[] = [];
  const removed: string[] = [];
  for (const p of newSet) if (!oldSet.has(p)) added.push(p);
  for (const p of oldSet) if (!newSet.has(p)) removed.push(p);
  return { added, removed };
}

function computeHunks(oldLines: string[], newLines: string[], cap: number) {
  // Minimal LCS-based diff producing unified-like hunks. Good enough for previews
  // up to a few thousand lines.
  const ops = lcsDiff(oldLines, newLines);
  const lines: string[] = [];
  let total = 0;
  let shown = 0;
  let truncated = false;

  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === "equal") {
      i++;
      continue;
    }
    total++;
    if (shown >= cap) {
      truncated = true;
      // still scan to count
      let j = i;
      while (j < ops.length && ops[j].kind !== "equal") j++;
      i = j;
      while (i < ops.length) {
        if (ops[i].kind !== "equal") {
          // start of a new hunk
          let k = i;
          while (k < ops.length && ops[k].kind !== "equal") k++;
          total++;
          i = k;
        } else {
          i++;
        }
      }
      break;
    }

    const startOld = ops[i].oldIndex ?? 0;
    const startNew = ops[i].newIndex ?? 0;
    let removedCount = 0;
    let addedCount = 0;
    const buf: string[] = [];
    while (i < ops.length && ops[i].kind !== "equal") {
      const op = ops[i];
      if (op.kind === "remove") {
        buf.push(`- ${op.text}`);
        removedCount++;
      } else if (op.kind === "add") {
        buf.push(`+ ${op.text}`);
        addedCount++;
      }
      i++;
    }
    lines.push(
      `@@ -${startOld + 1},${removedCount} +${startNew + 1},${addedCount} @@`,
    );
    for (const l of buf) lines.push(l);
    shown++;
  }

  return { lines, total, shown, truncated };
}

type DiffOp =
  | { kind: "equal"; text: string; oldIndex: number; newIndex: number }
  | { kind: "add"; text: string; newIndex: number; oldIndex?: number }
  | { kind: "remove"; text: string; oldIndex: number; newIndex?: number };

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // For very large files cap to avoid quadratic blow-up; degrade to line equality scan.
  if (n * m > 2_000_000) {
    return naiveDiff(a, b);
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "equal", text: a[i], oldIndex: i, newIndex: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "remove", text: a[i], oldIndex: i, newIndex: j });
      i++;
    } else {
      ops.push({ kind: "add", text: b[j], oldIndex: i, newIndex: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "remove", text: a[i], oldIndex: i, newIndex: j });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "add", text: b[j], oldIndex: i, newIndex: j });
    j++;
  }
  return ops;
}

function naiveDiff(a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const len = Math.max(a.length, b.length);
  for (let k = 0; k < len; k++) {
    if (k < a.length && k < b.length && a[k] === b[k]) {
      ops.push({ kind: "equal", text: a[k], oldIndex: k, newIndex: k });
    } else {
      if (k < a.length)
        ops.push({ kind: "remove", text: a[k], oldIndex: k, newIndex: k });
      if (k < b.length)
        ops.push({ kind: "add", text: b[k], oldIndex: k, newIndex: k });
    }
  }
  return ops;
}

function buildRiskFlags(
  deltas: SymbolDelta[],
  externalUsage: Array<{ symbol: string; references: number }>,
): string[] {
  const flags: string[] = [];
  const removedExports = deltas.filter(
    (d) => d.exported && d.change === "removed",
  );
  if (removedExports.length > 0) {
    flags.push(
      `breaking: ${removedExports.length} exported symbol(s) removed: ${removedExports
        .map((d) => d.name)
        .join(", ")}`,
    );
  }
  const modifiedExports = deltas.filter(
    (d) => d.exported && d.change === "modified",
  );
  if (modifiedExports.length > 0) {
    flags.push(
      `signature-risk: ${modifiedExports.length} exported symbol(s) modified: ${modifiedExports
        .map((d) => d.name)
        .join(", ")}`,
    );
  }
  for (const u of externalUsage) {
    if (u.references > 0) {
      flags.push(
        `external-usage: ${u.symbol} has ${u.references} possible external reference(s) — verify before merging`,
      );
    }
  }
  return flags;
}

function buildSuggestedChecks(
  deltas: SymbolDelta[],
  importDeltas: { added: string[]; removed: string[] },
): string[] {
  const checks: string[] = [];
  if (deltas.some((d) => d.exported)) {
    checks.push(
      "run abf_impact_typed on each modified/removed exported symbol",
    );
  }
  if (importDeltas.added.length > 0 || importDeltas.removed.length > 0) {
    checks.push("run abf_dependencies to confirm import graph is still valid");
  }
  if (deltas.length > 0) {
    checks.push("run abf_related_tests on the changed file");
  }
  if (checks.length === 0) {
    checks.push("changes look local — a focused unit test re-run is enough");
  }
  return checks;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}
