import { join } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

/* The JavaScript half of the benchmarks: `pnpm bench:js`, never part of `pnpm test`.
 *
 * Its own runner, so the timing runs in plain Node (no happy-dom) and alone (one file, one worker),
 * and so the root config's test globs never pick it up. The Vue plugin compiles the conformance
 * components, as it does for the tests. */
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
