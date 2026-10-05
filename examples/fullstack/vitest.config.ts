/* The hydration test: the Rust server's HTML, hydrated by the client in happy-dom. */
import vue from "@vitejs/plugin-vue";
import ferrovue from "ferrovue/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Scope ids as the client build computes them (`vite.config.ts`), and `ferrovue/islands`.
  plugins: [vue({ features: { componentIdGenerator: "filepath" } }), ferrovue({ root: import.meta.dirname })],
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        url: "http://localhost:3000/",
        settings: {
          navigation: { disableChildFrameNavigation: true },
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
        },
      },
    },
    include: ["test/**/*.test.ts"],
    // The first run compiles the server.
    hookTimeout: 600_000,
  },
});
