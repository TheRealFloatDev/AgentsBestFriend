import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerContextBundleTool } from "../tools/context-bundle.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_context_bundle", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("bundles entry file with its imports (smart mode)", async () => {
    fx.write("src/util.ts", `export function helper() { return 1; }\n`);
    fx.write(
      "src/main.ts",
      `import { helper } from "./util";\nexport function run() { return helper(); }\n`,
    );
    fx.gitInit();
    const cap = captureTool();
    registerContextBundleTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        entry: "src/main.ts",
        depth: 1,
        include: "smart",
        reverse: false,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/main\.ts/);
    expect(t).toMatch(/util\.ts/);
    expect(t).toMatch(/helper/);
  });

  it("returns an empty bundle for a missing entry file", async () => {
    const cap = captureTool();
    registerContextBundleTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        entry: "src/missing.ts",
        depth: 1,
        include: "smart",
        reverse: false,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Bundle for src\/missing\.ts/);
    expect(t).toMatch(/Files: 0/);
  });
});
