import vue from "@vitejs/plugin-vue";
import ferrovue from "ferrovue/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue({ features: { componentIdGenerator: "filepath" } }), ferrovue({ root: import.meta.dirname })],
  build: {
    manifest: true,
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: { input: "client/main.ts" },
  },
  server: {
    origin: "http://localhost:5173",
    port: 5173,
    strictPort: true,
  },
});
