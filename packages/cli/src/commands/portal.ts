import * as clack from "@clack/prompts";
import { startPortalServer } from "../portal-server.js";
import { loadConfig } from "@abf/core/config";

export async function portalCommand(): Promise<void> {
  const config = loadConfig();
  const port = config.portal.port;

  clack.intro("AgentsBestFriend Portal");

  const s = clack.spinner();
  s.start("Starting portal server...");

  try {
    const { url } = await startPortalServer(port);
    s.stop(`Portal running at ${url}`);

    // Try to open browser
    try {
      const { default: open } = await import("open");
      await open(url);
      clack.log.info("Opened browser");
    } catch {
      clack.log.info(`Open manually: ${url}`);
    }

    clack.log.info("Press Ctrl+C to stop");

    // Keep running until interrupted
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        clack.outro("Portal stopped");
        resolve();
      });
    });
  } catch (error: any) {
    s.stop("Failed to start portal");
    clack.log.error(error.message);
    process.exit(1);
  }
}
