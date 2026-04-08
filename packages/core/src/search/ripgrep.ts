import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "../config/index.js";

const execFileAsync = promisify(execFile);

export interface RipgrepMatch {
  filePath: string;
  lineNumber: number;
  columnNumber: number;
  matchText: string;
  lineText: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface RipgrepResult {
  matches: RipgrepMatch[];
  totalMatches: number;
  truncated: boolean;
}

interface RgJsonMessage {
  type: "begin" | "match" | "end" | "context" | "summary";
  data?: {
    path?: { text: string };
    lines?: { text: string };
    line_number?: number;
    absolute_offset?: number;
    submatches?: Array<{ match: { text: string }; start: number; end: number }>;
    stats?: { matches_found: number };
  };
}

/**
 * Search for a pattern using ripgrep with structured JSON output.
 */
export async function ripgrepSearch(opts: {
  query: string;
  cwd: string;
  pathFilter?: string;
  maxResults?: number;
  caseSensitive?: boolean;
  regex?: boolean;
  contextLines?: number;
}): Promise<RipgrepResult> {
  const config = loadConfig();
  const rgPath = config.search.ripgrepPath;
  const maxResults = opts.maxResults ?? config.search.defaultMaxResults;
  const contextLines = opts.contextLines ?? 2;

  const args: string[] = [
    "--json",
    "--max-count",
    String(maxResults * 2), // get extra so we have room after filtering
    "--context",
    String(contextLines),
  ];

  if (!opts.caseSensitive) {
    args.push("--ignore-case");
  }

  if (!opts.regex) {
    args.push("--fixed-strings");
  }

  if (opts.pathFilter) {
    args.push("--glob", opts.pathFilter);
  }

  // Respect common ignore patterns
  args.push("--hidden");
  args.push("--glob", "!.git");
  args.push("--glob", "!.abf");
  args.push("--glob", "!node_modules");
  args.push("--glob", "!.next");
  args.push("--glob", "!dist");
  args.push("--glob", "!build");
  args.push("--glob", "!*.min.js");
  args.push("--glob", "!*.min.css");
  args.push("--glob", "!*.map");
  args.push("--glob", "!package-lock.json");
  args.push("--glob", "!yarn.lock");
  args.push("--glob", "!pnpm-lock.yaml");

  args.push("--", opts.query, ".");

  try {
    const { stdout } = await execFileAsync(rgPath, args, {
      cwd: opts.cwd,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return parseRipgrepJson(stdout, maxResults);
  } catch (error: any) {
    // ripgrep exits with code 1 when no matches found — that's fine
    if (error.code === 1 || error.exitCode === 1) {
      return { matches: [], totalMatches: 0, truncated: false };
    }

    // Exit code 2 = error
    if (error.stderr) {
      throw new Error(`ripgrep error: ${error.stderr}`);
    }

    throw error;
  }
}

/**
 * Check if ripgrep is available on the system.
 */
export async function isRipgrepAvailable(): Promise<boolean> {
  const config = loadConfig();
  try {
    await execFileAsync(config.search.ripgrepPath, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function parseRipgrepJson(output: string, maxResults: number): RipgrepResult {
  const lines = output.trim().split("\n").filter(Boolean);
  const matches: RipgrepMatch[] = [];
  let totalMatches = 0;

  // Collect context lines keyed by file path
  const contextMap = new Map<
    string,
    Map<number, { before: string[]; after: string[] }>
  >();

  // First pass: collect all messages
  const messages: RgJsonMessage[] = [];
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line));
    } catch {
      // Skip malformed JSON lines
    }
  }

  // Second pass: build matches with context
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.type === "match" && msg.data) {
      const filePath = msg.data.path?.text ?? "";
      const lineNumber = msg.data.line_number ?? 0;
      const lineText = msg.data.lines?.text?.trimEnd() ?? "";
      const matchText = msg.data.submatches?.[0]?.match?.text ?? lineText;

      // Gather context lines (they appear as "context" type before/after matches)
      const contextBefore: string[] = [];
      const contextAfter: string[] = [];

      // Look backwards for context
      for (let j = i - 1; j >= 0; j--) {
        const ctx = messages[j];
        if (ctx.type === "context" && ctx.data?.path?.text === filePath) {
          contextBefore.unshift(ctx.data.lines?.text?.trimEnd() ?? "");
        } else {
          break;
        }
      }

      // Look forwards for context
      for (let j = i + 1; j < messages.length; j++) {
        const ctx = messages[j];
        if (ctx.type === "context" && ctx.data?.path?.text === filePath) {
          contextAfter.push(ctx.data.lines?.text?.trimEnd() ?? "");
        } else {
          break;
        }
      }

      matches.push({
        filePath,
        lineNumber,
        columnNumber: msg.data.submatches?.[0]?.start ?? 0,
        matchText,
        lineText,
        contextBefore,
        contextAfter,
      });

      totalMatches++;
    }

    if (msg.type === "summary" && msg.data?.stats?.matches_found != null) {
      totalMatches = msg.data.stats.matches_found;
    }
  }

  // Ensure totalMatches is at least the number of matches collected
  if (totalMatches === 0) totalMatches = matches.length;

  const truncated = matches.length > maxResults;
  return {
    matches: matches.slice(0, maxResults),
    totalMatches,
    truncated,
  };
}
