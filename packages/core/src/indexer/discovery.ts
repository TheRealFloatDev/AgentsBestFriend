import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadConfig } from "../config/manager.js";
import { isBinaryFile } from "../utils/index.js";

const execFileAsync = promisify(execFile);

export interface DiscoveredFile {
  /** Path relative to project root */
  relativePath: string;
  /** Absolute path */
  absolutePath: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Last modified timestamp (ms) */
  lastModifiedAt: number;
}

export interface DiscoveryOptions {
  /** Project root directory */
  projectRoot: string;
  /** Maximum file size in KB (default from config) */
  maxFileSizeKb?: number;
  /** Additional exclude patterns */
  excludePatterns?: string[];
}

/**
 * Discover all indexable files in a project.
 * Uses `git ls-files` for git repos, falls back to filesystem walk.
 * Respects gitignore, binary detection, and size limits.
 */
export async function discoverFiles(
  options: DiscoveryOptions,
): Promise<DiscoveredFile[]> {
  const config = loadConfig();
  const maxSizeBytes =
    (options.maxFileSizeKb ?? config.indexing.maxFileSizeKb) * 1024;

  const allExclude = [
    ...(config.indexing.excludedPatterns ?? []),
    ...(options.excludePatterns ?? []),
  ];

  let filePaths: string[];
  try {
    filePaths = await getGitTrackedFiles(options.projectRoot);
  } catch {
    // Not a git repo or git not available — use find
    filePaths = await walkDirectory(options.projectRoot, allExclude);
  }

  // Filter and enrich with metadata in parallel
  const results: DiscoveredFile[] = [];
  const BATCH = 100;

  for (let i = 0; i < filePaths.length; i += BATCH) {
    const batch = filePaths.slice(i, i + BATCH);
    const resolved = await Promise.all(
      batch.map(async (relPath) => {
        const absPath = join(options.projectRoot, relPath);
        try {
          const st = await stat(absPath);
          if (!st.isFile()) return null;
          if (st.size > maxSizeBytes) return null;
          if (st.size === 0) return null;
          if (isBinaryFile(absPath)) return null;

          return {
            relativePath: relPath,
            absolutePath: absPath,
            sizeBytes: st.size,
            lastModifiedAt: st.mtimeMs,
          } satisfies DiscoveredFile;
        } catch {
          return null; // file disappeared or unreadable
        }
      }),
    );
    for (const r of resolved) {
      if (r) results.push(r);
    }
  }

  return results;
}

async function getGitTrackedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.trim().split("\n").filter(Boolean);
}

const ALWAYS_IGNORE = new Set([
  "node_modules",
  ".git",
  ".abf",
  "__pycache__",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".turbo",
]);

async function walkDirectory(
  root: string,
  _excludePatterns: string[],
): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      if (ALWAYS_IGNORE.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        results.push(relative(root, fullPath));
      }
    }
  }

  await walk(root);
  return results;
}
