#!/usr/bin/env node

import { Command } from "commander";
import { startCommand } from "./commands/start.js";

const program = new Command();

program
  .name("abf")
  .description("AgentsBestFriend — AI-first code navigation and analysis tools")
  .version(__ABF_VERSION__);

program
  .command("start")
  .description("Start the MCP server in stdio mode (for AI agent connections)")
  .action(async () => {
    await startCommand();
  });

program
  .command("init")
  .description("Initialize ABF index in the current (or specified) project")
  .argument("[path]", "Project path to initialize", ".")
  .action(async (path: string) => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand(path);
  });

program
  .command("index")
  .description("Trigger manual indexing of the current project")
  .argument("[path]", "Project path to index", ".")
  .action(async (path: string) => {
    const { indexCommand } = await import("./commands/index-cmd.js");
    await indexCommand(path);
  });

program
  .command("portal")
  .description("Interactive terminal dashboard for managing ABF")
  .action(async () => {
    const { portalCommand } = await import("./commands/portal.js");
    await portalCommand();
  });

program
  .command("config")
  .description("View or edit global ABF configuration interactively")
  .action(async () => {
    const { configCommand } = await import("./commands/config.js");
    await configCommand();
  });

program
  .command("status")
  .description("Show index status of the current project")
  .argument("[path]", "Project path to check", ".")
  .action(async (path: string) => {
    const { statusCommand } = await import("./commands/status.js");
    await statusCommand(path);
  });

program
  .command("doctor")
  .description("Check system health (Ollama, ripgrep, git, etc.)")
  .action(async () => {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand();
  });

program.parse();
