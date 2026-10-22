import { expect, it } from "vitest";
import { createPinia } from "pinia";
import { type Component, createApp, defineComponent, h, nextTick, type PropType } from "vue";
import { renderToString } from "vue/server-renderer";
import { clearLoads, ClientOnly, createPageApp, defineLoader, hydrateState, loadKey, provideLoads, readPage, reviveDates, type PageRecord } from "../src/client.ts";

it("hands Pinia the state the server escaped into the page", () => {
  document.body.innerHTML =
    '<script type="application/json" id="__pinia">{"prefs":{"label":"\\u003c/script\\u003e\\u0026"}}</script>';
  const pinia = createPinia();
  hydrateState(pinia);
  expect(pinia.state.value).toEqual({ prefs: { label: "</script>&" } });
});

it("reads back the bare NaN and infinities the server writes for numbers JSON cannot carry", () => {
  document.body.innerHTML =
    '<script type="application/json" id="__pinia">{"m":{"a":NaN,"b":[Infinity,-Infinity,-0.0,1.5],"c":"NaN","d":"\\"Infinity\\\\","e":"\\u0000NaN","f":["\\u0000\\u0000-Infinity",null]}}</script>';
  const pinia = createPinia();
  hydrateState(pinia);
  expect(pinia.state.value).toEqual({
    m: { a: Number.NaN, b: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 1.5], c: "NaN", d: '"Infinity\\', e: "\u0000NaN", f: ["\u0000\u0000-Infinity", null] },
  });
  expect(Object.is((pinia.state.value.m as { b: number[] }).b[2], -0)).toBe(true);
});

it("still refuses what is not JSON when it holds the same letters", () => {
  document.body.innerHTML = '<script type="application/json" id="__pinia">{"a":NaNx}</script>';
  expect(() => hydrateState(createPinia())).toThrow(SyntaxError);
});

it("shows `<ClientOnly>`'s fallback when mounted, and its content once mounted", async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const app = createApp({ render: () => h("p", [h(ClientOnly, null, { default: () => [h("b", "chart")], fallback: () => [h("i", "loading")] })]) });
  app.mount("#app");
  expect(document.getElementById("app")!.innerHTML).toBe("<p><i>loading</i></p>");
  await nextTick();
  expect(document.getElementById("app")!.innerHTML).toBe("<p><b>chart</b></p>");
  app.unmount();
});

it("leaves Pinia alone when the page carries no state", () => {
  document.body.innerHTML = "";
  const pinia = createPinia();
  hydrateState(pinia);
  hydrateState(pinia, { text: undefined });
  hydrateState(pinia, { text: "" });
  expect(pinia.state.value).toEqual({});
});

it("hands Pinia state given as text, reading back what JSON cannot carry as from the page", () => {
  const pinia = createPinia();
  hydrateState(pinia, { text: '{"m":{"a":NaN,"b":[Infinity,-Infinity],"c":"\\u003c/script\\u003e\\u2028","d":"NaN"}}' });
  expect(pinia.state.value).toEqual({ m: { a: Number.NaN, b: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY], c: "</script>\u2028", d: "NaN" } });
  expect(() => hydrateState(createPinia(), { text: '{"a":NaNx}' })).toThrow(SyntaxError);
});

const json = (value: unknown): string => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
const script = (id: string, text: string): string => `<script type="application/json" id="${id}">${text}</script>`;
const RECORD: PageRecord = { props: { title: "</script><!-- \u2028\u2029 & NaN" }, slots: { default: [{ c: "Item", p: { label: '<script id="__fv_page">', n: 1 } }] } };
const page = (body: string, after = ""): string =>
  `<!doctype html><html><head><title>&lt;script id="__fv_page"&gt;</title></head><body>${body}<div id="app"></div>${script("__fv_page", json(RECORD))}${script("__pinia", '{"s":{"n":NaN}}')}${after}</body></html>`;

it("reads the record and the state as the server writes them, reversing their escapes", () => {
  const read = readPage(page(""));
  expect(read.record).toEqual(RECORD);
  expect(read.state).toBe('{"s":{"n":NaN}}');
  const pinia = createPinia();
  hydrateState(pinia, { text: read.state });
  expect(pinia.state.value).toEqual({ s: { n: Number.NaN } });
  const bare = readPage(script("__fv_page", '{"props":{"n":NaN,"i":[-Infinity,Infinity],"t":"NaN Infinity"},"slots":{"default":[{"c":"Item","p":{"n":NaN}}]}}'));
  expect(bare.record).toEqual({ props: { n: Number.NaN, i: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY], t: "NaN Infinity" }, slots: { default: [{ c: "Item", p: { n: Number.NaN } }] } });
  expect(readPage(script("__fv_page", json(RECORD).replace(/\\u(2028|2029)/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16))))).record).toEqual(RECORD);
});

it("reads scripts by the ids given, and no state where the page has none", () => {
  const html = script("next", json(RECORD)) + script("stores", "{}");
  expect(readPage(html, { record: "next", state: "stores" })).toEqual({ record: RECORD, state: "{}", loads: [] });
  expect(readPage(script("__fv_page", json(RECORD))).state).toBeUndefined();
  expect(() => readPage(page("").replace('<script type="application/json" id="__fv_page">', '<script type="application/json" id="other">'))).toThrow('[ferrovue] the page has no record: no <script id="__fv_page">');
  expect(() => readPage(script("__fv_page", ""))).toThrow(/no record/);
});

it("finds the scripts as the HTML parser does, whatever the quoting, case and order of their attributes", () => {
  for (const open of ["<script id=__fv_page>", "<SCRIPT ID='__fv_page' TYPE=application/json>", '<script\ntype="application/json"\n\tid = "__fv_page" >', '<script id="&#95;&#x5f;fv&#95;page">', '<script id="__fv_page" id="other">']) {
    expect(readPage(`<p>x</p>${open}${json(RECORD)}</script>`).record, open).toEqual(RECORD);
  }
  expect(() => readPage(`<script id="other" id="__fv_page">${json(RECORD)}</script>`)).toThrow(/no record/);
  expect(() => readPage(`<script data-id="__fv_page">${json(RECORD)}</script><script id="__fv_page2">${json(RECORD)}</script>`)).toThrow(/no record/);
});

it("is not fooled by an id in an attribute, a comment, raw text, a template, foreign content or a script's escaped text", () => {
  const fake = script("__fv_page", '{"props":{"fake":true},"slots":{}}');
  const hiding = [
    `<div data-props='{"html":"${fake}"}'></div>`,
    `<div title="${fake.replace(/"/g, "&quot;")}" data-x='${fake}'></div>`,
    `<!-- ${fake} -->`,
    `<!--x--!><!-- ${fake} --!>`,
    `<!---- ${fake} ---->`,
    `<textarea>${fake}</textarea>`,
    `<title>${fake}</TITLE >`,
    `<style>p::after { content: '${fake}' }</style>`,
    `<noscript>${fake}</noscript>`,
    `<template><p>${fake}</p></template>`,
    `<svg><desc>${fake}</desc></svg>`,
    `<math><mi>${fake}</mi></math>`,
    `<script>var s = '${fake.replace("</script>", "")}';</script>`,
    `<script>x = "<!--<script>"; ${fake} --></script>`,
    `<script>x = "<!--<script>"</script>${fake}--></script>`,
    `<?php ${fake} ?>`,
    `<! ${fake.replace(/>/g, "")}>`,
  ];
  for (const hide of hiding) expect(readPage(page(hide)).record, hide).toEqual(RECORD);
});

it("finds a script the HTML parser makes where it only looks hidden", () => {
  const fake = script("__fv_page", '{"props":{"fake":true},"slots":{}}');
  for (const shown of [`<!-->${fake}`, `<!--->${fake}`, `<script>x = "<!--"; y = "-->"</script>${fake}`, `<svg><p>${fake}`, `<script><!--<script></script>--></script>${fake}`]) {
    expect(readPage(page(shown)).record, shown).toEqual({ props: { fake: true }, slots: {} });
  }
});

it("reads a record no end tag closes, and stops at text that never ends", () => {
  expect(readPage(`<script id="__fv_page">${json(RECORD)}`).record).toEqual(RECORD);
  expect(() => readPage(`<textarea>${script("__fv_page", json(RECORD))}`)).toThrow(/no record/);
  expect(() => readPage(`<plaintext>${script("__fv_page", json(RECORD))}`)).toThrow(/no record/);
  expect(() => readPage(`<div title="${script("__fv_page", json(RECORD))}`)).toThrow(/no record/);
});

const DATED = {
  at: { type: Date, required: true as const },
  maybe: { type: [Date, null] as PropType<Date | null>, required: true as const },
  later: Date,
  label: String,
  count: Number,
};

const Dated = defineComponent({
  props: DATED,
  render() {
    const shown = (d: unknown): string => (d instanceof Date ? String(d.getTime()) : String(d));
    return h("p", [this.at, this.maybe, this.later].map(shown).join("|") + `|${this.label}|${this.count}`);
  },
});

it("turns each prop a component declares a Date from its ISO string or number back into a Date", () => {
  const given = { at: "+010000-01-01T00:00:00.000Z", maybe: null, later: Number.NaN, label: "2024-01-01", count: 5, extra: "2024-01-01" };
  const revived = reviveDates(Dated, given);
  expect(revived).toEqual({ ...given, at: new Date(253402300800000), later: new Date(Number.NaN) });
  expect(revived.later).toBeInstanceOf(Date);
  expect(given.at).toBe("+010000-01-01T00:00:00.000Z");
  const plain = { label: "x" };
  expect(reviveDates(Dated, plain)).toBe(plain);
  expect(reviveDates(Dated, null)).toBeNull();
  expect(reviveDates(defineComponent({ props: ["at"], render: () => null }), { at: "2024-01-01" })).toEqual({ at: "2024-01-01" });
  expect(reviveDates(defineComponent({ props: { at: Date }, render: () => null }), { at: 0 }).at).toEqual(new Date(0));
});

it("renders a page whose layout and parts take Dates from the record's JSON", async () => {
  const record = readPage('<script type="application/json" id="__fv_page">{"props":{"at":"1970-01-01T00:00:00.001Z","maybe":NaN},"slots":{"default":[{"c":"Dated","p":{"at":-1,"maybe":"1970-01-01","later":"1970-01-02"}}]}}</script>').record;
  const Layout = defineComponent({
    props: DATED,
    setup(props, { slots }) {
      return () => h("main", [h(Dated as Component, { at: props.at, maybe: props.maybe, later: props.later }), slots.default?.()]);
    },
  });
  const html = await renderToString(createPageApp(Layout, record, { Dated }, { hydrate: false }));
  expect(html).toBe("<main><p>1|NaN|undefined|undefined|undefined</p><!--[--><p>-1|0|86400000|undefined|undefined</p><!--]--></main>");
});

it("keys a loader's call as the server does, leaving out the arguments not given at the end", () => {
  expect(loadKey("loadPost", [7])).toBe('["loadPost",7]');
  expect(loadKey("loadPost", [7, undefined])).toBe('["loadPost",7]');
  expect(loadKey("loadPost", [7, undefined, "en"])).toBe('["loadPost",7,null,"en"]');
  expect(loadKey("loadPost", [7, null])).toBe('["loadPost",7,null]');
  expect(loadKey("loadViews", [])).toBe('["loadViews"]');
});

it("answers a loader from the page's results, and runs it for a call the page does not carry", async () => {
  clearLoads();
  document.body.innerHTML = '<script type="application/json" data-fv-loads>{"[\\"loadName\\",1]":"\\u003cAda\\u003e"}</script>';
  const ran: number[] = [];
  const loadName = defineLoader("loadName", async (id: number): Promise<string> => {
    ran.push(id);
    return `user ${id}`;
  });
  expect(await loadName(1)).toBe("<Ada>");
  expect(await loadName(2)).toBe("user 2");
  expect(ran).toEqual([2]);
  provideLoads({ '["loadName",2]': "Grace" });
  expect(await loadName(2)).toBe("Grace");
  const read = readPage(`${script("__fv_page", json(RECORD))}<script data-fv-loads type="application/json">{"[\\"loadName\\",3]":"Lin"}</script>`);
  expect(read.loads).toEqual(['{"[\\"loadName\\",3]":"Lin"}']);
  provideLoads(read.loads[0]!);
  expect(await loadName(3)).toBe("Lin");
  clearLoads();
  document.body.innerHTML = "";
  expect(await loadName(1)).toBe("user 1");
  clearLoads();
});

it("hydrates a page whose components await loaders inside a `<Suspense>`, from the results it carries", async () => {
  clearLoads();
  const loadTitle = defineLoader("loadTitle", async (id: number): Promise<string> => `server ${id}`);
  const Title = defineComponent({
    props: { id: { type: Number, required: true } },
    async setup(props) {
      const title = await loadTitle(props.id);
      return () => h("h1", title);
    },
  });
  const record: PageRecord = { props: { id: 4 }, slots: {} };
  const html = await renderToString(createPageApp(Title, record, {}, { hydrate: false, suspense: true }));
  expect(html).toBe("<h1>server 4</h1>");
  document.body.innerHTML = `<div id="app">${html}</div><script type="application/json" data-fv-loads>{"[\\"loadTitle\\",4]":"server 4"}</script>`;
  const warnings: string[] = [];
  const app = createPageApp(Title, record, {});
  app.config.warnHandler = (msg) => warnings.push(msg);
  app.mount("#app");
  await new Promise((done) => setTimeout(done, 0));
  expect(document.querySelector("#app")!.innerHTML).toBe("<h1>server 4</h1>");
  expect(warnings).toEqual([]);
  app.unmount();
  clearLoads();
});
