import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerImpactTool } from "../tools/impact.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_impact", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("finds references and classifies definitions, imports and calls", async () => {
    fx.write("src/api.ts", `export function compute() { return 1; }\n`);
    fx.write(
      "src/use.ts",
      `import { compute } from "./api";\nexport function r() { return compute(); }\n`,
    );
    fx.gitInit();
    const cap = captureTool();
    registerImpactTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ symbol: "compute" }),
    );
    const t = textOf(out);
    expect(t).toMatch(/references to "compute"/);
    expect(t).toMatch(/src\/api\.ts/);
    expect(t).toMatch(/src\/use\.ts/);
    expect(t).toMatch(/\[definition\]/);
    expect(t).toMatch(/\[import\]/);
  });

  it("reports no references for an unknown symbol", async () => {
    fx.write("src/x.ts", `export const Y = 1;\n`);
    fx.gitInit();
    const cap = captureTool();
    registerImpactTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ symbol: "totallyMissingSymbolXyz" }),
    );
    expect(textOf(out)).toMatch(/No references found/);
  });
});
