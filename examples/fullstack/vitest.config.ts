/* The hydration test: the Rust server's HTML, hydrated by the client in happy-dom. */
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
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
