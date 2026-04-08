import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  filesChanged?: number;
}

export interface GitBlameLine {
  line: number;
  author: string;
  date: string;
  commitHash: string;
  commitMessage: string;
  content: string;
}

export interface GitDiff {
  staged: string;
  unstaged: string;
  combined: string;
  stats: { filesChanged: number; insertions: number; deletions: number };
}

export interface GitFileHistory {
  commits: GitCommit[];
  filePath: string;
}

// ─── Git Operations ──────────────────────────────────────────────────────────

/**
 * Check if the given directory is inside a git repository.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get recent commits (log).
 */
export async function getRecentCommits(
  cwd: string,
  count: number = 10,
): Promise<GitCommit[]> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "log",
      `--max-count=${count}`,
      "--format=%H%x00%h%x00%an%x00%aI%x00%s",
      "--shortstat",
    ],
    { cwd, maxBuffer: GIT_MAX_BUFFER },
  );

  return parseGitLog(stdout);
}

/**
 * Get commits that modified a specific file.
 */
export async function getFileHistory(
  cwd: string,
  filePath: string,
  count: number = 20,
): Promise<GitFileHistory> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "log",
      `--max-count=${count}`,
      "--format=%H%x00%h%x00%an%x00%aI%x00%s",
      "--follow",
      "--",
      filePath,
    ],
    { cwd, maxBuffer: GIT_MAX_BUFFER },
  );

  const commits = parseGitLog(stdout);
  return { commits, filePath };
}

/**
 * Get blame information for a file (or a line range within it).
 */
export async function getBlame(
  cwd: string,
  filePath: string,
  lineRange?: [number, number],
): Promise<GitBlameLine[]> {
  const args = ["blame", "--porcelain"];

  if (lineRange) {
    args.push(`-L${lineRange[0]},${lineRange[1]}`);
  }

  args.push("--", filePath);

  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: GIT_MAX_BUFFER,
  });

  return parseBlame(stdout);
}

/**
 * Get current diff (staged + unstaged).
 */
export async function getDiff(
  cwd: string,
  filePath?: string,
): Promise<GitDiff> {
  const fileArgs = filePath ? ["--", filePath] : [];

  const [staged, unstaged, statOutput] = await Promise.all([
    execFileAsync("git", ["diff", "--cached", ...fileArgs], {
      cwd,
      maxBuffer: GIT_MAX_BUFFER,
    }).then((r) => r.stdout),
    execFileAsync("git", ["diff", ...fileArgs], {
      cwd,
      maxBuffer: GIT_MAX_BUFFER,
    }).then((r) => r.stdout),
    execFileAsync("git", ["diff", "--stat", "HEAD", ...fileArgs], {
      cwd,
      maxBuffer: GIT_MAX_BUFFER,
    })
      .then((r) => r.stdout)
      .catch(() => ""),
  ]);

  const combined = [staged, unstaged].filter(Boolean).join("\n");

  // Parse stat line: "3 files changed, 10 insertions(+), 5 deletions(-)"
  const stats = { filesChanged: 0, insertions: 0, deletions: 0 };
  const statMatch = statOutput.match(
    /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
  );
  if (statMatch) {
    stats.filesChanged = parseInt(statMatch[1], 10);
    stats.insertions = parseInt(statMatch[2] ?? "0", 10);
    stats.deletions = parseInt(statMatch[3] ?? "0", 10);
  }

  return { staged, unstaged, combined, stats };
}

/**
 * Get list of git-tracked files.
 */
export async function getTrackedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd, maxBuffer: GIT_MAX_BUFFER },
  );

  return stdout.trim().split("\n").filter(Boolean);
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseGitLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const lines = output.trim().split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if this is a commit line (contains null bytes as separators)
    if (line.includes("\0")) {
      const parts = line.split("\0");
      if (parts.length >= 5) {
        const commit: GitCommit = {
          hash: parts[0],
          shortHash: parts[1],
          author: parts[2],
          date: parts[3],
          message: parts[4],
        };

        // Check next line for --shortstat info
        if (i + 1 < lines.length) {
          const statLine = lines[i + 1].trim();
          const statMatch = statLine.match(/(\d+) files? changed/);
          if (statMatch) {
            commit.filesChanged = parseInt(statMatch[1], 10);
            i++; // skip stat line
          }
        }

        commits.push(commit);
      }
    }
  }

  return commits;
}

function parseBlame(output: string): GitBlameLine[] {
  const result: GitBlameLine[] = [];
  const lines = output.split("\n");

  let currentHash = "";
  let currentAuthor = "";
  let currentDate = "";
  let currentMessage = "";
  let currentLineNum = 0;

  for (const line of lines) {
    // Header line: <hash> <orig_line> <final_line> [<group_lines>]
    const headerMatch = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (headerMatch) {
      currentHash = headerMatch[1];
      currentLineNum = parseInt(headerMatch[2], 10);
      continue;
    }

    if (line.startsWith("author ")) {
      currentAuthor = line.slice(7);
    } else if (line.startsWith("author-time ")) {
      const ts = parseInt(line.slice(12), 10);
      currentDate = new Date(ts * 1000).toISOString();
    } else if (line.startsWith("summary ")) {
      currentMessage = line.slice(8);
    } else if (line.startsWith("\t")) {
      // Content line
      result.push({
        line: currentLineNum,
        author: currentAuthor,
        date: currentDate,
        commitHash: currentHash.slice(0, 8),
        commitMessage: currentMessage,
        content: line.slice(1), // remove leading tab
      });
    }
  }

  return result;
}
