import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { registerApplyEditTool } from "../tools/apply-edit.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

function sha256(s: string) {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

describe("abf_apply_edit", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => {
    delete process.env.ABF_ENABLE_WRITES;
    fx.cleanup();
  });

  it("is disabled unless ABF_ENABLE_WRITES=1", async () => {
    fx.write("src/x.ts", "old\n");
    const cap = captureTool();
    registerApplyEditTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/x.ts",
        new_content: "new\n",
        expected_old_hash: sha256("old\n"),
        create_if_missing: false,
        dry_run: false,
      }),
    );
    expect(textOf(out)).toMatch(/disabled/);
  });

  it("writes when hash matches and ABF_ENABLE_WRITES=1", async () => {
    process.env.ABF_ENABLE_WRITES = "1";
    fx.write("src/x.ts", "old\n");
    const cap = captureTool();
    registerApplyEditTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/x.ts",
        new_content: "new\n",
        expected_old_hash: sha256("old\n"),
        create_if_missing: false,
        dry_run: false,
      }),
    );
    expect(textOf(out)).toMatch(/Wrote src\/x\.ts/);
    expect(readFileSync(join(fx.dir, "src/x.ts"), "utf-8")).toBe("new\n");
  });

  it("aborts on hash mismatch", async () => {
    process.env.ABF_ENABLE_WRITES = "1";
    fx.write("src/x.ts", "current\n");
    const cap = captureTool();
    registerApplyEditTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/x.ts",
        new_content: "new\n",
        expected_old_hash: sha256("stale\n"),
        create_if_missing: false,
        dry_run: false,
      }),
    );
    expect(textOf(out)).toMatch(/hash mismatch/);
    expect(readFileSync(join(fx.dir, "src/x.ts"), "utf-8")).toBe("current\n");
  });

  it("dry_run validates without writing", async () => {
    process.env.ABF_ENABLE_WRITES = "1";
    fx.write("src/x.ts", "old\n");
    const cap = captureTool();
    registerApplyEditTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/x.ts",
        new_content: "different\n",
        expected_old_hash: sha256("old\n"),
        create_if_missing: false,
        dry_run: true,
      }),
    );
    expect(textOf(out)).toMatch(/\[dry-run\] would write/);
    expect(readFileSync(join(fx.dir, "src/x.ts"), "utf-8")).toBe("old\n");
  });

  it("creates a new file when create_if_missing=true and hash empty", async () => {
    process.env.ABF_ENABLE_WRITES = "1";
    const cap = captureTool();
    registerApplyEditTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/new/file.ts",
        new_content: "export const Y = 2;\n",
        expected_old_hash: "",
        create_if_missing: true,
        dry_run: false,
      }),
    );
    expect(textOf(out)).toMatch(/Wrote src\/new\/file\.ts/);
    expect(readFileSync(join(fx.dir, "src/new/file.ts"), "utf-8")).toBe(
      "export const Y = 2;\n",
    );
  });

  it("refuses to create when create_if_missing=false", async () => {
    process.env.ABF_ENABLE_WRITES = "1";
    const cap = captureTool();
    registerApplyEditTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/missing.ts",
        new_content: "x\n",
        expected_old_hash: "",
        create_if_missing: false,
        dry_run: false,
      }),
    );
    expect(textOf(out)).toMatch(/does not exist/);
  });
});
