import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __ABF_VERSION__: JSON.stringify("test"),
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"],
  },
});
