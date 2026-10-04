import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

/* One runner for the compiler's tests and the Vue half of the conformance suite.
 *
 * The conformance components are `.vue` files, which the Vue plugin compiles; happy-dom gives the
 * hydration tests a document to mount on. Nothing here loads a network resource. */
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
    // `pnpm coverage`: the compiler's own source, as the whole suite exercises it.
    coverage: {
      provider: "v8",
      include: ["packages/ferrovue/src/**/*.ts"],
      reporter: ["text-summary", "json-summary", "lcov", "html"],
      reportsDirectory: "target/coverage/ts",
    },
  },
});
