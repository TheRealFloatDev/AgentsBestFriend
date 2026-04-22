import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerRelatedTestsTool } from "../tools/related-tests.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_related_tests", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("ranks name-matched test files highest", async () => {
    fx.write("src/widget.ts", `export function build() { return 1; }\n`);
    fx.write(
      "src/widget.test.ts",
      `import { build } from "./widget";\nbuild();\n`,
    );
    fx.write("src/unrelated.test.ts", `// totally unrelated\n`);
    fx.gitInit();

    const cap = captureTool();
    registerRelatedTestsTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        file_path: "src/widget.ts",
        max_results: 10,
      }),
    );
    const t = textOf(out);
    expect(t).toContain("Related tests");
    expect(t).toMatch(/\[high\/\d+\] src\/widget\.test\.ts/);
    expect(t).toMatch(/name match/);
    expect(t).toMatch(/imports source/);
    expect(t).not.toContain("src/unrelated.test.ts");
  });

  it("matches by symbol mention even without file_path", async () => {
    fx.write(
      "src/__tests__/something.test.ts",
      `it("uses uniqueSymbolName", () => { uniqueSymbolName(); uniqueSymbolName(); });\n`,
    );
    fx.gitInit();

    const cap = captureTool();
    registerRelatedTestsTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        symbol: "uniqueSymbolName",
        max_results: 10,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/mentions "uniqueSymbolName"/);
  });

  it("errors when neither file_path nor symbol is given", async () => {
    const cap = captureTool();
    registerRelatedTestsTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ max_results: 10 }),
    );
    expect(textOf(out)).toMatch(/Provide at least one/);
  });
});
