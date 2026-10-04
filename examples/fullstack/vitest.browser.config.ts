import { defineConfig } from "vitest/config";

/* The browser test: the server's pages hydrated by the client in real browsers, through Playwright
 * (`pnpm exec playwright install` first). Its own runner, so `pnpm test` stays browser-free. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["browser/**/*.test.ts"],
    // The first run compiles the server.
    hookTimeout: 600_000,
    testTimeout: 30_000,
  },
});
