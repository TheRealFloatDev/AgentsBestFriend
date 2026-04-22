import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerSymbolsTool } from "../tools/symbols.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_symbols", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("lists exported functions and classes from a TS file", async () => {
    fx.write(
      "src/api.ts",
      `export function alpha() { return 1; }\n` +
        `export class Beta { method() {} }\n` +
        `function privateOne() {}\n`,
    );

    const cap = captureTool();
    registerSymbolsTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/api.ts", depth: 2 }),
    );
    const t = textOf(out);
    expect(t).toMatch(/alpha/);
    expect(t).toMatch(/Beta/);
    expect(t).toMatch(/L\d+-\d+/);
  });

  it("reports no symbols for an empty file", async () => {
    fx.write("src/empty.ts", `// nothing here\n`);
    const cap = captureTool();
    registerSymbolsTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/empty.ts", depth: 2 }),
    );
    expect(textOf(out)).toMatch(/No symbols found/);
  });

  it("returns an error for a missing file", async () => {
    const cap = captureTool();
    registerSymbolsTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/does-not-exist.ts", depth: 2 }),
    );
    expect(textOf(out)).toMatch(/Error:/);
  });
});
