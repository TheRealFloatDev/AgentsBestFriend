import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ripgrepSearch,
  isRipgrepAvailable,
  keywordSearch,
  semanticSearch,
} from "@abf/core/search";
import { LlmUnavailableError } from "@abf/core/llm";

interface MergedFile {
  file: string;
  totalScore: number;
  contributions: Array<{
    mode: "exact" | "keyword" | "semantic";
    query: string;
    weight: number;
    score: number;
    snippet?: string;
  }>;
}

const QuerySchema = z.object({
  query: z.string().describe("Search query"),
  mode: z
    .enum(["exact", "keyword", "semantic"])
    .describe("Search mode for this sub-query"),
  weight: z
    .number()
    .min(0)
    .max(10)
    .default(1)
    .describe("Relative weight for ranking (default 1)"),
});

export function registerSearchMultiTool(server: McpServer): void {
  server.tool(
    "abf_search_multi",
    `Run multiple search queries (mix of exact, keyword, semantic) in ONE call and merge results
by file with weighted ranking. Reduces round-trips and combines complementary signals.
Each sub-query contributes a normalized score; results are sorted by aggregated score.`,
    {
      queries: z
        .array(QuerySchema)
        .min(1)
        .max(8)
        .describe("Up to 8 sub-queries"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Cap on merged result rows"),
      path_filter: z
        .string()
        .optional()
        .describe("Glob filter applied to exact/keyword sub-queries"),
    },
    async ({ queries, max_results, path_filter }) => {
      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      const merged = new Map<string, MergedFile>();
      const notes: string[] = [];

      for (const q of queries) {
        try {
          if (q.mode === "exact") {
            const rg = await isRipgrepAvailable();
            if (!rg) {
              notes.push(`exact "${q.query}": ripgrep unavailable, skipped`);
              continue;
            }
            const r = await ripgrepSearch({
              query: q.query,
              cwd,
              pathFilter: path_filter,
              maxResults: 100,
              regex: false,
              contextLines: 0,
            });
            const perFile = new Map<string, number>();
            const snippets = new Map<string, string>();
            for (const m of r.matches) {
              perFile.set(m.filePath, (perFile.get(m.filePath) ?? 0) + 1);
              if (!snippets.has(m.filePath)) {
                snippets.set(
                  m.filePath,
                  `L${m.lineNumber}: ${m.lineText.trim().slice(0, 120)}`,
                );
              }
            }
            // Normalize: sqrt(hits) / sqrt(maxHits)
            const maxHits = Math.max(1, ...perFile.values());
            for (const [file, hits] of perFile) {
              const norm = Math.sqrt(hits) / Math.sqrt(maxHits);
              addContribution(merged, file, {
                mode: "exact",
                query: q.query,
                weight: q.weight,
                score: norm,
                snippet: snippets.get(file),
              });
            }
            continue;
          }

          if (q.mode === "keyword") {
            const r = await keywordSearch({
              query: q.query,
              cwd,
              pathFilter: path_filter,
              maxResults: 50,
            });
            const max = Math.max(1, ...r.matches.map((m) => m.score));
            for (const m of r.matches) {
              const norm = m.score / max;
              addContribution(merged, m.filePath, {
                mode: "keyword",
                query: q.query,
                weight: q.weight,
                score: norm,
                snippet: m.topLines[0]
                  ? `L${m.topLines[0].line}: ${m.topLines[0].text.trim().slice(0, 120)}`
                  : undefined,
              });
            }
            continue;
          }

          if (q.mode === "semantic") {
            try {
              const r = await semanticSearch({
                query: q.query,
                cwd,
                maxResults: 50,
              });
              const max = Math.max(1, ...r.matches.map((m) => m.score));
              for (const m of r.matches) {
                const norm = m.score / max;
                addContribution(merged, m.filePath, {
                  mode: "semantic",
                  query: q.query,
                  weight: q.weight,
                  score: norm,
                  snippet: m.summary ? m.summary.slice(0, 120) : undefined,
                });
              }
            } catch (e) {
              if (e instanceof LlmUnavailableError) {
                notes.push(
                  `semantic "${q.query}": LLM unavailable (${e.message}); falling back to keyword`,
                );
                const r = await keywordSearch({
                  query: q.query,
                  cwd,
                  pathFilter: path_filter,
                  maxResults: 50,
                });
                const max = Math.max(1, ...r.matches.map((m) => m.score));
                for (const m of r.matches) {
                  const norm = m.score / max;
                  addContribution(merged, m.filePath, {
                    mode: "keyword",
                    query: q.query,
                    weight: q.weight * 0.7,
                    score: norm,
                    snippet: m.topLines[0]
                      ? `L${m.topLines[0].line}: ${m.topLines[0].text.trim().slice(0, 120)}`
                      : undefined,
                  });
                }
              } else {
                throw e;
              }
            }
            continue;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          notes.push(`${q.mode} "${q.query}": ${msg}`);
        }
      }

      const ranked = Array.from(merged.values())
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, max_results);

      if (ranked.length === 0) {
        const tail = notes.length
          ? `\n\nNotes:\n  - ${notes.join("\n  - ")}`
          : "";
        return text(`No merged results.${tail}`);
      }

      const out: string[] = [];
      out.push(
        `Merged results (${ranked.length} of ${merged.size}, ${queries.length} sub-queries):`,
      );
      out.push("");
      for (const r of ranked) {
        out.push(`${r.file}  score=${r.totalScore.toFixed(3)}`);
        for (const c of r.contributions) {
          const snip = c.snippet ? `  ${truncate(c.snippet, 100)}` : "";
          out.push(
            `   - ${c.mode} "${truncate(c.query, 30)}" w=${c.weight} s=${c.score.toFixed(2)}${snip}`,
          );
        }
      }
      if (notes.length) {
        out.push("");
        out.push("Notes:");
        for (const n of notes) out.push(`  - ${n}`);
      }
      return text(out.join("\n"));
    },
  );
}

function addContribution(
  merged: Map<string, MergedFile>,
  file: string,
  c: {
    mode: "exact" | "keyword" | "semantic";
    query: string;
    weight: number;
    score: number;
    snippet?: string;
  },
): void {
  const entry = merged.get(file) ?? {
    file,
    totalScore: 0,
    contributions: [],
  };
  entry.contributions.push(c);
  entry.totalScore += c.weight * c.score;
  merged.set(file, entry);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
