import { join } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: join(import.meta.dirname, "../../.."),
  plugins: [vue()],
  test: {
    environment: "node",
    include: ["packages/ferrovue/bench/**/*.bench.ts"],
    fileParallelism: false,
    disableConsoleIntercept: true,
    testTimeout: 10 * 60_000,
    globals: false,
  },
});
