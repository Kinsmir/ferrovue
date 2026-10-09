import { expect, it } from "vitest";
import { createPinia } from "pinia";
import { createApp, h, nextTick } from "vue";
import { ClientOnly, hydrateState, readPage, type PageRecord } from "../src/client.ts";

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
  expect(readPage(html, { record: "next", state: "stores" })).toEqual({ record: RECORD, state: "{}" });
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
