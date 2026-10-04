/* The client build: Vue's plugin compiles the components for the browser, and ferrovue's
 * regenerates the Rust renderers in `src/generated/` from the same files — once per build, and on
 * every change while the dev server runs. */
import vue from "@vitejs/plugin-vue";
import ferrovue from "ferrovue/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), ferrovue({ root: import.meta.dirname })],
  build: {
    // The server reads the manifest to find the entry's hashed file names.
    manifest: true,
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: { input: "client/main.ts" },
  },
  server: {
    // The Rust server's pages load the scripts from here when `VITE_DEV_SERVER` is set.
    origin: "http://localhost:5173",
    port: 5173,
    strictPort: true,
  },
});
