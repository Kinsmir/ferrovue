import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: join(import.meta.dirname, "../../.."),
  plugins: [vue({ script: { fs: { fileExists: existsSync, readFile: (file) => readFileSync(file, "utf8"), realpath: realpathSync } } })],
  resolve: { alias: [{ find: /^ferrovue$/, replacement: join(import.meta.dirname, "../src/client.ts") }] },
  test: {
    fsModuleCache: false,
    environment: "node",
    include: ["packages/ferrovue/bench/**/*.bench.ts"],
    fileParallelism: false,
    disableConsoleIntercept: true,
    testTimeout: 10 * 60_000,
    globals: false,
  },
});
