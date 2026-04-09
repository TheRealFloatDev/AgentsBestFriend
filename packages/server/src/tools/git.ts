import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  isGitRepo,
  getRecentCommits,
  getFileHistory,
  getBlame,
  getDiff,
} from "@abf/core/git";

const GitActionSchema = z.enum(["log", "file_history", "blame", "diff"]);

export function registerGitTool(server: McpServer): void {
  server.tool(
    "abf_git",
    "Query git history, blame, and diff for the project.",
    {
      action: GitActionSchema.describe(
        "Git action: log (recent commits), file_history, blame, diff",
      ),
      file_path: z
        .string()
        .optional()
        .describe(
          "File path (required for file_history, blame; optional for diff)",
        ),
      count: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe("Number of commits (log, file_history)"),
      line_start: z
        .number()
        .int()
        .optional()
        .describe("Start line for blame range"),
      line_end: z
        .number()
        .int()
        .optional()
        .describe("End line for blame range"),
    },
    async ({ action, file_path, count, line_start, line_end }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();

      if (!(await isGitRepo(cwd))) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Current directory is not a git repository.",
            },
          ],
        };
      }

      try {
        let text: string;

        switch (action) {
          case "log": {
            const commits = await getRecentCommits(cwd, count);
            text = formatCommits(commits);
            break;
          }
          case "file_history": {
            if (!file_path) {
              return errorResult(
                "file_history requires a `file_path` parameter.",
              );
            }
            const history = await getFileHistory(cwd, file_path, count);
            text =
              `History for ${history.filePath}:\n` +
              formatCommits(history.commits);
            break;
          }
          case "blame": {
            if (!file_path) {
              return errorResult("blame requires a `file_path` parameter.");
            }
            const range =
              line_start && line_end
                ? ([line_start, line_end] as [number, number])
                : undefined;
            const blameLines = await getBlame(cwd, file_path, range);
            text = formatBlame(blameLines);
            break;
          }
          case "diff": {
            const diff = await getDiff(cwd, file_path);
            const { filesChanged, insertions, deletions } = diff.stats;
            const header = `${filesChanged} file(s) changed, +${insertions} -${deletions}`;
            text = diff.combined
              ? `${header}\n\n${truncate(diff.combined, 8000)}`
              : "No changes.";
            break;
          }
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`Git error: ${msg}`);
      }
    },
  );
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatCommits(
  commits: {
    shortHash: string;
    author: string;
    date: string;
    message: string;
    filesChanged?: number;
  }[],
): string {
  if (commits.length === 0) return "No commits found.";
  return commits
    .map((c) => {
      const files = c.filesChanged != null ? ` (${c.filesChanged} files)` : "";
      return `${c.shortHash} ${c.date.slice(0, 10)} ${c.author}: ${c.message}${files}`;
    })
    .join("\n");
}

function formatBlame(
  lines: {
    line: number;
    commitHash: string;
    author: string;
    date: string;
    content: string;
  }[],
): string {
  if (lines.length === 0) return "No blame data.";
  return lines
    .map(
      (l) =>
        `${l.line}\t${l.commitHash} ${l.author.padEnd(12).slice(0, 12)} ${l.date.slice(0, 10)}\t${l.content}`,
    )
    .join("\n");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n... (truncated)";
}

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
}
