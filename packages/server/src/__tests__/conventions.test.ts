import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerConventionsTool } from "../tools/conventions.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_conventions", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("returns either detected conventions or a 'none detected' notice", async () => {
    fx.write(
      "package.json",
      JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    // a few kebab-case files to trigger naming detection
    fx.write("src/user-service.ts", `export const a = 1;\n`);
    fx.write("src/order-service.ts", `export const b = 1;\n`);
    fx.write("src/auth-helper.ts", `export const c = 1;\n`);
    fx.gitInit();

    const cap = captureTool();
    registerConventionsTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ aspect: "all" }),
    );
    const t = textOf(out);
    expect(t).toMatch(/Detected \d+ convention|No conventions detected/);
  });
});
