import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { App, Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { generate, loadConfig, type Config } from "./compiler.ts";
import { unifiedDiff } from "./diff.ts";
import { allPages, fileRoutes, pagesFolder, routeEntries } from "./file-routes.ts";
import { fixtureApp, peer, readFixture, type RouteEntry, type RouterOptions } from "./fixture.ts";
import { headRendered, settled } from "./settle.ts";
import { attachSsrRender } from "./ssr.ts";

/** What `conformanceSuite` checks: the project, its components and its fixtures. `pinia`,
 * `vueRouter` and `vueI18n` are the application's own modules (`pinia: await import("pinia")`),
 * which the fixtures install so that its stores and composables find them. */
export interface ConformanceOptions extends Pick<RouterOptions, "pinia" | "vueRouter" | "vueI18n"> {
  /** The project's `ferrovue.config.json`. */
  config: string;
  /** Every component in the configured `components` directory, by file name or by the path
   * `import.meta.glob` gives it: `import.meta.glob("../components/*.vue", { eager: true })`; and
   * with a folder of pages, every page, by the path `import.meta.glob("../pages/**\/*.vue")` gives
   * it or by its component name (`BooksId`). */
  components: Record<string, Component | { default: Component }>;
  /** The fixtures, one directory per component holding `<case>.json` and `<case>.html`:
   * `fixtures` beside the configuration when not given. */
  fixtures?: string;
  /** Write each fixture's `.html` from Vue's render instead of comparing it: when
   * `FERROVUE_FIXTURES_WRITE=1` is set, if not given. */
  record?: boolean;
}

interface TestApi {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => Promise<void> | void): void;
}

interface Case {
  component: string;
  name: string;
  base: string;
}

export const TELEPORTS = "<!--fv-teleports-->";

export const HEAD = "<!--fv-head-->";

/** What unhead's server renderer wrote for a recorded render's head, as `renderSSRHead` gives it. */
export interface RecordedHead {
  headTags: string;
  bodyTags: string;
  bodyTagsOpen: string;
  htmlAttrs: string;
  bodyAttrs: string;
}

/** The head a recorded render wrote after its body, if it wrote one. */
export function recordedHead(html: string): RecordedHead | null {
  const at = html.indexOf(HEAD);
  return at < 0 ? null : (JSON.parse(html.slice(at + HEAD.length)) as RecordedHead);
}

/** Render a fixture's app as the conformance suite records it: Vue's HTML, then what was teleported
 * and what `useHead` asked for, each after its marker. */
export async function renderFixture(app: App): Promise<string> {
  const ssr: { teleports?: Record<string, string> } = {};
  const main = await renderToString(app, ssr);
  const teleported = Object.entries(ssr.teleports ?? {});
  const html = teleported.length ? `${main}${TELEPORTS}${JSON.stringify(Object.fromEntries(teleported))}` : main;
  const head = (app.config.globalProperties as { $unhead?: { render(): RecordedHead } }).$unhead?.render();
  return head && Object.values(head).some(Boolean) ? `${html}${HEAD}${JSON.stringify(head)}` : html;
}

/** Put a recorded render's head into the document, as a page would write it: its tags in `<head>`,
 * and its attributes on `<html>` and `<body>`. */
export function placeHead(head: RecordedHead | null, doc: Document = document): void {
  doc.head.innerHTML = head?.headTags ?? "";
  const attrs = (el: Element, written: string): void => {
    for (const name of el.getAttributeNames()) el.removeAttribute(name);
    const t = doc.createElement("template");
    t.innerHTML = `<div${written}></div>`;
    const parsed = t.content.firstElementChild!;
    for (const name of parsed.getAttributeNames()) el.setAttribute(name, parsed.getAttribute(name)!);
  };
  attrs(doc.documentElement, head?.htmlAttrs ?? "");
  attrs(doc.body, head?.bodyAttrs ?? "");
}

/** A recorded render as a page body to hydrate: the main HTML in `<div id="root">`, what was
 * teleported in each target, and the tags the head puts at the start and end of `<body>`. */
export function hydrationBody(html: string): string {
  const head = recordedHead(html);
  const [main, teleported] = html.split(HEAD)[0]!.split(TELEPORTS);
  const targets = Object.entries(JSON.parse(teleported ?? "{}") as Record<string, string>);
  const intoBody = targets
    .filter(([t]) => t === "body")
    .map(([, content]) => content)
    .join("");
  const elsewhere = targets
    .filter(([t]) => t !== "body")
    .map(([t, content]) => `<div id="${t.replace(/^#/, "")}">${content}</div>`)
    .join("");
  return `${head?.bodyTagsOpen ?? ""}${intoBody}<div id="root">${main}</div>${elsewhere}${head?.bodyTags ?? ""}`;
}

/** Where two renders first differ, with the text around it in each. */
export function firstDifference(recorded: string, rendered: string): string {
  let at = 0;
  while (at < recorded.length && at < rendered.length && recorded[at] === rendered[at]) at++;
  const lines = recorded.slice(0, at).split("\n");
  const around = (text: string): string => JSON.stringify(text.slice(Math.max(0, at - 40), at + 40));
  return `first difference at character ${at} (line ${lines.length}, column ${lines.at(-1)!.length + 1}):\n  recorded: ${around(recorded)}\n  rendered: ${around(rendered)}`;
}

interface PageFile {
  name: string;
  file: string;
  within: string;
}

function componentsByName(given: ConformanceOptions["components"], pages: PageFile[]): Map<string, Component> {
  const nameOf = (key: string): string => {
    const path = key.replaceAll("\\", "/");
    return pages.find((p) => path.endsWith(`/${p.within}`))?.name ?? basename(key, ".vue");
  };
  return new Map(
    Object.entries(given).map(([key, value]) => [
      nameOf(key),
      (value as { default?: Component }).default ?? (value as Component),
    ]),
  );
}

function routerOptions(root: string, config: Config): { routes: RouteEntry[] | null; options: RouterOptions } {
  const router = config.router ?? (config.routes ? { routes: config.routes } : null);
  const pages = pagesFolder(config);
  const routes =
    pages !== null
      ? routeEntries(fileRoutes(root, pages))
      : typeof router?.routes === "string"
        ? (JSON.parse(readFileSync(join(root, router.routes), "utf8")) as RouteEntry[])
        : null;
  const options: RouterOptions = {};
  if (router?.base !== undefined) options.base = router.base;
  if (router?.linkActiveClass !== undefined) options.linkActiveClass = router.linkActiveClass;
  if (router?.linkExactActiveClass !== undefined) options.linkExactActiveClass = router.linkExactActiveClass;
  if (config.i18n) {
    const dir = join(root, config.i18n.messages);
    options.i18n = {
      messages: Object.fromEntries(
        readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => [basename(f, ".json"), JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown]),
      ),
      locale: config.i18n.locale ?? "en",
      ...(config.i18n.fallbackLocale !== undefined ? { fallbackLocale: config.i18n.fallbackLocale } : {}),
    };
  }
  return { routes, options };
}

function casesIn(fixtures: string): Case[] {
  if (!existsSync(fixtures)) return [];
  return readdirSync(fixtures, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .flatMap((d) =>
      readdirSync(join(fixtures, d.name))
        .filter((f) => f.endsWith(".json"))
        .toSorted()
        .map((f) => ({ component: d.name, name: f, base: join(fixtures, d.name, basename(f, ".json")) })),
    );
}

function recordedHtml(c: Case): string {
  try {
    return readFileSync(`${c.base}.html`, "utf8");
  } catch {
    throw new Error(`${c.component}/${c.name} has no recorded HTML: record it from Vue with FERROVUE_FIXTURES_WRITE=1`);
  }
}

function coverageProblems(fixtures: string, cases: Case[], files: string[], given: Map<string, Component>): string[] {
  const problems: string[] = [];
  if (!existsSync(fixtures)) problems.push(`there is no fixtures directory at ${fixtures}`);
  const withFixtures = new Set(cases.map((c) => c.component));
  for (const name of files) {
    if (!withFixtures.has(name)) problems.push(`${name} has no fixtures: add ${name}/<case>.json under ${fixtures}`);
    if (!given.has(name)) problems.push(`${name} is not in \`components\``);
  }
  for (const name of withFixtures) if (!files.includes(name)) problems.push(`the fixtures in ${name}/ name no component`);
  for (const name of given.keys()) if (!files.includes(name)) problems.push(`\`components\` has ${name}, which is not a .vue file the configuration compiles`);
  return problems;
}

function driftProblems(root: string, config: Config): string[] {
  const out = join(root, config.out);
  const files = generate(root, config);
  const problems: string[] = [];
  for (const [file, text] of files) {
    const path = join(out, file);
    if (!existsSync(path)) problems.push(`${file} is missing`);
    else {
      const committed = readFileSync(path, "utf8");
      if (committed !== text) problems.push(unifiedDiff(relative(root, path), committed, text).trimEnd());
    }
  }
  const stale = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith(".rs") && !files.has(f)) : [];
  for (const file of stale.toSorted()) problems.push(`${file} is no longer generated`);
  return problems;
}

async function hydrateFixture(app: App, html: string): Promise<string[]> {
  if (typeof document === "undefined") throw new Error("hydrating a fixture needs a DOM: run the suite with `environment: \"happy-dom\"` (or jsdom)");
  placeHead(recordedHead(html));
  document.body.innerHTML = hydrationBody(html);
  const root = document.getElementById("root")!;
  const first = root.firstChild;
  const problems: string[] = [];
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => void problems.push(`console.warn: ${args.map(String).join(" ")}`);
  console.error = (...args: unknown[]) => void problems.push(`console.error: ${args.map(String).join(" ")}`);
  app.config.warnHandler = (message) => void problems.push(`warning: ${message}`);
  try {
    app.mount(root);
    await settled(app);
    await headRendered();
  } finally {
    console.warn = warn;
    console.error = error;
  }
  if (root.firstChild !== first) problems.push("Vue replaced the server's first node");
  app.unmount();
  await headRendered();
  document.body.innerHTML = "";
  placeHead(null);
  return problems;
}

/** Register the conformance suite with the given `describe` and `it`. */
export function registerConformance(api: TestApi, options: ConformanceOptions): void {
  const configFile = resolve(options.config);
  const root = dirname(configFile);
  const config = loadConfig(root, configFile);
  const fixtures = resolve(root, options.fixtures ?? "fixtures");
  const record = options.record ?? process.env.FERROVUE_FIXTURES_WRITE === "1";
  const dir = join(root, config.components);
  const pagesDir = pagesFolder(config)?.replace(/\/+$/, "") ?? null;
  const pages: PageFile[] =
    pagesDir === null
      ? []
      : allPages(fileRoutes(root, pagesDir)).map((p) => ({ name: p.component!, file: join(root, p.file!), within: `${basename(pagesDir)}/${p.file!.slice(pagesDir.length + 1)}` }));
  const sources = new Map<string, string>([
    ...(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".vue")) : []).map((f): [string, string] => [basename(f, ".vue"), join(dir, f)]),
    ...pages.map((p): [string, string] => [p.name, p.file]),
  ]);
  const files = [...sources.keys()].toSorted();
  const given = componentsByName(options.components, pages);
  for (const [name, component] of given) {
    const source = sources.get(name);
    if (source) attachSsrRender(source, name, component);
  }
  const cases = casesIn(fixtures);
  const { routes, options: configured } = routerOptions(root, config);
  const appOptions: RouterOptions = { ...configured, pinia: options.pinia, vueRouter: options.vueRouter, vueI18n: options.vueI18n };
  const app = async (c: Case, hydrate = false): Promise<App> => {
    const component = given.get(c.component);
    if (!component) throw new Error(`the fixtures in ${c.component}/ name no component in \`components\``);
    const json = JSON.parse(readFileSync(`${c.base}.json`, "utf8")) as Record<string, unknown>;
    return fixtureApp(component, readFixture(json), routes, { ...appOptions, hydrate });
  };

  api.describe("conformance", () => {
    api.it("has fixtures for every component, and a component for every fixture", () => {
      const problems = coverageProblems(fixtures, cases, files, given);
      if (problems.length) throw new Error(`the fixtures do not cover the components:\n${problems.join("\n")}`);
    });

    api.it("has generated Rust that is what the generator writes now", () => {
      const problems = driftProblems(root, config);
      if (problems.length) {
        throw new Error(`the generated Rust in ${config.out} is not what ferrovue writes now: run \`ferrovue\` and commit the result\n${problems.join("\n")}`);
      }
    });

    api.describe("Vue renders each fixture to its recorded HTML", () => {
      for (const c of cases) {
        api.it(`${c.component}/${c.name}`, async () => {
          const html = await renderFixture(await app(c));
          if (record) {
            writeFileSync(`${c.base}.html`, html);
            return;
          }
          const want = recordedHtml(c);
          if (html !== want) {
            const message = `${c.component}/${c.name}: Vue renders this fixture differently from its recorded HTML, ${firstDifference(want, html)}`;
            throw Object.assign(new Error(message), { actual: html, expected: want, showDiff: true });
          }
        });
      }
    });

    if (record) return;
    api.describe("the recorded HTML hydrates without a mismatch", () => {
      for (const c of cases) {
        api.it(`${c.component}/${c.name}`, async () => {
          const problems = await hydrateFixture(await app(c, true), recordedHtml(c));
          if (problems.length) throw new Error(`${c.component}/${c.name} did not hydrate exactly:\n${problems.join("\n")}`);
        });
      }
    });
  });
}

/** Register vitest tests holding a project's components to Vue, as ferrovue's own suite does:
 * every component has fixtures and every fixture a component, the generated Rust is what the
 * generator writes now, Vue renders each fixture to its recorded `.html` (or records it, with
 * `FERROVUE_FIXTURES_WRITE=1`), and each recorded `.html` hydrates with no warning and the server's
 * nodes kept. Await it at the top of a test file run in a DOM environment such as happy-dom. */
export async function conformanceSuite(options: ConformanceOptions): Promise<void> {
  const vitest = await peer("vitest", "`conformanceSuite` registers vitest tests", () => import("vitest"));
  registerConformance(vitest, options);
}
