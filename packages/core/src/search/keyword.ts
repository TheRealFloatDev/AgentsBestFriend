import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadConfig } from "../config/index.js";

export interface KeywordMatch {
  filePath: string;
  score: number;
  keywordHits: Record<string, number>;
  totalHits: number;
  lineCount: number;
  topLines: Array<{ line: number; text: string; keywords: string[] }>;
}

export interface KeywordSearchResult {
  matches: KeywordMatch[];
  keywords: string[];
  totalFilesScanned: number;
}

/**
 * Keyword-based file search: splits query into keywords, scores each file
 * by keyword density, returns top N files ranked by relevance.
 *
 * Good for exploratory searches where the agent isn't sure of exact names.
 */
export async function keywordSearch(opts: {
  query: string;
  cwd: string;
  pathFilter?: string;
  maxResults?: number;
  /** Pre-collected file list to avoid re-scanning */
  filePaths?: string[];
}): Promise<KeywordSearchResult> {
  const config = loadConfig();
  const maxResults = opts.maxResults ?? config.search.defaultMaxResults;

  // Tokenize query into keywords (split on spaces, remove short/common words)
  const keywords = tokenizeQuery(opts.query);
  if (keywords.length === 0) {
    return { matches: [], keywords: [], totalFilesScanned: 0 };
  }

  // Get file list
  const files =
    opts.filePaths ?? (await collectFiles(opts.cwd, opts.pathFilter));

  const matches: KeywordMatch[] = [];

  for (const filePath of files) {
    const absPath = join(opts.cwd, filePath);
    let content: string;

    try {
      const stat = statSync(absPath);
      // Skip files larger than configured max
      if (stat.size > config.indexing.maxFileSizeKb * 1024) continue;

      content = readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const result = scoreFile(content, keywords, filePath);
    if (result.totalHits > 0) {
      matches.push(result);
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return {
    matches: matches.slice(0, maxResults),
    keywords,
    totalFilesScanned: files.length,
  };
}

/**
 * Tokenize a search query into individual keywords.
 * Removes very short words and common stop words.
 */
function tokenizeQuery(query: string): string[] {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "can",
    "shall",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "and",
    "but",
    "or",
    "nor",
    "not",
    "so",
    "if",
    "then",
    "else",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
  ]);

  return query
    .toLowerCase()
    .split(/[\s,;|+]+/)
    .map((w) => w.replace(/[^a-z0-9_.-]/g, ""))
    .filter((w) => w.length >= 2 && !stopWords.has(w));
}

/**
 * Score a single file against a set of keywords.
 * Uses TF-IDF-inspired scoring: more unique keyword matches = higher score.
 */
function scoreFile(
  content: string,
  keywords: string[],
  filePath: string,
): KeywordMatch {
  const lowerContent = content.toLowerCase();
  const lines = content.split("\n");
  const keywordHits: Record<string, number> = {};
  let totalHits = 0;

  // Count keyword occurrences
  for (const keyword of keywords) {
    let count = 0;
    let pos = 0;
    while ((pos = lowerContent.indexOf(keyword, pos)) !== -1) {
      count++;
      pos += keyword.length;
    }
    if (count > 0) {
      keywordHits[keyword] = count;
      totalHits += count;
    }
  }

  // Find top lines (lines that contain the most keywords)
  const topLines: Array<{ line: number; text: string; keywords: string[] }> =
    [];
  if (totalHits > 0) {
    const lineScores: Array<{
      line: number;
      text: string;
      keywords: string[];
      score: number;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      const foundKeywords: string[] = [];
      for (const keyword of keywords) {
        if (lineLower.includes(keyword)) {
          foundKeywords.push(keyword);
        }
      }
      if (foundKeywords.length > 0) {
        lineScores.push({
          line: i + 1,
          text: lines[i].trimEnd(),
          keywords: foundKeywords,
          score: foundKeywords.length,
        });
      }
    }

    lineScores.sort((a, b) => b.score - a.score);
    for (const ls of lineScores.slice(0, 5)) {
      topLines.push({ line: ls.line, text: ls.text, keywords: ls.keywords });
    }
  }

  // Scoring formula:
  // - Base: number of unique keywords found (most important)
  // - Bonus: total hit count (log-scaled to dampen high-frequency terms)
  // - Bonus: path match (keyword in filename/path)
  const uniqueKeywordsFound = Object.keys(keywordHits).length;
  const pathLower = filePath.toLowerCase();
  const pathBonus = keywords.filter((k) => pathLower.includes(k)).length * 2;

  const score = uniqueKeywordsFound * 10 + Math.log2(1 + totalHits) + pathBonus;

  return {
    filePath,
    score: Math.round(score * 100) / 100,
    keywordHits,
    totalHits,
    lineCount: lines.length,
    topLines,
  };
}

/**
 * Collect file paths from a directory, respecting basic ignore patterns.
 * This is a fallback when no pre-built file list is available.
 */
async function collectFiles(
  cwd: string,
  pathFilter?: string,
): Promise<string[]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    // Use git ls-files for tracked files (respects .gitignore)
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    let files = stdout.trim().split("\n").filter(Boolean);

    if (pathFilter) {
      const { minimatch } = await import("minimatch" as string).catch(() => ({
        minimatch: (f: string, p: string) => {
          // Simple glob fallback
          const regex = new RegExp(
            "^" + p.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$",
          );
          return regex.test(f);
        },
      }));

      files = files.filter((f) => minimatch(f, pathFilter));
    }

    return files;
  } catch {
    // Fallback: walk directory
    return walkDir(cwd, cwd);
  }
}

function walkDir(root: string, dir: string): string[] {
  const results: string[] = [];
  const ignoreDirs = new Set([
    "node_modules",
    ".git",
    ".abf",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
  ]);

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      if (ignoreDirs.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(root, fullPath));
      } else if (entry.isFile()) {
        results.push(relative(root, fullPath));
      }
    }
  } catch {
    // Permission errors, etc.
  }

  return results;
}
