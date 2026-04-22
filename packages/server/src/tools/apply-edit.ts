import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { join, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";

/**
 * abf_apply_edit — the only tool in ABF that writes to disk.
 *
 * Disabled by default. To enable, the user must set `ABF_ENABLE_WRITES=1`.
 * Requires an `expected_old_hash` (sha256 of the on-disk file) so that the
 * edit aborts if anything changed since the agent last read it.
 */
export function registerApplyEditTool(server: McpServer): void {
  server.tool(
    "abf_apply_edit",
    `Atomically write new file contents to disk. WRITE TOOL — disabled unless ABF_ENABLE_WRITES=1 is set.
Requires expected_old_hash (sha256 of the file currently on disk) to prevent overwriting concurrent changes.
For new files pass expected_old_hash="" (empty string) and the file must not yet exist.
ALWAYS run abf_preview_changes first; this tool is the apply step of the plan→preview→apply loop.`,
    {
      file_path: z
        .string()
        .describe("File to write (relative to project root or absolute)"),
      new_content: z.string().describe("Full new file contents to write"),
      expected_old_hash: z
        .string()
        .describe(
          "sha256 of the existing file contents (empty string for new files)",
        ),
      create_if_missing: z
        .boolean()
        .default(false)
        .describe(
          "Allow creating the file (and its parent directories) if it does not exist",
        ),
      dry_run: z
        .boolean()
        .default(false)
        .describe("Validate hash and inputs but do not write"),
    },
    async ({
      file_path,
      new_content,
      expected_old_hash,
      create_if_missing,
      dry_run,
    }) => {
      if (process.env.ABF_ENABLE_WRITES !== "1") {
        return text(
          "abf_apply_edit is disabled. Set ABF_ENABLE_WRITES=1 to allow ABF to write files.",
        );
      }

      const cwd = process.env.ABF_PROJECT_ROOT || process.cwd();
      const abs = isAbsolute(file_path) ? file_path : join(cwd, file_path);

      try {
        const fileExists = existsSync(abs);

        if (!fileExists) {
          if (!create_if_missing) {
            return text(
              `Error: ${file_path} does not exist. Pass create_if_missing=true to create it.`,
            );
          }
          if (expected_old_hash !== "") {
            return text(
              `Error: ${file_path} does not exist but expected_old_hash is non-empty. Pass "" for new files.`,
            );
          }
        } else {
          const current = readFileSync(abs, "utf-8");
          const currentHash = sha256(current);
          if (currentHash !== expected_old_hash) {
            return text(
              [
                `Error: hash mismatch for ${file_path}.`,
                `  expected: ${expected_old_hash}`,
                `  actual:   ${currentHash}`,
                "",
                "The file changed since you last read it. Re-read the file, recompute the hash, and try again.",
              ].join("\n"),
            );
          }
          if (current === new_content) {
            return text(
              `No changes: new_content is identical to current contents of ${file_path}.`,
            );
          }
        }

        const newHash = sha256(new_content);
        const summary = [
          `${dry_run ? "[dry-run] would write" : "Wrote"} ${file_path}`,
          `  bytes: ${Buffer.byteLength(new_content, "utf-8")}`,
          `  new_sha256: ${newHash}`,
        ].join("\n");

        if (dry_run) return text(summary);

        // Atomic write: temp file + rename
        if (!fileExists) {
          mkdirSync(dirname(abs), { recursive: true });
        }
        const tmp = `${abs}.abf-tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, new_content, "utf-8");
        try {
          renameSync(tmp, abs);
        } catch (err) {
          try {
            unlinkSync(tmp);
          } catch {
            // ignore
          }
          throw err;
        }

        return text(summary);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return text(`Error: ${msg}`);
      }
    },
  );
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}
