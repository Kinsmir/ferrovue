import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        settings: {
          navigation: { disableChildFrameNavigation: true },
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
        },
      },
    },
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["packages/ferrovue/src/**/*.ts"],
      reporter: ["text-summary", "json-summary", "lcov", "html"],
      reportsDirectory: "target/coverage/ts",
    },
  },
});
