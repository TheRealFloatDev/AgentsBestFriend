import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  // Inject version at build time so it stays in sync with package.json
  define: {
    __ABF_VERSION__: JSON.stringify(pkg.version),
  },
  // Bundle workspace packages (@abf/core, @abf/server) into the output
  noExternal: ["@abf/core", "@abf/server"],
  // Keep native addons and CJS-heavy packages as external
  external: ["better-sqlite3", "fsevents", "ts-morph"],
});
