import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectConventions } from "@abf/core/analysis";

export function registerConventionsTool(server: McpServer): void {
  server.tool(
    "abf_conventions",
    `Detect codebase conventions by analyzing file names, folder structure, design patterns, and config files.
Returns detected conventions with confidence scores and examples.
Purely heuristic — no LLM required. Useful to understand a project's style before making changes.`,
    {
      aspect: z
        .enum(["naming", "structure", "patterns", "formatting", "all"])
        .optional()
        .default("all")
        .describe(
          'Which conventions to detect: "naming" (file/variable casing), "structure" (folder organization), "patterns" (design patterns), "formatting" (indent, quotes, tooling), or "all"',
        ),
    },
    async ({ aspect }) => {
      const projectRoot = process.env.ABF_PROJECT_ROOT || process.cwd();

      try {
        const result = await detectConventions(projectRoot, aspect);

        if (result.conventions.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No conventions detected for aspect "${aspect}". The project may be too small or use non-standard patterns.`,
              },
            ],
          };
        }

        const lines: string[] = [
          `Detected ${result.conventions.length} convention(s)${aspect !== "all" ? ` (${aspect})` : ""}:`,
          "",
        ];

        let currentCategory = "";
        for (const conv of result.conventions) {
          if (conv.category !== currentCategory) {
            if (currentCategory) lines.push("");
            lines.push(`═══ ${conv.category.toUpperCase()} ═══`);
            currentCategory = conv.category;
          }

          const confidence = (conv.confidence * 100).toFixed(0);
          lines.push(`  ${conv.pattern} (${confidence}% confidence)`);
          lines.push(`    ${conv.description}`);
          if (conv.examples.length > 0) {
            lines.push(`    Examples: ${conv.examples.join(", ")}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Conventions detection error: ${error.message ?? String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
