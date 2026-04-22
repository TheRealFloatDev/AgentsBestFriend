import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerProjectOverviewTool } from "../tools/project-overview.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_project_overview", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("detects basic tech stack from package.json + sources", async () => {
    fx.write(
      "package.json",
      JSON.stringify(
        {
          name: "demo",
          version: "1.0.0",
          dependencies: { react: "^18.0.0" },
          devDependencies: { vitest: "^1.0.0" },
        },
        null,
        2,
      ),
    );
    fx.write("src/index.ts", `export function main() { return 1; }\n`);
    fx.write("src/util.ts", `export const x = 1;\n`);
    fx.gitInit();

    const cap = captureTool();
    registerProjectOverviewTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ detail_level: "compact" }),
    );
    const t = textOf(out);
    expect(t).toMatch(/^# /m);
    expect(t).toMatch(/Languages/);
    expect(t).toMatch(/typescript/i);
    expect(t).toMatch(/React|Vitest|Node\.js/);
  });
});
