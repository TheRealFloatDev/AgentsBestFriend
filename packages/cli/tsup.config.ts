import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  // Bundle workspace packages (@abf/core, @abf/server) into the output
  noExternal: ["@abf/core", "@abf/server"],
  // Keep native addons and CJS-heavy packages as external
  external: ["better-sqlite3", "fsevents", "ts-morph"],
});
