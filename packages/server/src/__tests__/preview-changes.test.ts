import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerPreviewChangesTool } from "../tools/preview-changes.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_preview_changes", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("detects added, removed and modified symbols + import deltas", async () => {
    const oldSrc = `
import { foo } from "./foo";
export function alpha() { return 1; }
export function beta() { return 2; }
`;
    const newSrc = `
import { foo } from "./foo";
import { bar } from "./bar";
export function alpha() { return 1; }
export function gamma() { return 3; }
`;
    fx.write("src/x.ts", oldSrc);

    const cap = captureTool();
    registerPreviewChangesTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/x.ts",
        new_content: newSrc,
        probe_external_usage: false,
        max_diff_hunks: 40,
      }),
    );

    const t = textOf(out);
    expect(t).toContain("Preview for src/x.ts");
    expect(t).toMatch(/\[removed\].*beta/);
    expect(t).toMatch(/\[added\].*gamma/);
    expect(t).toMatch(/\+ \.\/bar/);
  });

  it("flags removed exported symbols as breaking risk", async () => {
    fx.write("src/y.ts", `export function publicApi() { return 42; }\n`);

    const cap = captureTool();
    registerPreviewChangesTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/y.ts",
        new_content: `// removed\n`,
        probe_external_usage: false,
        max_diff_hunks: 10,
      }),
    );

    const t = textOf(out);
    expect(t).toMatch(/breaking:.*publicApi/);
  });

  it("returns empty deltas for identical content", async () => {
    const src = `export const X = 1;\n`;
    fx.write("src/z.ts", src);

    const cap = captureTool();
    registerPreviewChangesTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/z.ts",
        new_content: src,
        probe_external_usage: false,
        max_diff_hunks: 10,
      }),
    );

    const t = textOf(out);
    expect(t).toContain("Symbol changes:\n  (none detected)");
    expect(t).toContain("Import changes:\n  (none)");
  });
});
