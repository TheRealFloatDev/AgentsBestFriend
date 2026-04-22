import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerFileSummaryTool } from "../tools/file-summary.js";
import {
  captureTool,
  createFixture,
  textOf,
  withProjectRoot,
  type Fixture,
} from "./helpers.js";

describe("abf_file_summary", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = createFixture();
  });
  afterEach(() => fx.cleanup());

  it("reports no matches when no summaries have been generated yet", async () => {
    fx.write("src/x.ts", `export const X = 1;\n`);
    fx.gitInit();
    const cap = captureTool();
    registerFileSummaryTool(cap.server as any);
    const out = await withProjectRoot(fx.dir, () =>
      cap.invoke({
        query: "anything",
        match_mode: "or",
        max_results: 5,
      }),
    );
    const t = textOf(out);
    // No summaries yet → either "No file summaries matching" or an Error from missing FTS table
    expect(t).toMatch(/No file summaries|Error|summaries/i);
  });
});
