import type { Component } from "vue";
import type { RouteRecordRaw } from "vue-router";

/** A route as a routes file lists it: a path, or a path and a name. `view: false` marks a folder of
 * file-based routes, which shows no component and only groups the routes in it. */
export type RouteEntry = string | { path: string; name?: string; view?: boolean; children?: RouteEntry[] };

/** Route records for vue-router, every route (nested ones too) given the same view, except a
 * folder, which is given none. */
export function routeRecords(routes: RouteEntry[], View: Component): RouteRecordRaw[] {
  return routes.map((r) =>
    typeof r === "string"
      ? { path: r, component: View }
      : ({
          path: r.path,
          ...(r.view === false ? {} : { component: View }),
          ...(r.name ? { name: r.name } : {}),
          ...(r.children ? { children: routeRecords(r.children, View) } : {}),
        } as RouteRecordRaw),
  );
}
