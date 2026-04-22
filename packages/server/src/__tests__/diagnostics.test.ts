import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerDiagnosticsTool } from "../tools/diagnostics.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_diagnostics", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("reports clean output for valid TS", async () => {
    fx.write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
    );
    fx.write(
      "src/ok.ts",
      `export function add(a: number, b: number): number { return a + b; }\n`,
    );

    const cap = captureTool();
    registerDiagnosticsTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/ok.ts",
        max_files: 50,
        max_diagnostics: 50,
        include_warnings: true,
      }),
    );
    expect(textOf(out)).toMatch(/No diagnostics for src\/ok\.ts/);
  });

  it("detects type errors", async () => {
    fx.write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
    );
    fx.write(
      "src/bad.ts",
      `export function add(a: number, b: number): number { return a + b; }\nexport const x: number = "string";\n`,
    );

    const cap = captureTool();
    registerDiagnosticsTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/bad.ts",
        max_files: 50,
        max_diagnostics: 50,
        include_warnings: true,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/error/i);
    expect(t).toMatch(/src\/bad\.ts/);
    expect(t).toMatch(/L2:/);
  });
});
