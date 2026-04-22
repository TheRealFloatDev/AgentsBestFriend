import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Minimal McpServer mock that captures the handler registered via `.tool()`.
 * Returns a callable `invoke(input)` for the most recently registered tool.
 */
export function captureTool(): {
  server: { tool: (...args: any[]) => void };
  invoke: (input: any) => Promise<any>;
  name: () => string;
} {
  let captured: { name: string; handler: (input: any) => Promise<any> } | null =
    null;

  const server = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => {
      captured = { name, handler };
    },
  };

  return {
    server,
    invoke: async (input: any) => {
      if (!captured) throw new Error("No tool captured");
      return captured.handler(input);
    },
    name: () => captured?.name ?? "",
  };
}

export function textOf(result: any): string {
  if (!result || !result.content) return "";
  return result.content
    .map((c: any) => (typeof c.text === "string" ? c.text : ""))
    .join("\n");
}

export interface Fixture {
  dir: string;
  write: (relPath: string, content: string) => string;
  cleanup: () => void;
  gitInit: () => void;
}

export function createFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "abf-test-"));

  return {
    dir,
    write(relPath: string, content: string) {
      const abs = join(dir, relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf-8");
      return abs;
    },
    gitInit() {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@example.com"], {
        cwd: dir,
      });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "init", "--allow-empty"], {
        cwd: dir,
      });
    },
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Run a function with ABF_PROJECT_ROOT set to the given dir, restoring after.
 */
export async function withProjectRoot<T>(
  dir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = process.env.ABF_PROJECT_ROOT;
  process.env.ABF_PROJECT_ROOT = dir;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.ABF_PROJECT_ROOT;
    else process.env.ABF_PROJECT_ROOT = prev;
  }
}
