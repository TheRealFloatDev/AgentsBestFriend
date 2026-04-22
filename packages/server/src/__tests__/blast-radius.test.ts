import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerBlastRadiusTool } from "../tools/blast-radius.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_blast_radius", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("reports impacted importers across depth levels", async () => {
    fx.write("src/core.ts", `export function shared() { return 1; }\n`);
    fx.write(
      "src/lvl1.ts",
      `import { shared } from "./core";\nexport function l1() { return shared(); }\n`,
    );
    fx.write(
      "src/lvl2.ts",
      `import { l1 } from "./lvl1";\nexport function l2() { return l1(); }\n`,
    );
    fx.write(
      "src/core.test.ts",
      `import { shared } from "./core";\nshared();\n`,
    );
    fx.gitInit();

    const cap = captureTool();
    registerBlastRadiusTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/core.ts",
        depth: 3,
        include_tests: true,
        max_files: 100,
      }),
    );
    const t = textOf(out);
    expect(t).toContain("Blast radius for src/core.ts");
    expect(t).toMatch(/impacted files \(non-test\): 2/);
    expect(t).toMatch(/tests: 1/);
    expect(t).toContain("src/lvl1.ts");
    expect(t).toContain("src/lvl2.ts");
    expect(t).toMatch(/break_risk_score: \d+\/100/);
  });

  it("returns zero impact for an unimported leaf file", async () => {
    fx.write("src/leaf.ts", `export const Z = 0;\n`);
    fx.gitInit();

    const cap = captureTool();
    registerBlastRadiusTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/leaf.ts",
        depth: 3,
        include_tests: true,
        max_files: 100,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/impacted files \(non-test\): 0/);
    expect(t).toMatch(/tests: 0/);
  });
});
