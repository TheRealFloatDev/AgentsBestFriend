import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Register the `abf_ping` tool — a simple health-check / connectivity test.
 */
export function registerPingTool(server: McpServer): void {
  server.tool(
    "abf_ping",
    "Health check tool. Returns server status and project root. Use this to verify the ABF MCP server is running correctly.",
    {
      include_config: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include current ABF configuration in the response"),
    },
    async ({ include_config }) => {
      const projectRoot = process.env.ABF_PROJECT_ROOT || process.cwd();

      const status: Record<string, unknown> = {
        status: "ok",
        server: "agents-best-friend",
        version: __ABF_VERSION__,
        projectRoot,
        timestamp: new Date().toISOString(),
      };

      if (include_config) {
        try {
          const { loadConfig } = await import("@abf/core/config");
          status.config = loadConfig();
        } catch {
          status.config = "unable to load config";
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    },
  );
}
