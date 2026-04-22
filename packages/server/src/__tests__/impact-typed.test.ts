import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerImpactTypedTool } from "../tools/impact-typed.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_impact_typed", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("classifies typed references in TS sources", async () => {
    fx.write(
      "src/api.ts",
      `export function compute(x: number) { return x + 1; }\n` +
        `export type Compute = typeof compute;\n`,
    );
    fx.write(
      "src/use.ts",
      `import { compute } from "./api";\n` +
        `export function run() { return compute(5); }\n`,
    );

    const cap = captureTool();
    registerImpactTypedTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        symbol: "compute",
        max_files: 50,
      }),
    );

    const t = textOf(out);
    expect(t).toContain("typed reference");
    expect(t).toMatch(/\[definition\/high\]/);
    expect(t).toMatch(/\[import\/high\]/);
    expect(t).toMatch(/\[call\/high\]/);
    expect(t).toMatch(/Summary:.*definition=/);
  });

  it("ignores symbol mentions inside comments (TS path)", async () => {
    fx.write(
      "src/only-comment.ts",
      `// referencesOnlyHere is just mentioned here\nexport const X = 1;\n`,
    );

    const cap = captureTool();
    registerImpactTypedTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        symbol: "referencesOnlyHere",
        max_files: 10,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/No (typed )?references/);
  });

  it("respects include_kinds filter", async () => {
    fx.write(
      "src/api.ts",
      `export function alpha() { return 1; }\nexport const usage = alpha();\n`,
    );

    const cap = captureTool();
    registerImpactTypedTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        symbol: "alpha",
        include_kinds: ["call"],
        max_files: 10,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/\[call\/high\]/);
    expect(t).not.toMatch(/\[definition\/high\]/);
  });
});
