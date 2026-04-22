import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerSearchMultiTool } from "../tools/search-multi.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_search_multi", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("merges exact and keyword results with weighted scoring", async () => {
    fx.write(
      "src/login.ts",
      `export function login() { /* authentication */ return true; }\n`,
    );
    fx.write("src/profile.ts", `export function profile() { return "p"; }\n`);
    fx.write(
      "src/auth.ts",
      `// authentication helpers\nexport const token = "x";\n`,
    );
    fx.gitInit();

    const cap = captureTool();
    registerSearchMultiTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        queries: [
          { query: "login", mode: "exact", weight: 2 },
          { query: "authentication", mode: "keyword", weight: 1 },
        ],
        max_results: 10,
      }),
    );

    const t = textOf(out);
    expect(t).toContain("Merged results");
    expect(t).toMatch(/src\/login\.ts/);
    // login.ts should rank top — both queries hit it
    const loginIdx = t.indexOf("src/login.ts");
    const profileIdx = t.indexOf("src/profile.ts");
    if (profileIdx > -1) {
      expect(loginIdx).toBeLessThan(profileIdx);
    }
  });

  it("returns 'No merged results' when nothing matches", async () => {
    fx.write("src/x.ts", `export const greeting = "hello world";\n`);
    fx.gitInit();

    const cap = captureTool();
    registerSearchMultiTool(cap.server as any);

    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        queries: [
          { query: "definitelyNotPresentXYZ123", mode: "exact", weight: 1 },
        ],
        max_results: 10,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/No merged results/);
  });
});
