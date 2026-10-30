import { type Component } from "vue";
import { type DatePlans, withDatePlans } from "../src/date-plans.ts";
import { linkRoutes } from "../src/link-routes.ts";
import { fixtureApp, readFixture, type RouterOptions } from "../src/testing-browser.ts";
import type { RouteEntry } from "../src/route-records.ts";
import { headRendered, settled } from "../src/settle.ts";

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", {
  eager: true,
});
const components = new Map(
  Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]),
);

export interface PageData {
  component: string;
  fixture: Record<string, unknown>;
  routes: RouteEntry[];
  options: RouterOptions;
  plans: DatePlans;
  light?: boolean;
}

export interface Hydration {
  before: string;
  after: string;
  kept: boolean;
  settled: string;
  head: { before: string; after: string };
}

declare global {
  interface Window {
    hydration?: Promise<Hydration>;
    navigated?: string[];
  }
}

async function hydrate(): Promise<Hydration> {
  const data = JSON.parse(document.getElementById("fv-fixture")!.textContent) as PageData;
  const component = components.get(data.component);
  if (!component) throw new Error(`no component ${data.component}`);
  const root = document.getElementById("root")!;
  const first = root.firstChild;
  const before = document.body.innerHTML;
  const head = document.head.innerHTML;
  const fixture = withDatePlans(readFixture(data.fixture), data.component, data.plans);
  const app = await fixtureApp(component, fixture, data.light ? null : data.routes, { ...data.options, hydrate: true });
  const navigated: string[] = (window.navigated = []);
  if (data.light) app.use(linkRoutes(data.routes, { navigate: (href) => void navigated.push(href), location: fixture.route }));
  app.mount(root);
  const after = document.body.innerHTML;
  const kept = root.firstChild === first;
  await settled(app);
  await headRendered();
  return { before, after, kept, settled: document.body.innerHTML, head: { before: head, after: document.head.innerHTML } };
}

window.hydration = hydrate();
