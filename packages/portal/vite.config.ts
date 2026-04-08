import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyDirFirst: true,
  },
  server: {
    port: 4243,
    proxy: {
      "/api": "http://localhost:4242",
    },
  },
});
