import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerCallGraphTool } from "../tools/call-graph.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_call_graph", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("walks callees inside the same file", async () => {
    fx.write(
      "src/m.ts",
      `function leaf() { return 1; }\nfunction mid() { return leaf(); }\nexport function root() { return mid(); }\n`,
    );
    fx.gitInit();

    const cap = captureTool();
    registerCallGraphTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        symbol: "root",
        file_path: "src/m.ts",
        direction: "callees",
        depth: 2,
        max_files: 50,
        max_edges: 100,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Call graph for root/);
    expect(t).toMatch(/Callees/);
    expect(t).toMatch(/root.*→.*mid/);
    expect(t).toMatch(/mid.*→.*leaf/);
  });

  it("walks callers across files", async () => {
    fx.write("src/api.ts", `export function shared() { return 1; }\n`);
    fx.write(
      "src/use.ts",
      `import { shared } from "./api";\nexport function caller() { return shared(); }\n`,
    );
    fx.gitInit();

    const cap = captureTool();
    registerCallGraphTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        symbol: "shared",
        file_path: "src/api.ts",
        direction: "callers",
        depth: 1,
        max_files: 50,
        max_edges: 100,
      }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Callers/);
    expect(t).toMatch(/caller.*→.*shared/);
  });

  it("reports symbol-not-found", async () => {
    fx.write("src/m.ts", `export const X = 1;\n`);
    fx.gitInit();
    const cap = captureTool();
    registerCallGraphTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        symbol: "nope",
        file_path: "src/m.ts",
        direction: "both",
        depth: 1,
        max_files: 50,
        max_edges: 100,
      }),
    );
    expect(textOf(out)).toMatch(/not found as a function\/method/);
  });
});
