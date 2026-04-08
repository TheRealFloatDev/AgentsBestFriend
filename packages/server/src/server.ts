import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerPingTool } from "./tools/ping.js";
import { registerSearchTool } from "./tools/search.js";
import { registerProjectOverviewTool } from "./tools/project-overview.js";
import { registerGitTool } from "./tools/git.js";
import { registerIndexTool } from "./tools/index-tool.js";
import { registerSymbolsTool } from "./tools/symbols.js";
import { registerChunkTool } from "./tools/chunk.js";
import { registerDependenciesTool } from "./tools/dependencies.js";
import { registerImpactTool } from "./tools/impact.js";
import { registerFileSummaryTool } from "./tools/file-summary.js";
import { registerConventionsTool } from "./tools/conventions.js";

const SERVER_NAME = "agents-best-friend";
const SERVER_VERSION = "0.1.0";

/**
 * Create and configure the ABF MCP server with all tools registered.
 * This does NOT start listening — call startStdioServer() for that.
 */
export function createAbfServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions: [
        "AgentsBestFriend (abf) provides AI-first tools for navigating, searching, and analyzing code repositories.",
        "Available tools help you work more efficiently with less token usage.",
        "Use abf_ping to verify the server is running.",
        "Tools that require an index will auto-initialize the .abf/ directory on first use.",
      ].join(" "),
    },
  );

  // ─── Register All Tools ──────────────────────────────────────────────────
  registerPingTool(server);
  registerSearchTool(server);
  registerProjectOverviewTool(server);
  registerGitTool(server);
  registerIndexTool(server);
  registerSymbolsTool(server);
  registerChunkTool(server);
  registerDependenciesTool(server);
  registerImpactTool(server);
  registerFileSummaryTool(server);
  registerConventionsTool(server);

  return server;
}

/**
 * Create the server and start listening on stdio transport.
 * This is the main entry point for MCP agent connections.
 */
export async function startStdioServer(): Promise<void> {
  const server = createAbfServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
