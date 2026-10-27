type Plan = 1 | string | Plan[] | { [key: string]: Plan };

function revived(value: unknown, plan: Plan, types: Record<string, Plan>, depth: number): unknown {
  if (typeof plan === "string") {
    const named = Object.hasOwn(types, plan) ? types[plan] : undefined;
    return named === undefined || depth > 1000 ? value : revived(value, named, types, depth + 1);
  }
  if (plan === 1) return typeof value === "string" || typeof value === "number" ? new Date(value) : value;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(plan)) return Array.isArray(value) && plan.length === 1 ? value.map((item) => revived(item, plan[0]!, types, depth + 1)) : value;
  const every = Object.hasOwn(plan, "*") ? plan["*"] : undefined;
  if (Array.isArray(value)) {
    if (every !== undefined) return value;
    // A tuple: the plan names its parts by their indices.
    return value.map((item, i) => (Object.hasOwn(plan, String(i)) ? revived(item, plan[String(i)]!, types, depth + 1) : item));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const own = every ?? (Object.hasOwn(plan, key) ? plan[key] : undefined);
      return [key, own === undefined ? item : revived(item, own, types, depth + 1)];
    }),
  );
}

/** `value` with each date the plan names turned from the ISO string or number of milliseconds JSON
 * carries back into a `Date`: `value` itself where there is no plan. */
export function reviveByPlan<T>(value: T, plan: unknown): T {
  if (!Array.isArray(plan) || plan.length < 1 || plan.length > 2) return value;
  const types = plan[1] !== null && typeof plan[1] === "object" && !Array.isArray(plan[1]) ? (plan[1] as Record<string, Plan>) : {};
  return revived(value, plan[0] as Plan, types, 0) as T;
}

/** The plan an island's `data-dates` holds, or `undefined` for none or one that is not JSON. */
export function planOf(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
