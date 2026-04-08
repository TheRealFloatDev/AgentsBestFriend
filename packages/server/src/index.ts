#!/usr/bin/env node

export { createAbfServer, startStdioServer } from "./server.js";
export { registerPingTool } from "./tools/ping.js";

// ─── Standalone Entry Point ──────────────────────────────────────────────────
// When run directly (e.g. `node dist/index.js`), start the stdio server.
import { startStdioServer } from "./server.js";

startStdioServer().catch((error) => {
  console.error("Fatal: Failed to start ABF MCP server:", error);
  process.exit(1);
});
