import {
  createApp,
  createSSRApp,
  createTextVNode,
  defineComponent,
  h,
  hydrateOnIdle,
  hydrateOnMediaQuery,
  hydrateOnVisible,
  onMounted,
  ref,
  type App,
  type Component,
  type HydrationStrategy,
  type Plugin,
} from "vue";
import type { Pinia } from "pinia";
import type { Router } from "vue-router";

const BARE = /"(?:[^"\\]|\\.)*"|-?Infinity|NaN/g;
const NON_FINITE: Record<string, number> = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY };

function parseJson(text: string): unknown {
  if (!/NaN|Infinity/.test(text)) return JSON.parse(text);
  let escaped = "\\u0000";
  while (text.includes(escaped)) escaped += "\\u0000";
  const tag = JSON.parse(`"${escaped}"`) as string;
  const quoted = text.replace(BARE, (match) => (match.startsWith('"') ? match : `"${escaped}${match}"`));
  return JSON.parse(quoted, (_key, value: unknown) => (typeof value === "string" && value.startsWith(tag) ? NON_FINITE[value.slice(tag.length)] : value));
}

/** The state of a page already read: the text of its state's script, as `readPage` gives it. */
export interface StateText {
  text: string | undefined;
}

/** Give Pinia the state the server rendered with (what `ferrovue::state_script_into` wrote) before
 * the app mounts, so every store starts from it and the markup agrees with the server's. The state
 * is read from the script with the `id` given (`__pinia` by default) in `doc`, or given as
 * `{ text }`: the `state` of a fetched page that `readPage` read. Either way the numbers JSON
 * cannot carry (`NaN`, `Infinity`) are read back. Pinia is left alone when there is no state. */
export function hydrateState(pinia: Pinia, from: string | StateText = "__pinia", doc: Document = document): void {
  const text = typeof from === "string" ? doc.getElementById(from)?.textContent : from.text;
  if (text) pinia.state.value = parseJson(text) as Pinia["state"]["value"];
}

const SPACE = /[\t\n\f\r ]/;
const TAG_END = /[\t\n\f\r />]/;
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);
const FOREIGN = new Set(["svg", "math"]);
const LEAVES_FOREIGN = new Set(
  "b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var".split(" "),
);
const REFERENCES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

interface Tag {
  name: string;
  attrs: Map<string, string>;
  end: number;
  selfClosing: boolean;
}

function decodeAttr(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|(amp|lt|gt|quot|apos);)/g, (_match, dec?: string, hex?: string, named?: string) => {
    if (named) return REFERENCES[named]!;
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\uFFFD";
  });
}

function readTag(html: string, at: number): Tag | undefined {
  let i = at;
  while (i < html.length && !TAG_END.test(html[i]!)) i++;
  const name = html.slice(at, i).toLowerCase();
  const attrs = new Map<string, string>();
  let selfClosing = false;
  for (;;) {
    while (i < html.length && (SPACE.test(html[i]!) || html[i] === "/")) selfClosing = html[i++] === "/";
    if (i >= html.length) return undefined;
    if (html[i] === ">") return { name, attrs, end: i + 1, selfClosing };
    selfClosing = false;
    const start = i++;
    while (i < html.length && !/[\t\n\f\r />=]/.test(html[i]!)) i++;
    const key = html.slice(start, i).toLowerCase();
    while (i < html.length && SPACE.test(html[i]!)) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < html.length && SPACE.test(html[i]!)) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return undefined;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const from = i;
        while (i < html.length && !/[\t\n\f\r >]/.test(html[i]!)) i++;
        value = html.slice(from, i);
      }
    }
    if (!attrs.has(key)) attrs.set(key, decodeAttr(value));
  }
}

function tagAt(lower: string, at: number, name: string, closing: boolean): boolean {
  const open = closing ? `</${name}` : `<${name}`;
  return lower.startsWith(open, at) && TAG_END.test(lower[at + open.length] ?? "");
}

function scriptDataEnd(lower: string, from: number): number {
  let escaped = 0;
  let dashes = 0;
  for (let i = from; i < lower.length; i++) {
    if (escaped === 0) {
      if (lower.startsWith("<!--", i)) {
        escaped = 1;
        dashes = 2;
        i += 3;
      } else if (tagAt(lower, i, "script", true)) return i;
      continue;
    }
    const ch = lower[i];
    if (ch === "-") {
      dashes++;
      continue;
    }
    if (ch === ">" && dashes >= 2) escaped = 0;
    else if (ch === "<" && tagAt(lower, i, "script", true)) {
      if (escaped === 1) return i;
      escaped = 1;
    } else if (ch === "<" && escaped === 1 && tagAt(lower, i, "script", false)) escaped = 2;
    dashes = 0;
  }
  return -1;
}

function rawTextEnd(lower: string, from: number, name: string): number {
  if (name === "script") return scriptDataEnd(lower, from);
  for (let i = lower.indexOf(`</${name}`, from); i >= 0; i = lower.indexOf(`</${name}`, i + 1)) if (tagAt(lower, i, name, true)) return i;
  return -1;
}

function commentEnd(html: string, from: number): number {
  if (html.startsWith(">", from)) return from + 1;
  if (html.startsWith("->", from)) return from + 2;
  for (let i = html.indexOf("--", from); i >= 0; i = html.indexOf("--", i + 1)) {
    if (html[i + 2] === ">") return i + 3;
    if (html.startsWith("!>", i + 2)) return i + 4;
  }
  return html.length;
}

function scriptText(html: string, id: string): string | undefined {
  const lower = html.toLowerCase();
  let template = 0;
  let foreign = 0;
  let i = 0;
  for (;;) {
    const lt = html.indexOf("<", i);
    if (lt < 0) return undefined;
    i = lt + 1;
    if (html.startsWith("<!--", lt)) {
      i = commentEnd(html, lt + 4);
      continue;
    }
    if (foreign > 0 && html.startsWith("<![CDATA[", lt)) {
      const close = html.indexOf("]]>", lt);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    const closing = html[lt + 1] === "/";
    const at = closing ? lt + 2 : lt + 1;
    if (!/[a-zA-Z]/.test(html[at] ?? "")) {
      if (html[lt + 1] === "!" || html[lt + 1] === "?" || (closing && at < html.length)) {
        const close = html.indexOf(">", at);
        i = close < 0 ? html.length : close + 1;
      }
      continue;
    }
    const tag = readTag(html, at);
    if (!tag) return undefined;
    i = tag.end;
    if (FOREIGN.has(tag.name)) {
      if (closing) foreign = Math.max(0, foreign - 1);
      else if (!tag.selfClosing) foreign++;
      continue;
    }
    if (foreign > 0) {
      if (closing ? tag.name === "br" || tag.name === "p" : LEAVES_FOREIGN.has(tag.name)) foreign = 0;
      else continue;
    }
    if (tag.name === "template") {
      template = closing ? Math.max(0, template - 1) : template + 1;
      continue;
    }
    if (closing || !RAW_TEXT.has(tag.name)) {
      if (tag.name === "plaintext") return undefined;
      continue;
    }
    const end = rawTextEnd(lower, i, tag.name);
    if (tag.name === "script" && template === 0 && tag.attrs.get("id") === id) return html.slice(i, end < 0 ? html.length : end);
    if (end < 0) return undefined;
    const close = readTag(html, end + 2);
    if (!close) return undefined;
    i = close.end;
  }
}

/** The `id`s of the scripts `readPage` reads. */
export interface ReadPageOptions {
  /** The `id` of the record's script, as given to `PageRecord::script_into`: `__fv_page` by default. */
  record?: string;
  /** The `id` of the state's script, as given to `ferrovue::state_script_into`: `__pinia` by default. */
  state?: string;
}

/** A page read out of the HTML of its document. */
export interface ReadPage {
  /** The record `ferrovue::PageRecord` wrote, with the numbers JSON cannot carry read back. */
  record: PageRecord;
  /** The text of the state's script, for `hydrateState(pinia, { text: state })`: `undefined` when
   * the page carries no state. */
  state: string | undefined;
}

/** Read the record and the state of a page out of the HTML of its document, as a navigation that
 * fetches the next page receives it. It needs no `DOMParser`, so it also runs in a worker and on a
 * server. Each script is the one the browser's `getElementById` would find in the parsed document:
 * the first `<script>` with that `id` outside a `<template>`, an `<svg>` and a `<math>`, with
 * comments, attribute values and the text of `<script>`, `<style>`, `<textarea>`, `<title>` and the
 * other raw-text elements passed over as the HTML parser passes over them. Throws when the page
 * carries no record. */
export function readPage(html: string, options: ReadPageOptions = {}): ReadPage {
  const id = options.record ?? "__fv_page";
  const text = scriptText(html, id);
  if (!text) throw new Error(`[ferrovue] the page has no record: no <script id="${id}">`);
  return { record: parseJson(text) as PageRecord, state: scriptText(html, options.state ?? "__pinia") || undefined };
}

export interface MountOptions {
  /** One Pinia for every island, so they share stores. Call `hydrateState` on it first. */
  pinia?: Pinia;
  /** One router for every island that renders a `<RouterLink>` or reads the route. Mounting waits
   * until it has resolved the current location, which the server rendered against. */
  router?: Router;
  /** Anything else each island's app should `use`: i18n, a component library. */
  plugins?: Plugin[];
  /** Where to look for islands: the whole document by default. */
  root?: ParentNode;
  /** Told about an island left as the server rendered it, because its component is not among
   * those given, did not load or its props are malformed, and about one hydrated at once because
   * its `data-hydrate` is not one this version knows. Warns on the console by default. */
  onError?: (element: Element, problem: string) => void;
}

/** A component, or a function that loads one (`() => import("./Counter.vue")`), so that the code
 * of an island not on the page is never fetched. A function is taken for a loader as vue-router
 * takes one for a lazy route: unless it has `props` or `displayName`, which mark a functional
 * component, or `__vccOpts`, a class component. `ferrovue/islands` maps the name of every island
 * to a loader. */
export type IslandComponent = Component | (() => Promise<Component | { default: Component }>);

/** The islands mounted. */
export interface Islands {
  /** One app per island hydrated so far: those hydrated at once in document order, then each
   * island with a `data-hydrate` as it hydrates. */
  apps: App[];
  /** Unmount every island and stop waiting to hydrate the others, as a page leaving would. */
  unmount(): void;
}

type Trigger = (el: HTMLElement, hydrate: () => Promise<boolean>) => () => void;

const INTERACTIONS = ["pointerenter", "click", "focus"];

const strategy =
  (wait: HydrationStrategy): Trigger =>
  (el, hydrate) =>
    wait(
      () => void hydrate(),
      (each) => void each(el),
    ) ?? (() => {});

const idle: Trigger = (el, hydrate) => {
  if (typeof requestIdleCallback === "function") return strategy(hydrateOnIdle())(el, hydrate);
  const timer = setTimeout(() => void hydrate(), 200);
  return () => clearTimeout(timer);
};

const interaction =
  (names: string[]): Trigger =>
  (el, hydrate) => {
    const events = names.length ? names : INTERACTIONS;
    const early: Event[] = [];
    const stop = (): void => {
      for (const name of events) el.removeEventListener(name, listen, true);
    };
    const replay = (): void => {
      stop();
      for (const e of early.splice(0)) {
        if (e.target instanceof Node && e.target.isConnected) e.target.dispatchEvent(new (e.constructor as typeof Event)(e.type, e));
      }
    };
    function listen(e: Event): void {
      if (early.push(e) === 1) void hydrate().then((mounted) => (mounted ? replay() : stop()));
    }
    for (const name of events) el.addEventListener(name, listen, true);
    return stop;
  };

function trigger(when: string): Trigger | undefined {
  const colon = when.indexOf(":");
  const [kind, arg] = colon < 0 ? [when, undefined] : [when.slice(0, colon), when.slice(colon + 1)];
  if (kind === "visible") return strategy(hydrateOnVisible(arg ? { rootMargin: arg } : undefined));
  if (kind === "idle" && arg === undefined) return idle;
  if (kind === "interaction") return interaction((arg ?? "").split(/\s+/).filter(Boolean));
  if (kind === "media" && arg !== undefined) return strategy(hydrateOnMediaQuery(arg || "all"));
  return undefined;
}

/** Hydrate every island on the page: each `<div data-island="Name" data-props="…">` that
 * `Html::island` wrote becomes an app of the component of that name, given the props the server
 * rendered it with, mounted where it is. A loader is called only for an island the page holds, all
 * of them at once, and the islands mount in document order once every one has loaded. An island
 * with a `data-hydrate` (`Html::hydrate`) waits instead: once it is visible (or within a root margin
 * of the viewport), the browser is idle,
 * it is interacted with or a media query matches, its component is loaded and it hydrates. */
export async function mountIslands(components: Record<string, IslandComponent>, options: MountOptions = {}): Promise<Islands> {
  const root = options.root ?? document;
  const report = options.onError ?? ((el: Element, problem: string) => console.warn(`[ferrovue] island left unhydrated: ${problem}`, el));
  const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-island]"));
  const loading = new Map<string, Promise<Component | Error>>();
  const loadIsland = (name: string): Promise<Component | Error> => {
    let pending = loading.get(name);
    if (!pending) loading.set(name, (pending = load(components[name]!)));
    return pending;
  };
  const ready = options.router?.isReady();
  const apps: App[] = [];
  const waiting: (() => void)[] = [];
  let stopped = false;

  const mount = (el: HTMLElement, name: string, component: Component | Error | undefined): void => {
    if (!component) {
      report(el, `no component called ${JSON.stringify(name)} was given (\`ferrovue/islands\` holds every component that has an \`island()\`)`);
      return;
    }
    if (component instanceof Error) {
      report(el, `${name} did not load: ${component.message}`);
      return;
    }
    let props: Record<string, unknown>;
    try {
      props = parseJson(el.dataset.props ?? "{}") as Record<string, unknown>;
    } catch {
      report(el, `the props of ${name} are not JSON`);
      return;
    }
    // One island that throws as it mounts (its setup, a plugin) is reported, and leaves the others
    // to hydrate.
    try {
      const app = createSSRApp(component, props);
      if (options.pinia) app.use(options.pinia);
      if (options.router) app.use(options.router);
      for (const plugin of options.plugins ?? []) app.use(plugin);
      app.mount(el);
      apps.push(app);
    } catch (e) {
      report(el, `${name} did not mount: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const now: HTMLElement[] = [];
  for (const el of elements) {
    const name = el.dataset.island ?? "";
    const given = Object.hasOwn(components, name);
    const when = el.dataset.hydrate;
    const wait = given && when !== undefined ? trigger(when) : undefined;
    if (!wait) {
      if (given && when !== undefined) report(el, `${name} has data-hydrate=${JSON.stringify(when)}, which this version of ferrovue does not know, so it hydrated at once`);
      if (given) void loadIsland(name);
      now.push(el);
      continue;
    }
    let started = false;
    try {
      waiting.push(
        wait(el, async () => {
          if (started || stopped) return false;
          started = true;
          const [component] = await Promise.all([loadIsland(name), ready]);
          if (stopped) return false;
          mount(el, name, component);
          return true;
        }),
      );
    } catch (e) {
      report(el, `${name} has data-hydrate=${JSON.stringify(when)}, which the browser rejects (${e instanceof Error ? e.message : String(e)}), so it hydrated at once`);
      void loadIsland(name);
      now.push(el);
    }
  }

  const names = new Set(now.map((el) => el.dataset.island ?? "").filter((name) => Object.hasOwn(components, name)));
  const [loaded] = await Promise.all([
    Promise.all([...names].map(async (name) => [name, await loadIsland(name)] as const)).then((pairs) => new Map(pairs)),
    ready,
  ]);
  for (const el of now) {
    const name = el.dataset.island ?? "";
    mount(el, name, loaded.get(name));
  }
  return {
    apps,
    unmount() {
      stopped = true;
      for (const stop of waiting.splice(0)) stop();
      for (const app of apps.splice(0)) app.unmount();
    },
  };
}

type SsrSlot = (props: object, push: (chunk: unknown) => void, parent: unknown, scopeId: string) => unknown;

/** Content only the browser renders. The server writes the `#fallback` slot, or nothing; the
 * browser hydrates that fallback, then swaps in the default slot once mounted. ferrovue does not
 * compile the default slot, so anything may go there: a component library's components, code that
 * reads `window`. The swap happens only where Vue runs on the page, as in an island. */
export const ClientOnly: Component = Object.assign(
  defineComponent({
    name: "ClientOnly",
    inheritAttrs: false,
    setup(_, { slots }) {
      const mounted = ref(false);
      onMounted(() => {
        mounted.value = true;
      });
      return () => (mounted.value ? slots.default?.() : slots.fallback?.());
    },
  }),
  {
    ssrRender(ctx: { $slots: Record<string, SsrSlot | undefined> }, push: (chunk: unknown) => void, parent: unknown): void {
      const fallback = ctx.$slots.fallback;
      if (!fallback) {
        push("<!---->");
        return;
      }
      push("<!--[-->");
      fallback({}, push, parent, "");
      push("<!--]-->");
    },
  },
);

async function load(component: IslandComponent): Promise<Component | Error> {
  if (typeof component !== "function" || "props" in component || "displayName" in component || "__vccOpts" in component) return component;
  try {
    const loaded = await (component as () => Promise<Component | { default: Component }>)();
    return typeof loaded === "object" && "default" in loaded ? loaded.default : loaded;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** One component the server rendered into a slot of a page's layout, as `ferrovue::Part` records
 * it: its name (`c`) and the props it was rendered from (`p`). */
export interface PagePart {
  c: string;
  /** `null` where serde_json refused the props, which the part then renders without. */
  p: Record<string, unknown> | null;
}

/** What `ferrovue::PageRecord` writes: the layout's props, and each slot's parts in order. */
export interface PageRecord {
  /** `null` where serde_json refused the props, which the layout then renders without. */
  props: Record<string, unknown> | null;
  slots: Record<string, PagePart[]>;
}

export interface PageOptions extends Pick<MountOptions, "pinia" | "router" | "plugins"> {
  /** The element holding the layout's root, or a selector for it: `#app` by default. */
  container?: Element | string;
  /** The `id` of the record's script, as given to `PageRecord::script_into`: `__fv_page` by default. */
  record?: string;
  /** The document to read the page from. */
  doc?: Document;
}

export interface PageAppOptions extends Pick<MountOptions, "pinia" | "router" | "plugins"> {
  /** `false` for an app that renders the page from its record into an empty container, as
   * `renderPage` does, in place of hydrating the server's markup. */
  hydrate?: boolean;
}

/** The app of a page: its root renders `layout` with the record's props, and each slot as the
 * components the record names, in order, as a plain array, which hydrates the markup the server
 * wrote with no fragment of its own. With `hydrate: false` the same tree is rendered from scratch,
 * so the first page and every page shown after it are one shape of app. `components` must hold
 * every component the record names. */
export function createPageApp(layout: Component, record: PageRecord, components: Record<string, Component>, options: PageAppOptions = {}): App {
  const slots = Object.fromEntries(
    Object.entries(record.slots).map(([name, parts]) => [
      name,
      () => (parts.length ? parts.map((part) => h(components[part.c]!, part.p)) : [createTextVNode("")]),
    ]),
  );
  const app = (options.hydrate === false ? createApp : createSSRApp)({ name: "FerrovuePage", render: () => h(layout, record.props, slots) });
  if (options.pinia) app.use(options.pinia);
  if (options.router) app.use(options.router);
  for (const plugin of options.plugins ?? []) app.use(plugin);
  return app;
}

function containerOf(options: { container?: Element | string; doc?: Document }): Element {
  const selector = options.container ?? "#app";
  const container = typeof selector === "string" ? (options.doc ?? document).querySelector(selector) : selector;
  if (!container) throw new Error(`[ferrovue] the page has no ${selector as string} to mount on`);
  return container;
}

async function loadPage(caller: string, layout: IslandComponent, record: PageRecord, components: Record<string, IslandComponent>): Promise<[Component, Record<string, Component>]> {
  const names = new Set(Object.values(record.slots).flatMap((parts) => parts.map((part) => part.c)));
  const loading = [...names].map(async (name) => {
    if (!Object.hasOwn(components, name)) throw new Error(`[ferrovue] no component called ${JSON.stringify(name)} was given to ${caller}`);
    return [name, await loadOrThrow(name, components[name]!)] as const;
  });
  const [root, parts] = await Promise.all([loadOrThrow("the layout", layout), Promise.all(loading)]);
  return [root, Object.fromEntries(parts)];
}

/** Hydrate a page `ferrovue::Page` rendered: read its record, load the components it names (and
 * no others), wait for the router, and mount the layout on the container. Rejects, leaving the page
 * as the server rendered it, when the container or the record is missing or a component is not
 * given or does not load. */
export async function mountPage(layout: IslandComponent, components: Record<string, IslandComponent>, options: PageOptions = {}): Promise<App> {
  const doc = options.doc ?? document;
  const container = containerOf(options);
  const id = options.record ?? "__fv_page";
  const text = doc.getElementById(id)?.textContent;
  if (!text) throw new Error(`[ferrovue] the page has no record: no <script id="${id}">`);
  const record = parseJson(text) as PageRecord;
  const [[root, parts]] = await Promise.all([loadPage("mountPage", layout, record, components), options.router?.isReady()]);
  const app = createPageApp(root, record, parts, options);
  app.mount(container);
  return app;
}

export interface RenderPageOptions extends Pick<MountOptions, "pinia" | "router" | "plugins"> {
  /** The element holding the page shown now, or a selector for it: `#app` by default. */
  container?: Element | string;
  /** What shows the page now: the app `mountPage` or `renderPage` returned, or the islands
   * `mountIslands` mounted. It is unmounted once the next page is mounted. */
  previous?: { unmount(): void } | undefined;
  /** The document the container is in. */
  doc?: Document;
}

/** Show the next page of a navigation from its record, as `readPage` read it out of the fetched
 * document: load the components it names (and no others), render the app `createPageApp` builds
 * with `hydrate: false` into a copy of the container with no children, wait for the router, put the
 * copy in the container's place, mount, and then unmount `previous`. The next app is mounted
 * before the previous one is unmounted, so a router both use stays started. `router` must be at the
 * next page's location: `linkRouter` with the `location` the navigation goes to. Rejects, leaving
 * the page shown as it is, when the container is missing or a component is not given or does not
 * load. */
export async function renderPage(layout: IslandComponent, components: Record<string, IslandComponent>, record: PageRecord, options: RenderPageOptions = {}): Promise<App> {
  const container = containerOf(options);
  const [root, parts] = await loadPage("renderPage", layout, record, components);
  const app = createPageApp(root, record, parts, { ...options, hydrate: false });
  await options.router?.isReady();
  const next = container.cloneNode(false) as Element;
  container.replaceWith(next);
  try {
    app.mount(next);
  } catch (e) {
    next.replaceWith(container);
    throw e;
  }
  options.previous?.unmount();
  return app;
}

async function loadOrThrow(name: string, component: IslandComponent): Promise<Component> {
  const result = await load(component);
  if (result instanceof Error) throw new Error(`[ferrovue] ${name} did not load: ${result.message}`, { cause: result });
  return result;
}
