import * as clack from "@clack/prompts";
import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SKILL_AGENTS = [
  { value: "cursor", label: "Cursor" },
  { value: "github-copilot", label: "VS Code / GitHub Copilot" },
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "cline", label: "Cline" },
  { value: "gemini-cli", label: "Gemini CLI" },
  { value: "goose", label: "Goose" },
  { value: "opencode", label: "OpenCode" },
] as const;

export function getSkillDir(): string | null {
  // The skills asset ships at <package>/assets/skills/ (sibling to dist/)
  const candidates = [
    // Installed via npm/npx — assets is sibling to dist/
    join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "skills"),
    // Monorepo dev — two levels up from dist/
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "assets",
      "skills",
    ),
  ];

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(join(resolved, "abf", "SKILL.md"))) return resolved;
  }

  return null;
}

export async function installSkill(projectRoot: string): Promise<void> {
  const doInstall = await clack.confirm({
    message:
      "Install ABF workflow skill? (Teaches agents to prefer ABF tools over native read_file/grep)",
    initialValue: true,
  });

  if (clack.isCancel(doInstall) || !doInstall) return;

  const skillDir = getSkillDir();
  if (!skillDir) {
    clack.log.warn("Could not find bundled skill asset — skipping.");
    return;
  }

  const agentChoice = await clack.select({
    message: "Install skill for which agents?",
    options: [
      {
        value: "all",
        label: "All detected agents",
        hint: "Auto-detects installed agents",
      },
      {
        value: "pick",
        label: "Let me pick",
      },
    ],
  });

  if (clack.isCancel(agentChoice)) return;

  let skillAgentArgs: string[] = [];

  if (agentChoice === "pick") {
    const selected = await clack.multiselect({
      message: "Which agents should get the ABF skill?",
      options: SKILL_AGENTS.map((a) => ({
        value: a.value,
        label: a.label,
      })),
      required: true,
    });

    if (clack.isCancel(selected)) return;

    for (const agent of selected) {
      skillAgentArgs.push("-a", agent);
    }
  }

  const scope = await clack.select({
    message: "Skill installation scope?",
    options: [
      {
        value: "project",
        label: "Project (default)",
        hint: "Committed with your repo, shared with team",
      },
      {
        value: "global",
        label: "Global",
        hint: "Available across all projects",
      },
    ],
  });

  if (clack.isCancel(scope)) return;

  const skillArgs = [
    "skills",
    "add",
    skillDir,
    "--skill",
    "abf",
    "--copy",
    "-y",
  ];
  if (agentChoice === "all") {
    skillArgs.push("--all");
  } else {
    skillArgs.push(...skillAgentArgs);
  }
  if (scope === "global") {
    skillArgs.push("-g");
  }

  const skillSpinner = clack.spinner();
  skillSpinner.start("Installing ABF skill...");

  try {
    await execFileAsync("npx", skillArgs, {
      cwd: projectRoot,
      timeout: 60_000,
    });
    skillSpinner.stop("ABF skill installed successfully");
    clack.log.info(
      "Agents will now prefer ABF tools for all code navigation.\nRun `abf skill` anytime to update the skill to the latest version.",
    );
  } catch (err) {
    skillSpinner.stop("Skill installation failed");
    const msg = err instanceof Error ? err.message : String(err);
    clack.log.warn(
      `Could not install skill: ${msg}\nYou can install manually: npx skills add ${skillDir} --skill abf --copy -y`,
    );
  }
}

export async function skillCommand(projectPath: string): Promise<void> {
  const root = resolve(projectPath);

  clack.intro("ABF Skill");

  if (!existsSync(root)) {
    clack.log.error(`Path does not exist: ${root}`);
    process.exit(1);
  }

  await installSkill(root);

  clack.outro("Done!");
}
