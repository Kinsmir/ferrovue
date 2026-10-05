import type { RouteRecordRaw } from "vue-router";
import type { RouteEntry } from "./routes.ts";

function unwritten(): never {
  throw new Error("ferrovue/routes is written by the Vite plugin from a folder of pages: add `ferrovue()` from `ferrovue/vite` to the plugins of the Vite config");
}

/** vue-router's route records for the pages, each page loaded lazily: what `vue-router/auto-routes`
 * gives for the same folder. */
export const routes: RouteRecordRaw[] = unwritten();

/** The same routes as a routes file lists them, with `view: false` on a folder: what `routeRecords`
 * and `linkRouter` take, for a client whose pages the server renders. */
const entries: RouteEntry[] = unwritten();

export default entries;
