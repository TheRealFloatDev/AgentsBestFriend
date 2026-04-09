import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { parseFile } from "./parse.js";
import type { ParsedSymbol, ParsedImport } from "./parser-types.js";
import { execFileSync } from "node:child_process";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BundleInclude = "signatures" | "full" | "smart";

export interface ContextBundleOptions {
  /** Entry file path (relative to projectRoot or absolute) */
  entry: string;
  /** Project root directory */
  projectRoot: string;
  /** How deep to follow the import graph (default: 1) */
  depth?: number;
  /** What to include: "signatures" (compact), "full" (source code), "smart" (full for entry, signatures for deps) */
  include?: BundleInclude;
  /** Focus on a specific symbol in the entry file */
  focusSymbol?: string;
  /** Include reverse dependencies (who imports the entry) */
  reverse?: boolean;
}

export interface BundledFile {
  /** Relative path from project root */
  path: string;
  /** Depth in the import graph (0 = entry) */
  depth: number;
  /** Parsed symbols for this file */
  symbols: ParsedSymbol[];
  /** Parsed imports for this file */
  imports: ParsedImport[];
  /** Full file content (only when needed) */
  content?: string;
  /** Whether this is a reverse dependency */
  isReverse?: boolean;
}

export interface ContextBundleResult {
  entry: string;
  focusSymbol?: string;
  depth: number;
  include: BundleInclude;
  files: BundledFile[];
  totalSymbols: number;
}

// ─── Main Function ───────────────────────────────────────────────────────────

export function buildContextBundle(
  opts: ContextBundleOptions,
): ContextBundleResult {
  const {
    projectRoot,
    depth = 1,
    include = "smart",
    focusSymbol,
    reverse = false,
  } = opts;

  const entryPath = opts.entry.startsWith("/")
    ? opts.entry
    : join(projectRoot, opts.entry);
  const entryRel = relative(projectRoot, entryPath);

  // Track visited files to avoid cycles
  const visited = new Set<string>();
  const bundledFiles: BundledFile[] = [];

  // ─── Traverse forward dependencies ─────────────────────────────────────
  traverseImports(
    entryPath,
    projectRoot,
    0,
    depth,
    include,
    focusSymbol,
    visited,
    bundledFiles,
  );

  // ─── Reverse dependencies ──────────────────────────────────────────────
  if (reverse) {
    const reverseFiles = findReverseDeps(projectRoot, entryRel);
    for (const revFile of reverseFiles) {
      const absPath = join(projectRoot, revFile.file);
      if (visited.has(absPath)) continue;
      visited.add(absPath);

      try {
        const content = readFileSync(absPath, "utf-8");
        const parsed = parseFile(absPath, content);
        bundledFiles.push({
          path: revFile.file,
          depth: -1, // reverse
          symbols: parsed.symbols,
          imports: parsed.imports,
          isReverse: true,
        });
      } catch {
        // skip unreadable
      }
    }
  }

  let totalSymbols = 0;
  for (const f of bundledFiles) {
    totalSymbols += countSymbols(f.symbols);
  }

  return {
    entry: entryRel,
    focusSymbol,
    depth,
    include,
    files: bundledFiles,
    totalSymbols,
  };
}

// ─── Import Graph Traversal ──────────────────────────────────────────────────

function traverseImports(
  filePath: string,
  projectRoot: string,
  currentDepth: number,
  maxDepth: number,
  include: BundleInclude,
  focusSymbol: string | undefined,
  visited: Set<string>,
  out: BundledFile[],
): void {
  if (visited.has(filePath)) return;
  visited.add(filePath);

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return;
  }

  const parsed = parseFile(filePath, content);
  const relPath = relative(projectRoot, filePath);

  const isEntry = currentDepth === 0;

  // Determine if we should include full content
  const includeContent = include === "full" || (include === "smart" && isEntry);

  const bundled: BundledFile = {
    path: relPath,
    depth: currentDepth,
    symbols: parsed.symbols,
    imports: parsed.imports,
    content: includeContent ? content : undefined,
  };
  out.push(bundled);

  // Stop recursion at max depth
  if (currentDepth >= maxDepth) return;

  // Resolve and follow imports
  for (const imp of parsed.imports) {
    const resolved = resolveImportPath(imp.targetPath, filePath, projectRoot);
    if (!resolved) continue;

    // If we have a focus symbol, only follow imports that are relevant
    if (focusSymbol && isEntry) {
      if (!isImportRelevantToSymbol(content, focusSymbol, imp)) continue;
    }

    traverseImports(
      resolved,
      projectRoot,
      currentDepth + 1,
      maxDepth,
      include,
      undefined, // no focus filtering beyond entry
      visited,
      out,
    );
  }
}

// ─── Import Resolution ───────────────────────────────────────────────────────

function resolveImportPath(
  importPath: string,
  fromFile: string,
  projectRoot: string,
): string | null {
  // Handle relative imports
  if (importPath.startsWith(".")) {
    const fromDir = dirname(fromFile);
    return tryResolveFile(resolve(fromDir, importPath));
  }

  // Handle package imports within the monorepo (e.g. @abf/core/search)
  if (importPath.startsWith("@")) {
    return resolveMonorepoImport(importPath, projectRoot);
  }

  // External packages — don't follow
  return null;
}

function tryResolveFile(base: string): string | null {
  const extensions = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    "/index.ts",
    "/index.tsx",
    "/index.js",
  ];
  // Strip .js extension first (TS projects often import .js that maps to .ts)
  const stripped = base.replace(/\.js$/, "");
  for (const ext of extensions) {
    const candidate = stripped + ext;
    if (existsSync(candidate)) return candidate;
  }
  // Also try the original base path
  for (const ext of extensions) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveMonorepoImport(
  importPath: string,
  projectRoot: string,
): string | null {
  // Parse: @abf/core/search → package=@abf/core, subpath=search
  const parts = importPath.split("/");
  if (parts.length < 2) return null;

  const scope = parts[0]; // @abf
  const pkgName = parts[1]; // core
  const subpath = parts.slice(2).join("/"); // search

  // Look for the package in packages/
  const pkgDir = join(projectRoot, "packages", pkgName);
  if (!existsSync(pkgDir)) return null;

  // Read the package's package.json to find the exports map
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return null;

  try {
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

    // Check exports map
    const exportKey = subpath ? `./${subpath}` : ".";
    const exportEntry = pkgJson.exports?.[exportKey];

    if (exportEntry) {
      // Get the source path (prefer types → import, map dist back to src)
      const distPath =
        typeof exportEntry === "string"
          ? exportEntry
          : (exportEntry.import ?? exportEntry.types);

      if (distPath) {
        // Convert dist path to src path: ./dist/search/index.js → ./src/search/index.ts
        const srcPath = distPath
          .replace(/^\.\/dist\//, "./src/")
          .replace(/\.js$/, ".ts")
          .replace(/\.d\.ts$/, ".ts");

        const resolved = join(pkgDir, srcPath);
        if (existsSync(resolved)) return resolved;

        // Fallback: try the dist path directly
        const distResolved = join(pkgDir, distPath);
        if (existsSync(distResolved)) return distResolved;
      }
    }
  } catch {
    // ignore malformed package.json
  }

  // Fallback: try common paths
  const fallbacks = [
    join(pkgDir, "src", subpath || "index", "index.ts"),
    join(pkgDir, "src", (subpath || "index") + ".ts"),
  ];
  for (const fb of fallbacks) {
    if (existsSync(fb)) return fb;
  }

  return null;
}

// ─── Focus Symbol Relevance ──────────────────────────────────────────────────

function isImportRelevantToSymbol(
  fileContent: string,
  focusSymbol: string,
  imp: ParsedImport,
): boolean {
  // Find the focus symbol's function body and check if it uses any of the imported symbols
  const lines = fileContent.split("\n");

  // Simple heuristic: look for the symbol definition and check its body
  const symbolRegex = new RegExp(
    `(?:function|const|class|interface|type)\\s+${escapeRegex(focusSymbol)}`,
  );

  let inSymbol = false;
  let braceDepth = 0;
  let symbolFound = false;

  for (const line of lines) {
    if (!inSymbol && symbolRegex.test(line)) {
      inSymbol = true;
      symbolFound = true;
    }

    if (inSymbol) {
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }

      // Check if any imported symbol is used in this line
      for (const sym of imp.importedSymbols) {
        if (sym === "*") return true;
        if (line.includes(sym)) return true;
      }

      if (braceDepth <= 0 && symbolFound) {
        // End of symbol body — if we haven't found relevance, it's not relevant
        return false;
      }
    }
  }

  // If we couldn't find the symbol, include the import to be safe
  return !symbolFound;
}

// ─── Reverse Dependencies ────────────────────────────────────────────────────

interface ReverseDepEntry {
  file: string;
  symbols: string[];
}

function findReverseDeps(
  projectRoot: string,
  targetRelPath: string,
): ReverseDepEntry[] {
  let filePaths: string[];
  try {
    const stdout = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 },
    ).toString();
    filePaths = stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }

  const codeExts = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
  ]);
  const results: ReverseDepEntry[] = [];
  const targetName = targetRelPath
    .replace(/\.[^.]+$/, "")
    .replace(/\/index$/, "");

  for (const fp of filePaths) {
    if (fp === targetRelPath) continue;
    const ext = fp.slice(fp.lastIndexOf("."));
    if (!codeExts.has(ext)) continue;

    try {
      const content = readFileSync(join(projectRoot, fp), "utf-8");
      const parsed = parseFile(join(projectRoot, fp), content);

      for (const imp of parsed.imports) {
        if (
          importMatchesTarget(imp.targetPath, fp, targetRelPath, targetName)
        ) {
          results.push({ file: fp, symbols: imp.importedSymbols });
          break;
        }
      }
    } catch {
      // skip
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
  const sourceDir = dirname(sourceFile);
  const resolved = join(sourceDir, importPath)
    .replace(/\.[^.]+$/, "")
    .replace(/\/index$/, "");

  return (
    resolved === targetName ||
    resolved === targetRelPath.replace(/\.[^.]+$/, "")
  );
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatContextBundle(result: ContextBundleResult): string {
  const lines: string[] = [];

  lines.push(
    `Bundle for ${result.entry}${result.focusSymbol ? ` → ${result.focusSymbol}` : ""}`,
  );
  lines.push(
    `  Depth: ${result.depth} | Files: ${result.files.length} | Symbols: ${result.totalSymbols} | Mode: ${result.include}`,
  );
  lines.push("");

  // Group files by depth
  const forwardFiles = result.files.filter((f) => !f.isReverse);
  const reverseFiles = result.files.filter((f) => f.isReverse);

  for (const file of forwardFiles) {
    const depthLabel = file.depth === 0 ? "ENTRY" : `DEPTH ${file.depth}`;
    lines.push(`═══ ${depthLabel}: ${file.path} ═══`);

    // If full content + focus symbol, show focused code + other signatures
    if (file.content && result.focusSymbol && file.depth === 0) {
      const focused = findSymbolInList(file.symbols, result.focusSymbol);
      if (focused) {
        const contentLines = file.content.split("\n");
        const code = contentLines
          .slice(focused.startLine - 1, focused.endLine)
          .join("\n");
        lines.push(
          `  [${focused.kind} ${focused.name} L${focused.startLine}-${focused.endLine}]`,
        );
        lines.push(code);
        lines.push("");

        // Other symbols as signatures
        const others = file.symbols.filter(
          (s) => s.name !== result.focusSymbol,
        );
        if (others.length > 0) {
          lines.push("  Other symbols:");
          for (const sym of others) {
            lines.push(formatSymbolSignature(sym, "  "));
          }
          lines.push("");
        }
      } else {
        // Focus symbol not found — show all content
        lines.push(file.content);
        lines.push("");
      }
    } else if (file.content) {
      // Full content mode without focus
      lines.push(file.content);
      lines.push("");
    } else {
      // Signatures only mode
      if (file.symbols.length > 0) {
        for (const sym of file.symbols) {
          lines.push(formatSymbolSignature(sym, "  "));
        }
      } else if (file.imports.length > 0) {
        // Barrel/index file — show re-exports
        lines.push("  Re-exports:");
        for (const imp of file.imports) {
          const syms = imp.importedSymbols.join(", ");
          lines.push(`    ${imp.targetPath} → {${syms}}`);
        }
      } else {
        lines.push("  (no symbols parsed)");
      }
      lines.push("");
    }

    // Show imports summary
    if (file.imports.length > 0) {
      lines.push("  Imports:");
      for (const imp of file.imports) {
        const syms = imp.importedSymbols.join(", ");
        lines.push(`    ${imp.targetPath} → {${syms}}`);
      }
      lines.push("");
    }
  }

  if (reverseFiles.length > 0) {
    lines.push(`═══ REVERSE (imports ${result.entry}) ═══`);
    const entryBaseName = result.entry
      .replace(/\.[^.]+$/, "")
      .replace(/\/index$/, "");
    for (const file of reverseFiles) {
      // Only show the import that references the entry file
      const relevantImps = file.imports.filter((imp) => {
        const resolved = imp.targetPath
          .replace(/\.[^.]+$/, "")
          .replace(/\/index$/, "");
        return (
          imp.targetPath.includes(entryBaseName.split("/").pop()!) ||
          resolved.endsWith(entryBaseName.split("/").pop()!)
        );
      });
      if (relevantImps.length > 0) {
        for (const imp of relevantImps) {
          const syms = imp.importedSymbols.join(", ");
          lines.push(`  ${file.path} → {${syms}} from ${imp.targetPath}`);
        }
      } else {
        lines.push(`  ${file.path}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSymbolSignature(sym: ParsedSymbol, indent: string): string {
  const exported = sym.exported ? "★ " : "";
  const sig = sym.signature ?? sym.name;
  const range = `L${sym.startLine}-${sym.endLine}`;
  let line = `${indent}${exported}${sym.kind} ${sig}  (${range})`;

  if (sym.children.length > 0) {
    for (const child of sym.children) {
      line += "\n" + formatSymbolSignature(child, indent + "  ");
    }
  }

  return line;
}

function findSymbolInList(
  symbols: ParsedSymbol[],
  name: string,
): ParsedSymbol | undefined {
  const lower = name.toLowerCase();
  for (const sym of symbols) {
    if (sym.name.toLowerCase() === lower) return sym;
    for (const child of sym.children) {
      if (child.name.toLowerCase() === lower) return child;
    }
  }
  return undefined;
}

function countSymbols(symbols: ParsedSymbol[]): number {
  let count = 0;
  for (const sym of symbols) {
    count++;
    count += countSymbols(sym.children);
  }
  return count;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
