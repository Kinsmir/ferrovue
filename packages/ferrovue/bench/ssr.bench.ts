/* Vue's `renderToString`, timed on the scenarios `crates/ferrovue/benches/render.rs` times the
 * generated Rust on: `pnpm bench:js`.
 *
 * Each scenario's props are built here exactly as the Rust side builds them. Before anything is
 * timed, Vue's output is held to `crates/ferrovue/benches/expected/<scenario>.html`, which the Rust
 * side holds its own output to as well, so both halves time the same work writing the same bytes.
 * `FERROVUE_BENCH_WRITE=1` records those files from Vue instead of comparing.
 *
 * What is timed: one awaited `renderToString(app)`. The app, with its Pinia and (for `small`) its
 * router already at the reader's location, is created once outside the loop, as the Rust side
 * builds its router and route once. Vue is its production build (`NODE_ENV=production`), and each
 * component renders through the `ssrRender` its SSR build would have (`attachSsrRender`).
 *
 * `FERROVUE_BENCH_QUICK=1` shortens every run, for CI: it proves the benchmark works, not how fast. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Bench } from "tinybench";
import { expect, it } from "vitest";
import { createSSRApp, version as vueVersion, type App, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { attachSsrRender, fixtureApp, type RouteEntry } from "../src/testing.ts";

const ROOT = join(import.meta.dirname, "../../../crates/ferrovue/tests/conformance");
const EXPECTED = join(import.meta.dirname, "../../../crates/ferrovue/benches/expected");
const ROUTES = JSON.parse(readFileSync(join(ROOT, "routes.json"), "utf8")) as RouteEntry[];
const WRITE = process.env.FERROVUE_BENCH_WRITE === "1";
const QUICK = process.env.FERROVUE_BENCH_QUICK === "1";

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", {
  eager: true,
});
const components = new Map(
  Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]),
);
for (const [name, component] of components) attachSsrRender(join(ROOT, "components", `${name}.vue`), name, component);

interface TreeProps {
  label: string;
  children: TreeProps[];
}

function treeNode(label: string, depth: number): TreeProps {
  return { label, children: depth < 8 ? [0, 1].map((i) => treeNode(`${label}.${i}`, depth + 1)) : [] };
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Each scenario: the component, its props, and the location it renders at if it reads one. */
const SCENARIOS: { name: string; component: string; props: Record<string, unknown>; route?: string }[] = [
  {
    // One `<Nav>`, two `<RouterLink>`s resolved against the reader's location.
    name: "small",
    component: "Nav",
    props: { href: "/users/me", label: "Me & you", note: "3 new" },
    route: "/users/me",
  },
  {
    // 1,000 words, 1,000 numbers and 100 groups of 10 members.
    name: "list",
    component: "Lists",
    props: {
      words: range(1000).map((i) => (i % 10 === 0 ? `<word ${i}>` : `word ${i}`)),
      numbers: range(1000).map((i) => i * 7),
      groups: range(100).map((i) => ({
        name: `group ${i}`,
        members: range(10).map((j) => `member ${i}.${j}`),
        ...(i % 2 === 0 ? { lead: `lead ${i}` } : {}),
      })),
    },
  },
  {
    // A full binary tree 8 levels deep: 255 recursive `<Tree>`s.
    name: "tree",
    component: "Tree",
    props: { ...treeNode("n", 1) },
  },
  {
    // 22 `<Panel>`s with named slots, a `<Text>`, and 20 `<Frame>`s each holding a loop.
    name: "page",
    component: "Dashboard",
    props: {
      heading: "Dashboard <beta>",
      panels: range(20).map((i) => ({ title: `Panel ${i}`, ...(i % 2 === 0 ? { count: i } : {}) })),
      words: range(10).map((i) => `tag ${i}`),
      footer: "Updated & synced",
      total: 42,
    },
  },
];

/** Whether Vue is its development build, which checks and warns as it renders. */
function vueIsDevelopmentBuild(): boolean {
  const app = createSSRApp({});
  const warn = console.warn;
  let warned = false;
  console.warn = () => void (warned = true);
  try {
    app.provide("ferrovue-bench", 1);
    app.provide("ferrovue-bench", 2);
  } finally {
    console.warn = warn;
  }
  return warned;
}

it("times Vue's renderToString on each scenario", async () => {
  expect(vueIsDevelopmentBuild(), "run with NODE_ENV=production (pnpm bench:js)").toBe(false);

  const bench = new Bench({ name: "vue renderToString", time: QUICK ? 200 : 5000, warmupTime: QUICK ? 50 : 1000 });
  for (const s of SCENARIOS) {
    const app: App = await fixtureApp(
      components.get(s.component)!,
      { props: s.props, slots: {}, route: s.route ?? "/", stores: {} },
      s.route ? ROUTES : null,
    );
    const html = await renderToString(app);
    const file = join(EXPECTED, `${s.name}.html`);
    if (WRITE) writeFileSync(file, html);
    else expect(html, `${s.name}: Vue's output differs from ${file}`).toBe(readFileSync(file, "utf8"));
    bench.add(s.name, async () => {
      await renderToString(app);
    });
  }
  if (WRITE) return;

  await bench.run();
  console.log(`\nVue ${vueVersion} renderToString, Node ${process.versions.node}`);
  console.table(
    bench.tasks.map((t) => {
      const r = t.result;
      if (r.state !== "completed") throw new Error(`${t.name}: ${r.state}`);
      return {
        scenario: t.name,
        "mean (µs)": +(r.latency.mean * 1000).toFixed(2),
        "median (µs)": +(r.latency.p50 * 1000).toFixed(2),
        "±rme (%)": +r.latency.rme.toFixed(2),
        samples: r.latency.samplesCount,
      };
    }),
  );
});
