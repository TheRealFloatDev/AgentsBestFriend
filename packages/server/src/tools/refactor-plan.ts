import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseFile } from "@abf/core/analysis";
import type { ParsedSymbol } from "@abf/core/analysis";
import { ripgrepSearch } from "@abf/core/search";

interface PlannedEdit {
  file: string;
  line: number;
  kind: "definition" | "import" | "export" | "call" | "type_ref" | "reference";
  preview: string;
}

export function registerRefactorPlanTool(server: McpServer): void {
  server.tool(
    "abf_refactor_plan",
    `Generate a SAFE, ORDERED edit plan for a refactoring intent — read-only. Does NOT modify files.
Currently supports:
  - rename: rename a symbol across the repo (best-effort, name-based)
Other intents (move, extract, split) return a structured guidance plan.`,
    {
      intent: z
        .enum(["rename", "move", "extract", "split"])
        .describe("Refactoring intent"),
      file_path: z.string().describe("File where the target symbol is defined"),
      target_symbol: z.string().describe("Name of the symbol to refactor"),
      new_name: z
        .string()
        .optional()
        .describe('New name (required for intent "rename")'),
      new_path: z
        .string()
        .optional()
        .describe('Destination path (required for intent "move")'),
      max_files: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe("Cap on files included in the plan"),
    },
    async ({
      intent,
      file_path,
      target_symbol,
      new_name,
      new_path,
      max_files,
    }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      const absPath = file_path.startsWith("/")
        ? file_path
        : join(cwd, file_path);
      const relPath = absPath.startsWith(cwd)
        ? absPath.slice(cwd.length + 1)
        : file_path;

      try {
        if (!existsSync(absPath)) {
          return errorOut(`File not found: ${file_path}`);
        }

        const content = readFileSync(absPath, "utf-8");
        const { symbols } = parseFile(absPath, content);
        const target = findSymbol(symbols, target_symbol);

        if (!target) {
          return errorOut(
            `Symbol "${target_symbol}" not found in ${file_path}. ` +
              `Available: ${symbols
                .map((s) => `${s.kind} ${s.name}`)
                .slice(0, 20)
                .join(", ")}`,
          );
        }

        if (intent === "rename") {
          if (!new_name) {
            return errorOut('intent "rename" requires "new_name"');
          }
          return await planRename({
            cwd,
            relPath,
            target,
            newName: new_name,
            maxFiles: max_files,
          });
        }

        if (intent === "move") {
          if (!new_path) {
            return errorOut('intent "move" requires "new_path"');
          }
          return planMove({
            cwd,
            relPath,
            target,
            newPath: new_path,
          });
        }

        // extract / split — guidance plan only
        return planGuidance(intent, relPath, target);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorOut(msg);
      }
    },
  );
}

function findSymbol(syms: ParsedSymbol[], name: string): ParsedSymbol | null {
  for (const s of syms) {
    if (s.name === name) return s;
    const child = findSymbol(s.children, name);
    if (child) return child;
  }
  return null;
}

async function planRename(opts: {
  cwd: string;
  relPath: string;
  target: ParsedSymbol;
  newName: string;
  maxFiles: number;
}) {
  const { cwd, relPath, target, newName, maxFiles } = opts;

  // Validate identifier shape
  const identOk = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName);
  const out: string[] = [];
  out.push(`Refactor plan: rename ${target.kind} ${target.name} -> ${newName}`);
  out.push(`Source: ${relPath} (L${target.startLine}-${target.endLine})`);
  out.push(`Exported: ${target.exported ? "yes" : "no"}`);
  out.push("");

  if (!identOk) {
    out.push("ERROR: new_name is not a valid identifier — aborting plan.");
    return text(out.join("\n"));
  }

  if (newName === target.name) {
    out.push("ERROR: new_name equals current name — nothing to do.");
    return text(out.join("\n"));
  }

  // Step 1 — collect candidate references via ripgrep (word boundary)
  const refs = await ripgrepSearch({
    query: `\\b${escapeRegex(target.name)}\\b`,
    cwd,
    maxResults: 1000,
    regex: true,
    contextLines: 0,
  });

  // Group by file
  const byFile = new Map<string, PlannedEdit[]>();
  for (const m of refs.matches) {
    const list = byFile.get(m.filePath) ?? [];
    list.push({
      file: m.filePath,
      line: m.lineNumber,
      kind: classifyRefKind(m.lineText, target.name),
      preview: m.lineText.trim(),
    });
    byFile.set(m.filePath, list);
  }

  // Step 2 — collision detection: does newName already exist as a symbol in any touched file?
  const collisions: Array<{ file: string; existing: string }> = [];
  for (const file of byFile.keys()) {
    const abs = join(cwd, file);
    if (!existsSync(abs)) continue;
    try {
      const c = readFileSync(abs, "utf-8");
      const { symbols } = parseFile(abs, c);
      if (findSymbol(symbols, newName)) {
        collisions.push({ file, existing: `symbol "${newName}" defined here` });
      }
    } catch {
      // ignore unreadable
    }
  }

  // Order: source file first (definition + internal refs), then importers (must update import names)
  const ordered: string[] = [];
  if (byFile.has(relPath)) ordered.push(relPath);
  for (const f of byFile.keys()) {
    if (f !== relPath) ordered.push(f);
  }
  const limited = ordered.slice(0, maxFiles);
  const omitted = ordered.length - limited.length;

  out.push("Preconditions:");
  out.push(`  - new_name "${newName}" is a valid identifier`);
  if (collisions.length === 0) {
    out.push(`  - no naming collision detected in touched files`);
  } else {
    out.push(`  - WARNING: naming collisions in ${collisions.length} file(s):`);
    for (const c of collisions.slice(0, 10)) {
      out.push(`      ${c.file} — ${c.existing}`);
    }
  }
  if (target.exported) {
    out.push(
      `  - exported symbol: external consumers outside this repo (if any) will break`,
    );
  }
  out.push("");

  out.push(
    `Ordered edit plan (${limited.length} file(s)${omitted > 0 ? `, ${omitted} more omitted` : ""}):`,
  );
  let step = 1;
  for (const file of limited) {
    const edits = byFile.get(file)!;
    const isSource = file === relPath;
    out.push(`  ${step}. ${file}${isSource ? "  [definition site]" : ""}`);
    for (const e of edits.slice(0, 25)) {
      out.push(`       L${e.line} [${e.kind}] ${truncate(e.preview, 100)}`);
    }
    if (edits.length > 25) {
      out.push(`       ... ${edits.length - 25} more`);
    }
    step++;
  }
  out.push("");

  out.push("Rollback plan:");
  out.push(
    "  - all edits are local string replacements; reverse rename by re-running with new_name and target_symbol swapped",
  );
  out.push("");

  out.push("Suggested verification after applying:");
  out.push(
    "  - run abf_impact_typed on the renamed symbol to confirm no stale refs",
  );
  out.push("  - run abf_related_tests and execute the affected test files");
  if (target.exported) {
    out.push(
      "  - run abf_dependencies on the source file to verify importers updated their named imports",
    );
  }

  return text(out.join("\n"));
}

function planMove(opts: {
  cwd: string;
  relPath: string;
  target: ParsedSymbol;
  newPath: string;
}) {
  const { relPath, target, newPath } = opts;
  const out: string[] = [];
  out.push(`Refactor plan: move ${target.kind} ${target.name}`);
  out.push(`From: ${relPath}`);
  out.push(`To:   ${newPath}`);
  out.push("");
  out.push("Ordered edit plan:");
  out.push(
    `  1. create or open ${newPath}; insert symbol body (L${target.startLine}-${target.endLine}) preserving ${target.exported ? "export" : "internal"} visibility`,
  );
  out.push(`  2. remove symbol body from ${relPath}`);
  out.push(
    `  3. add re-export shim in ${relPath} pointing to ${newPath} (optional, for backwards compat)`,
  );
  out.push(
    `  4. update importers — run abf_impact + abf_dependencies on ${target.name} to enumerate them`,
  );
  out.push("");
  out.push("Risks:");
  out.push("  - circular imports if new_path already imports relPath");
  out.push("  - test snapshots referring to old import path");
  out.push("");
  out.push("Suggested verification:");
  out.push("  - abf_dependencies on both old and new file");
  out.push("  - abf_impact_typed on the moved symbol");
  return text(out.join("\n"));
}

function planGuidance(
  intent: "extract" | "split",
  relPath: string,
  target: ParsedSymbol,
) {
  const out: string[] = [];
  out.push(`Refactor plan: ${intent} ${target.kind} ${target.name}`);
  out.push(`Source: ${relPath} (L${target.startLine}-${target.endLine})`);
  out.push("");
  if (intent === "extract") {
    out.push("Ordered guidance:");
    out.push("  1. identify cohesive sub-block inside the target symbol");
    out.push("  2. determine inputs (closure variables, params) and output(s)");
    out.push("  3. create new helper symbol next to the original");
    out.push("  4. replace original code with a call to the new helper");
    out.push("  5. add minimal unit test for the extracted helper");
  } else {
    out.push("Ordered guidance:");
    out.push("  1. group internal responsibilities of the target");
    out.push("  2. split into N cohesive sub-symbols");
    out.push("  3. update internal callers in the same file");
    out.push("  4. update external callers — run abf_impact_typed first");
    out.push("  5. retire the original symbol or keep as facade");
  }
  out.push("");
  out.push(
    "Note: extract/split are not auto-planned in v1; use this checklist with abf_chunk for the source body.",
  );
  return text(out.join("\n"));
}

function classifyRefKind(line: string, name: string): PlannedEdit["kind"] {
  const t = line.trim();
  if (/^import\b|^from\b|require\(/.test(t)) return "import";
  if (
    new RegExp(
      `^(export\\s+)?(class|interface|type|enum|function|const|let|var|async\\s+function)\\s+${escapeRegex(name)}\\b`,
    ).test(t)
  ) {
    return "definition";
  }
  if (new RegExp(`^export\\s+\\{[^}]*\\b${escapeRegex(name)}\\b`).test(t)) {
    return "export";
  }
  if (new RegExp(`:\\s*${escapeRegex(name)}[<\\[|\\s,;>)]`).test(t)) {
    return "type_ref";
  }
  if (new RegExp(`${escapeRegex(name)}\\s*\\(`).test(t)) return "call";
  return "reference";
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

function errorOut(msg: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}

// Suppress unused warnings for helpers reserved for future intents.
void execFileSync;
void resolve;
void dirname;
