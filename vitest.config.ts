import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const conformance = JSON.parse(readFileSync(new URL("crates/ferrovue/tests/conformance/ferrovue.config.json", import.meta.url), "utf8")) as {
  cssModules: { generateScopedName: string };
};

export default defineConfig({
  plugins: [vue()],
  css: { modules: { generateScopedName: conformance.cssModules.generateScopedName } },
  resolve: { alias: [{ find: /^ferrovue\/client$/, replacement: fileURLToPath(new URL("packages/ferrovue/src/client.ts", import.meta.url)) }] },
  test: {
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
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
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
