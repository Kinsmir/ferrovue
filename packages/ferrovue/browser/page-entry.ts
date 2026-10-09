import type { Component } from "vue";
import { readPage, type PageRecord } from "../src/client.ts";
import { hydrateRecordedPage, renderRecordedPage } from "../src/hydration.ts";

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/{Panel,Frame,Text,Prose,ClientSide,PlainBox}.vue", {
  eager: true,
});
const components: Record<string, Component> = Object.fromEntries(
  Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]),
);

export interface PageCase {
  layout: string;
  html: string;
  record: PageRecord;
}

declare global {
  interface Window {
    pageHydration?: Promise<string>;
    pageRender?: () => Promise<string>;
    readsAsParsed?: (html: string) => [string, string];
  }
}

const data = (): PageCase => JSON.parse(document.getElementById("fv-page-case")!.textContent) as PageCase;

async function hydrate(): Promise<string> {
  const page = data();
  try {
    const app = await hydrateRecordedPage({ html: page.html, record: page.record }, components[page.layout]!, components);
    const text = document.getElementById("app")!.innerHTML;
    app.unmount();
    return `hydrated: ${text}`;
  } catch (e) {
    return String(e);
  }
}

async function render(): Promise<string> {
  const page = data();
  try {
    const app = await renderRecordedPage({ html: page.html, record: page.record }, components[page.layout]!, components);
    const text = document.getElementById("app")!.innerHTML;
    app.unmount();
    return `rendered: ${text}`;
  } catch (e) {
    return String(e);
  }
}

function readsAsParsed(html: string): [string, string] {
  let read: string;
  try {
    read = JSON.stringify(readPage(html).record);
  } catch (e) {
    read = String(e);
  }
  const parsed = new DOMParser().parseFromString(html, "text/html").getElementById("__fv_page");
  return [read, parsed instanceof HTMLScriptElement && parsed.textContent ? JSON.stringify(JSON.parse(parsed.textContent)) : "Error: [ferrovue] the page has no record: no <script id=\"__fv_page\">"];
}

window.pageHydration = hydrate();
window.pageRender = render;
window.readsAsParsed = readsAsParsed;
