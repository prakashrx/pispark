import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), ...(mode === "test" ? [svelteTesting()] : [])],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.PISPARK_API_TARGET ?? "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  // One KaTeX for math and for diagrams (both ask for 0.18): npm keeps a copy under each.
  resolve: { dedupe: ["katex"] },
  // CSS is minified like the code: a few colours become 8-digit hex, an alpha change under 1/255.
  test: { environment: "jsdom", include: ["src/**/*.test.ts"], setupFiles: ["src/test-setup.ts"] },
}));
