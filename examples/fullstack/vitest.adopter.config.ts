import { existsSync, readFileSync, realpathSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue({ script: { fs: { fileExists: existsSync, readFile: (file) => readFileSync(file, "utf8"), realpath: realpathSync } }, features: { componentIdGenerator: "filepath" } })],
  test: {
    environment: "happy-dom",
    include: ["adopter/**/*.test.ts"],
    server: { deps: { external: [/\/packages\/ferrovue\/dist\//], inline: ["pinia", "vue-router"] } },
  },
});
