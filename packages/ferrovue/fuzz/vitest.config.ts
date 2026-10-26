import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue({ script: { fs: { fileExists: existsSync, readFile: (file) => readFileSync(file, "utf8"), realpath: realpathSync } } })],
  resolve: { alias: [{ find: /^ferrovue$/, replacement: fileURLToPath(new URL("../src/client.ts", import.meta.url)) }] },
  test: {
    fsModuleCache: false,
    root: import.meta.dirname,
    environment: "happy-dom",
    include: ["vue-render.fuzz.ts"],
    globals: false,
    testTimeout: 600_000,
    reporters: ["dot"],
  },
});
