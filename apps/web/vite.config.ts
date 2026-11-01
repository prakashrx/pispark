import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), ...(mode === "test" ? [svelteTesting()] : [])],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
  // Preserve source alpha values: CSS minification rounds .7 to 8-bit hex alpha.
  build: { cssMinify: false },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
}));
