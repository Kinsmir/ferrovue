/* What the browser runs for one conformance fixture: the components as a client build compiles
 * them, hydrating the server HTML the page was loaded with. The page names the component and
 * carries the fixture in `<script id="fv-fixture">`; the result waits in `window.hydration`.
 *
 * Bundled by `conformance.test.ts` with Vue's development build, which reports every hydration
 * mismatch with its details. */
import { nextTick, type Component } from "vue";
import { fixtureApp, readFixture, type RouteEntry, type RouterOptions } from "../src/fixture.ts";

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", {
  eager: true,
});
const components = new Map(
  Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]),
);

/** What the page carries: everything `fixtureApp` is given. */
export interface PageData {
  component: string;
  fixture: Record<string, unknown>;
  routes: RouteEntry[];
  options: RouterOptions;
}

/** The document before and after hydrating — before anything mounted has had a chance to change
 * it — and whether Vue kept the server's first node. */
export interface Hydration {
  before: string;
  after: string;
  kept: boolean;
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
  // The document as this browser parsed it, which is what Vue hydrates.
  const before = document.body.innerHTML;
  const app = await fixtureApp(component, readFixture(data.fixture), data.routes, data.options);
  app.mount(root);
  const after = document.body.innerHTML;
  const kept = root.firstChild === first;
  // What the mounted hooks changed renders now: a warning it raises is reported too.
  await nextTick();
  return { before, after, kept };
}

window.hydration = hydrate();
