import type { Component } from "vue";

/** Every component that has an `island()`, by its `data-island` name, each a loader for `mountIslands`. */
const islands: Record<string, () => Promise<{ default: Component }>> = (() => {
  throw new Error("ferrovue/islands is written by the Vite plugin: add `ferrovue()` from `ferrovue/vite` to the plugins of the Vite config");
})();

export default islands;
