import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    root: import.meta.dirname,
    environment: "happy-dom",
    include: ["vue-render.fuzz.ts"],
    globals: false,
    testTimeout: 600_000,
    reporters: ["dot"],
  },
});
