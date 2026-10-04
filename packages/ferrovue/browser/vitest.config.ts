import { defineConfig } from "vitest/config";

/* The browser hydration tests: `pnpm test:browser`, never part of `pnpm test`.
 *
 * Its own runner, so the root config's test globs never pick it up: the tests run in Node and drive
 * real browsers through Playwright (`pnpm exec playwright install` first). */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: "node",
    include: ["*.test.ts"],
    globals: false,
    hookTimeout: 120_000,
  },
});
