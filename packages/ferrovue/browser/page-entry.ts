import type { Component } from "vue";
import type { PageRecord } from "../src/client.ts";
import { hydrateRecordedPage } from "../src/hydration.ts";

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/{Panel,Frame,Text,Prose}.vue", {
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
  }
}

async function hydrate(): Promise<string> {
  const data = JSON.parse(document.getElementById("fv-page-case")!.textContent) as PageCase;
  try {
    const app = await hydrateRecordedPage({ html: data.html, record: data.record },components[data.layout]!, components);
    const text = document.getElementById("app")!.textContent;
    app.unmount();
    return `hydrated: ${text}`;
  } catch (e) {
    return String(e);
  }
}

window.pageHydration = hydrate();
