import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: [{ find: /^ferrovue\/client$/, replacement: fileURLToPath(new URL("../src/client.ts", import.meta.url)) }] },
  test: {
    root: import.meta.dirname,
    environment: "happy-dom",
    include: ["vue-render.fuzz.ts"],
    globals: false,
    testTimeout: 600_000,
    reporters: ["dot"],
  },
});
