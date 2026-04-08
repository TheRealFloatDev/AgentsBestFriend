import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyzeProject, type ProjectOverview } from "@abf/core/analysis";

export function registerProjectOverviewTool(server: McpServer): void {
  server.tool(
    "abf_project_overview",
    `Get a comprehensive overview of the current project. Returns detected tech stack, frameworks, entry points, directory structure with purposes, language distribution, config files, and architectural patterns. Very token-efficient way to orient yourself in a new codebase. No index required.`,
    {
      detail_level: z
        .enum(["compact", "detailed"])
        .default("compact")
        .describe(
          '"compact" for top-level summary (default), "detailed" for full directory breakdown',
        ),
    },
    async ({ detail_level }) => {
      const projectRoot = process.env.ABF_PROJECT_ROOT || process.cwd();

      try {
        const overview = await analyzeProject(projectRoot, detail_level);
        return {
          content: [{ type: "text", text: formatOverview(overview) }],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to analyze project: ${error.message ?? String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function formatOverview(o: ProjectOverview): string {
  const lines: string[] = [];

  lines.push(`# ${o.name}`);
  lines.push(
    `Files: ${o.totalFiles} | ~${o.totalLines.toLocaleString()} lines | Package Manager: ${o.packageManager ?? "unknown"}`,
  );
  lines.push("");

  // Tech Stack
  if (o.techStack.runtimes.length > 0) {
    lines.push(`## Runtimes: ${o.techStack.runtimes.join(", ")}`);
  }
  if (o.techStack.frameworks.length > 0) {
    lines.push(`## Frameworks: ${o.techStack.frameworks.join(", ")}`);
  }
  if (o.techStack.buildTools.length > 0) {
    lines.push(`## Build Tools: ${o.techStack.buildTools.join(", ")}`);
  }
  if (o.techStack.testFrameworks.length > 0) {
    lines.push(`## Tests: ${o.techStack.testFrameworks.join(", ")}`);
  }
  if (o.techStack.linters.length > 0) {
    lines.push(`## Linting: ${o.techStack.linters.join(", ")}`);
  }
  lines.push("");

  // Languages
  lines.push("## Languages");
  for (const lang of o.techStack.languages) {
    lines.push(`  ${lang.name}: ${lang.fileCount} files (${lang.percentage}%)`);
  }
  lines.push("");

  // Patterns
  if (o.patterns.length > 0) {
    lines.push(`## Patterns: ${o.patterns.join(", ")}`);
    lines.push("");
  }

  // Entry Points
  if (o.entryPoints.length > 0) {
    lines.push("## Entry Points");
    for (const ep of o.entryPoints) {
      const desc = ep.description ? ` (${ep.description})` : "";
      lines.push(`  [${ep.type}] ${ep.path}${desc}`);
    }
    lines.push("");
  }

  // Directory Structure
  if (o.directoryStructure.length > 0) {
    lines.push("## Key Directories");
    for (const dir of o.directoryStructure) {
      lines.push(`  ${dir.path}/ — ${dir.purpose} (${dir.fileCount} files)`);
    }
    lines.push("");
  }

  // Config Files
  if (o.configFiles.length > 0) {
    lines.push(`## Config Files: ${o.configFiles.join(", ")}`);
  }

  return lines.join("\n");
}
