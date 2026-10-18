import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: false,
    root: import.meta.dirname,
    environment: "node",
    include: ["*.test.ts"],
    globals: false,
    hookTimeout: 120_000,
  },
});
