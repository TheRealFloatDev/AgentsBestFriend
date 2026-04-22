import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerGitTool } from "../tools/git.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_git", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("errors when not a git repo", async () => {
    const cap = captureTool();
    registerGitTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ action: "log", count: 5 }),
    );
    expect(textOf(out)).toMatch(/not a git repository/);
  });

  it("returns the git log", async () => {
    fx.write("a.txt", "hello\n");
    fx.gitInit();
    const cap = captureTool();
    registerGitTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ action: "log", count: 5 }),
    );
    const t = textOf(out);
    expect(t).toMatch(/init/);
    expect(t).toMatch(/Test/);
  });

  it("requires file_path for blame", async () => {
    fx.write("a.txt", "x\n");
    fx.gitInit();
    const cap = captureTool();
    registerGitTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ action: "blame", count: 5 }),
    );
    expect(textOf(out)).toMatch(/blame requires/);
  });

  it("returns 'No changes.' when working tree is clean", async () => {
    fx.write("a.txt", "x\n");
    fx.gitInit();
    const cap = captureTool();
    registerGitTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ action: "diff", count: 5 }),
    );
    expect(textOf(out)).toMatch(/No changes\.|file\(s\) changed/);
  });
});
