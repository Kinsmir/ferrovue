import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

/* The Vue half of the differential fuzzer (`pnpm fuzz`), kept apart from `pnpm test`: it renders
 * the components `run.ts` wrote, listed in `$FERROVUE_FUZZ_VUE_CASES`. */
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
