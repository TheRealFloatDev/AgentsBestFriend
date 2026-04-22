import { describe, it, expect } from "vitest";
import { registerPingTool } from "../tools/ping.js";
import { captureTool, textOf } from "./helpers.js";

describe("abf_ping", () => {
  it("returns status ok with project root and version", async () => {
    const cap = captureTool();
    registerPingTool(cap.server as any);

    const out = await cap.invoke({ include_config: false });
    const t = textOf(out);
    const json = JSON.parse(t);
    expect(json.status).toBe("ok");
    expect(json.server).toBe("agents-best-friend");
    expect(typeof json.version).toBe("string");
    expect(typeof json.projectRoot).toBe("string");
    expect(typeof json.timestamp).toBe("string");
    expect(json.config).toBeUndefined();
  });

  it("includes config when include_config=true", async () => {
    const cap = captureTool();
    registerPingTool(cap.server as any);

    const out = await cap.invoke({ include_config: true });
    const json = JSON.parse(textOf(out));
    expect("config" in json).toBe(true);
  });
});
