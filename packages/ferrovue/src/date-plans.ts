import type { Fixture } from "./fixture.ts";
import { reviveByPlan } from "./revive.ts";

/** Where the props of each component, and the results of each loader, hold dates inside lists,
 * dictionaries and objects, as the server writes it beside them: by component and by loader. */
export interface DatePlans {
  components: Record<string, unknown>;
  loaders: Record<string, unknown>;
}

/** A fixture of `component` as the client reads the page the server writes for it: each date its
 * props and its loaders' results hold inside a list, a dictionary or an object turned back into a
 * `Date` by the plans the server writes beside them. */
export function withDatePlans(fixture: Fixture, component: string, plans: DatePlans): Fixture {
  const props = reviveByPlan(fixture.props, plans.components[component]);
  if (!fixture.loads || !Object.keys(plans.loaders).length) return { ...fixture, props };
  return { ...fixture, props, loads: { ...fixture.loads, dates: plans.loaders } };
}
