/* `ferrovue/islands`: every component that has an `island()`, by the name `data-island` carries,
 * each a loader for `mountIslands`, so that only the islands on the page are fetched.
 *
 *   import islands from "ferrovue/islands";
 *   await mountIslands(islands, { pinia, router });
 *
 * The Vite plugin (`ferrovue/vite`) writes the real module from what the compiler found; this file
 * gives it its type, and is what an import gets without the plugin. */
import type { Component } from "vue";

const islands: Record<string, () => Promise<{ default: Component }>> = (() => {
  throw new Error("ferrovue/islands is written by the Vite plugin: add `ferrovue()` from `ferrovue/vite` to the plugins of the Vite config");
})();

export default islands;
