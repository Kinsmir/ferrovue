import vue from "@vitejs/plugin-vue";
import ferrovue from "ferrovue/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    include: ["test/**/*.test.ts"],
    server: { deps: { external: [/\/packages\/ferrovue\/dist\//] } },

    hookTimeout: 600_000,
  },
});
