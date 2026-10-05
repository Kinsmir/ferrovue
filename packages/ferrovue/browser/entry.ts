import { type Component } from "vue";
import { fixtureApp, readFixture, type RouteEntry, type RouterOptions } from "../src/fixture.ts";
import { settled } from "../test/settle.ts";

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
}

export interface Hydration {
  before: string;
  after: string;
  kept: boolean;
  settled: string;
}

declare global {
  interface Window {
    hydration?: Promise<Hydration>;
  }
}

async function hydrate(): Promise<Hydration> {
  const data = JSON.parse(document.getElementById("fv-fixture")!.textContent) as PageData;
  const component = components.get(data.component);
  if (!component) throw new Error(`no component ${data.component}`);
  const root = document.getElementById("root")!;
  const first = root.firstChild;
  const before = document.body.innerHTML;
  const app = await fixtureApp(component, readFixture(data.fixture), data.routes, data.options);
  app.mount(root);
  const after = document.body.innerHTML;
  const kept = root.firstChild === first;
  await settled(app);
  return { before, after, kept, settled: document.body.innerHTML };
}

window.hydration = hydrate();
