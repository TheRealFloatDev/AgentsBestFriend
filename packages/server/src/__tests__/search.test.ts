import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerSearchTool } from "../tools/search.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_search", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("exact mode finds matching lines", async () => {
    fx.write(
      "src/a.ts",
      `export const NEEDLE_TOKEN = 1;\nexport const other = 2;\n`,
    );
    fx.gitInit();
    const cap = captureTool();
    registerSearchTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ query: "NEEDLE_TOKEN", mode: "exact", max_results: 10 }),
    );
    const t = textOf(out);
    expect(t).toMatch(/NEEDLE_TOKEN/);
    expect(t).toMatch(/src\/a\.ts/);
  });

  it("exact mode reports no matches gracefully", async () => {
    fx.write("src/a.ts", `export const X = 1;\n`);
    fx.gitInit();
    const cap = captureTool();
    registerSearchTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        query: "definitelyMissingNeedle12345",
        mode: "exact",
        max_results: 10,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/no matches|No results|0 matches|No matches/i);
  });

  it("keyword mode ranks files by keyword density", async () => {
    fx.write(
      "src/auth.ts",
      `// authentication and authorization helpers\nexport function authToken() {}\n`,
    );
    fx.write("src/unrelated.ts", `export const x = 1;\n`);
    fx.gitInit();
    const cap = captureTool();
    registerSearchTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        query: "authentication authorization",
        mode: "keyword",
        max_results: 10,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/src\/auth\.ts/);
  });
});
