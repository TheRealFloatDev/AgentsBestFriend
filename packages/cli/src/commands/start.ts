import { startStdioServer } from "@abf/server/server";

/**
 * Start the MCP server in stdio mode.
 * This is called when an AI agent connects to the server.
 *
 * IMPORTANT: This function must NOT write anything to stdout except
 * MCP protocol messages, as stdout is the communication channel.
 */
export async function startCommand(): Promise<void> {
  await startStdioServer();
}
