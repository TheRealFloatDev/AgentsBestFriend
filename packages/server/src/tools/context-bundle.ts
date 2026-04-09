import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildContextBundle, formatContextBundle } from "@abf/core/analysis";

export function registerContextBundleTool(server: McpServer): void {
  server.tool(
    "abf_context_bundle",
    `Bundle multi-file context around an entry point in a single call.
Traverses the import graph from the entry file, collecting symbols and optionally source code from all connected files.
Replaces multiple read_file + abf_symbols + abf_dependencies calls with one compact result.

Modes:
- "signatures": compact — shows exported symbols with type signatures for all files (lowest tokens)
- "full": returns full source code for all files up to the specified depth
- "smart" (default): full source code for the entry file, signatures for dependencies

Use focus_symbol to narrow the bundle to only imports relevant to a specific function/class.
Use reverse=true to also find files that import the entry file.`,
    {
      entry: z
        .string()
        .describe("Entry file path (relative to project root or absolute)"),
      depth: z
        .number()
        .int()
        .min(0)
        .max(4)
        .default(1)
        .describe(
          "How deep to follow the import graph (0 = entry only, default: 1)",
        ),
      include: z
        .enum(["signatures", "full", "smart"])
        .default("smart")
        .describe(
          'What to include: "signatures" (compact types), "full" (source code), "smart" (full entry + signature deps)',
        ),
      focus_symbol: z
        .string()
        .optional()
        .describe(
          "Focus on a specific symbol — only follows imports relevant to this function/class",
        ),
      reverse: z
        .boolean()
        .default(false)
        .describe(
          "Also include files that import the entry file (reverse dependencies)",
        ),
    },
    async ({ entry, depth, include, focus_symbol, reverse }) => {
      const projectRoot = process.env.ABF_PROJECT_ROOT || process.cwd();

      try {
        const result = buildContextBundle({
          entry,
          projectRoot,
          depth,
          include,
          focusSymbol: focus_symbol,
          reverse,
        });

        const formatted = formatContextBundle(result);

        return {
          content: [{ type: "text" as const, text: formatted }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
        };
      }
    },
  );
}
