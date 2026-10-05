import { join } from "node:path";
import type { Component } from "vue";
import { conformanceSuite } from "ferrovue/testing";

await conformanceSuite({
  config: join(import.meta.dirname, "../ferrovue.config.json"),
  components: {
    ...import.meta.glob<Component>("../client/components/*.vue", { eager: true, import: "default" }),
    ...import.meta.glob<Component>("../client/pages/**/*.vue", { eager: true, import: "default" }),
  },
  pinia: await import("pinia"),
  vueRouter: await import("vue-router"),
});
