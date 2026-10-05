import { join } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: join(import.meta.dirname, "../../.."),
  plugins: [vue()],
  resolve: { alias: [{ find: /^ferrovue\/client$/, replacement: join(import.meta.dirname, "../src/client.ts") }] },
  test: {
    environment: "node",
    include: ["packages/ferrovue/bench/**/*.bench.ts"],
    fileParallelism: false,
    disableConsoleIntercept: true,
    testTimeout: 10 * 60_000,
    globals: false,
  },
});
