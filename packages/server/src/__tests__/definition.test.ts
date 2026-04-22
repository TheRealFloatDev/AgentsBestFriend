import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerDefinitionTool } from "../tools/definition.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_definition", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("locates a same-file definition by symbol name", async () => {
    fx.write(
      "src/m.ts",
      `export function helper() { return 1; }\nexport function caller() { return helper(); }\n`,
    );

    const cap = captureTool();
    registerDefinitionTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/m.ts",
        symbol: "helper",
        preview_lines: 3,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Definitions for "helper"/);
    expect(t).toMatch(/src\/m\.ts:L1-/);
  });

  it("follows a cross-file import to its definition", async () => {
    fx.write("src/util.ts", `export function helper() { return 1; }\n`);
    fx.write(
      "src/use.ts",
      `import { helper } from "./util";\nexport const x = helper();\n`,
    );

    const cap = captureTool();
    registerDefinitionTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/use.ts",
        symbol: "helper",
        preview_lines: 0,
      }),
    );
    const t = textOf(out);
    // language service should jump to util.ts
    expect(t).toMatch(/src\/util\.ts/);
  });

  it("reports symbol-not-found", async () => {
    fx.write("src/m.ts", `export const X = 1;\n`);
    const cap = captureTool();
    registerDefinitionTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/m.ts",
        symbol: "nope",
        preview_lines: 0,
      }),
    );
    expect(textOf(out)).toMatch(/not found/);
  });
});
