import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerDependenciesTool } from "../tools/dependencies.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_dependencies", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("lists imports for a file", async () => {
    fx.write("src/util.ts", `export function helper() { return 1; }\n`);
    fx.write(
      "src/main.ts",
      `import { helper } from "./util";\nexport function run() { return helper(); }\n`,
    );
    fx.gitInit();
    const cap = captureTool();
    registerDependenciesTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/main.ts", direction: "imports", depth: 1 }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Imports from src\/main\.ts/);
    expect(t).toMatch(/\.\/util/);
    expect(t).toMatch(/helper/);
  });

  it("lists reverse dependencies (imported_by)", async () => {
    fx.write("src/util.ts", `export function helper() { return 1; }\n`);
    fx.write("src/main.ts", `import { helper } from "./util";\nhelper();\n`);
    fx.gitInit();
    const cap = captureTool();
    registerDependenciesTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/util.ts",
        direction: "imported_by",
        depth: 1,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Imported by/);
    expect(t).toMatch(/src\/main\.ts/);
  });

  it("reports (none) for a leaf file with no imports", async () => {
    fx.write("src/leaf.ts", `export const X = 1;\n`);
    fx.gitInit();
    const cap = captureTool();
    registerDependenciesTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ file_path: "src/leaf.ts", direction: "both", depth: 1 }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Imports from src\/leaf\.ts/);
    expect(t).toMatch(/\(none\)/);
  });
});
