import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const conformance = JSON.parse(readFileSync(new URL("crates/ferrovue/tests/conformance/ferrovue.config.json", import.meta.url), "utf8")) as {
  cssModules: { generateScopedName: string };
  comments: boolean;
};

export default defineConfig({
  plugins: [vue({ script: { fs: { fileExists: existsSync, readFile: (file) => readFileSync(file, "utf8"), realpath: realpathSync } }, template: { compilerOptions: { comments: conformance.comments } } })],
  css: { modules: { generateScopedName: conformance.cssModules.generateScopedName } },
  resolve: { alias: [{ find: /^ferrovue$/, replacement: fileURLToPath(new URL("packages/ferrovue/src/client.ts", import.meta.url)) }] },
  test: {
    fsModuleCache: false,
    testTimeout: 30_000,
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        settings: {
          navigation: { disableChildFrameNavigation: true },
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.ts", "site/*.test.ts"],
    css: { include: [/&lang\.module\.css$/], modules: { classNameStrategy: "scoped" } },
    globals: false,
    coverage: {
      provider: "v8",
      include: ["packages/ferrovue/src/**/*.ts"],
      reporter: ["text-summary", "json-summary", "lcov", "html"],
      reportsDirectory: "target/coverage/ts",
    },
  },
});
