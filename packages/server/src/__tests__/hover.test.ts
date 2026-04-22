import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerHoverTool } from "../tools/hover.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_hover", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("returns the inferred type signature for a function", async () => {
    fx.write(
      "src/m.ts",
      `/** Adds two numbers. */\nexport function add(a: number, b: number): number { return a + b; }\nexport const r = add(1, 2);\n`,
    );

    const cap = captureTool();
    registerHoverTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/m.ts", symbol: "add" }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Type:/);
    expect(t).toMatch(/add/);
    expect(t).toMatch(/number/);
    // JSDoc should appear in Docs section
    expect(t).toMatch(/Adds two numbers/);
  });

  it("reports missing symbol", async () => {
    fx.write("src/m.ts", `export const X = 1;\n`);
    const cap = captureTool();
    registerHoverTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/m.ts", symbol: "missing" }),
    );
    expect(textOf(out)).toMatch(/not found/);
  });
});
