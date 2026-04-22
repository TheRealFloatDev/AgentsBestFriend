import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerIndexTool } from "../tools/index-tool.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_index", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("status returns indexed/total/last-updated info", async () => {
    fx.write("src/x.ts", `export const X = 1;\n`);
    fx.gitInit();
    const cap = captureTool();
    registerIndexTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ action: "status" }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Indexed files:/);
    expect(t).toMatch(/Last updated:/);
    expect(t).toMatch(/Index size:/);
  });
});
