import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerNotesTool } from "../tools/notes.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_notes", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("save → list → search → get → delete roundtrip", async () => {
    const cap = captureTool();
    registerNotesTool(cap.server as any);

    await withProjectRoot(fx.dir, async () => {
      const saved = await cap.invoke({
        action: "save",
        title: "Architecture Decision",
        content: "Use SQLite with FTS5 for note search.",
        tags: "architecture,decision",
      });
      const savedText = textOf(saved);
      expect(savedText).toMatch(/Note #\d+ saved/);
      const id = parseInt(savedText.match(/Note #(\d+)/)![1], 10);

      const listed = await cap.invoke({ action: "list", limit: 10 });
      expect(textOf(listed)).toMatch(/Architecture Decision/);

      const searched = await cap.invoke({
        action: "search",
        query: "SQLite",
        limit: 10,
      });
      expect(textOf(searched)).toMatch(/Architecture Decision/);

      const got = await cap.invoke({ action: "get", id });
      expect(textOf(got)).toMatch(/SQLite with FTS5/);

      const del = await cap.invoke({ action: "delete", id });
      expect(textOf(del)).toMatch(/deleted|removed|#\d+/i);
    });
  });

  it("save without title/content reports validation error", async () => {
    const cap = captureTool();
    registerNotesTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({ action: "save", title: "only-title" }),
    );
    expect(textOf(out)).toMatch(/requires .*title.*content/);
  });
});
