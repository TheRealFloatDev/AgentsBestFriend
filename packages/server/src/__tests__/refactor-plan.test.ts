import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerRefactorPlanTool } from "../tools/refactor-plan.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_refactor_plan", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("rejects invalid new_name identifier", async () => {
    fx.write("src/a.ts", `export function alpha() {}\n`);
    const cap = captureTool();
    registerRefactorPlanTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        intent: "rename",
        file_path: "src/a.ts",
        target_symbol: "alpha",
        new_name: "1invalid-name",
        max_files: 50,
      }),
    );
    expect(textOf(out)).toMatch(/not a valid identifier/);
  });

  it("rejects rename to the same name", async () => {
    fx.write("src/a.ts", `export function alpha() {}\n`);
    const cap = captureTool();
    registerRefactorPlanTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        intent: "rename",
        file_path: "src/a.ts",
        target_symbol: "alpha",
        new_name: "alpha",
        max_files: 50,
      }),
    );
    expect(textOf(out)).toMatch(/equals current name/);
  });

  it("plans a rename across importers and detects collisions", async () => {
    fx.write(
      "src/a.ts",
      `export function alpha() { return 1; }\nexport function beta() { return 2; }\n`,
    );
    fx.write(
      "src/b.ts",
      `import { alpha } from "./a";\nexport function callsite() { return alpha(); }\n`,
    );
    fx.gitInit();

    const cap = captureTool();
    registerRefactorPlanTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        intent: "rename",
        file_path: "src/a.ts",
        target_symbol: "alpha",
        new_name: "beta", // collides with existing beta
        max_files: 50,
      }),
    );

    const t = textOf(out);
    expect(t).toContain("Refactor plan: rename function alpha -> beta");
    expect(t).toMatch(/naming collision/);
    expect(t).toContain("Ordered edit plan");
    expect(t).toContain("src/a.ts");
  });

  it("returns guidance for extract intent", async () => {
    fx.write("src/c.ts", `export function bigOne() { return 1; }\n`);
    const cap = captureTool();
    registerRefactorPlanTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        intent: "extract",
        file_path: "src/c.ts",
        target_symbol: "bigOne",
        max_files: 50,
      }),
    );
    const t = textOf(out);
    expect(t).toContain("Refactor plan: extract function bigOne");
    expect(t).toMatch(/Ordered guidance/);
  });

  it("errors when symbol is not found", async () => {
    fx.write("src/d.ts", `export const x = 1;\n`);
    const cap = captureTool();
    registerRefactorPlanTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        intent: "rename",
        file_path: "src/d.ts",
        target_symbol: "nope",
        new_name: "renamed",
        max_files: 50,
      }),
    );
    expect(textOf(out)).toMatch(/not found in src\/d\.ts/);
  });
});
