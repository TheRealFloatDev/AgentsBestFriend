import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerChunkTool } from "../tools/chunk.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_chunk", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("returns chunk overview when no symbol or chunk_index given", async () => {
    fx.write(
      "src/m.ts",
      `export function one() { return 1; }\n` +
        `export function two() { return 2; }\n`,
    );
    const cap = captureTool();
    registerChunkTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/m.ts" }),
    );
    const t = textOf(out);
    expect(t).toMatch(/chunks in src\/m\.ts/);
    expect(t).toMatch(/\[0\]/);
  });

  it("returns full source for a named symbol", async () => {
    fx.write(
      "src/m.ts",
      `export function alpha() {\n  return 42;\n}\n` +
        `export function beta() { return 1; }\n`,
    );
    const cap = captureTool();
    registerChunkTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/m.ts", symbol: "alpha" }),
    );
    const t = textOf(out);
    expect(t).toMatch(/alpha/);
    expect(t).toMatch(/return 42/);
    expect(t).not.toMatch(/return 1/);
  });

  it("reports symbol not found", async () => {
    fx.write("src/m.ts", `export const X = 1;\n`);
    const cap = captureTool();
    registerChunkTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/m.ts", symbol: "nope" }),
    );
    expect(textOf(out)).toMatch(/not found/);
  });

  it("errors when chunk_index is out of range", async () => {
    fx.write("src/m.ts", `export const X = 1;\n`);
    const cap = captureTool();
    registerChunkTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/m.ts", chunk_index: 999 }),
    );
    expect(textOf(out)).toMatch(/out of range/);
  });
});
