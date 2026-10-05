import type { Component } from "vue";
import type { RouteRecordRaw } from "vue-router";

/** A route as a routes file lists it: a path, or a path and a name. */
export type RouteEntry = string | { path: string; name?: string; children?: RouteEntry[] };

/** Route records for vue-router, every route (nested ones too) given the same view. */
export function routeRecords(routes: RouteEntry[], View: Component): RouteRecordRaw[] {
  return routes.map((r) =>
    typeof r === "string"
      ? { path: r, component: View }
      : { path: r.path, component: View, ...(r.name ? { name: r.name } : {}), ...(r.children ? { children: routeRecords(r.children, View) } : {}) },
  );
}
