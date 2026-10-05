import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["browser/**/*.test.ts"],
    hookTimeout: 600_000,
    testTimeout: 30_000,
  },
});
