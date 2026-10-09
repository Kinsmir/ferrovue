import type { App, Component, Plugin } from "vue";
import { mountPage, readPage, renderPage, type IslandComponent, type PageOptions, type PageRecord, type RenderPageOptions } from "./client.ts";
import { parsedShape, renderDifference, shapeAtMount } from "./client-render.ts";
import { settled } from "./settle.ts";

/** A page as the server wrote it: `html` holds the container and, unless `record` is given, the
 * record's script. */
export interface RecordedPage {
  html: string;
  record?: PageRecord;
}

function recordScript(id: string, record: PageRecord): string {
  const json = JSON.stringify(record).replace(/[<>&\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `<script type="application/json" id="${id}">${json}</script>`;
}

function shape(node: Node, scratch: HTMLElement): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType === 8) return `<!--${node.textContent ?? ""}-->`;
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const attrs = el
    .getAttributeNames()
    .filter((name) => name !== "style")
    .toSorted()
    .map((name) => ` ${name}=${JSON.stringify(el.getAttribute(name))}`);
  scratch.setAttribute("style", el.getAttribute("style") ?? "");
  if (scratch.style.cssText) attrs.push(` style=${JSON.stringify(scratch.style.cssText)}`);
  return `<${el.tagName}${attrs.join("")}>${[...el.childNodes].map((child) => shape(child, scratch)).join("")}</${el.tagName}>`;
}

/** Put a recorded page into the document's body and hydrate it with `mountPage`, throwing on a
 * node Vue replaced, on any change hydrating made to the markup (a `style` attribute is compared by
 * the declarations it holds), and on anything Vue warns or logs as an error until the page has
 * settled. The markup is compared as hydrating leaves it; what changes once the page is mounted,
 * such as a `<ClientOnly>` showing its content or an async component loading, is the app's to
 * change. Resolves to the app, mounted and settled. */
export async function hydrateRecordedPage(
  page: RecordedPage,
  layout: Component,
  components: Record<string, IslandComponent>,
  options: PageOptions = {},
): Promise<App> {
  const doc = options.doc ?? document;
  const id = options.record ?? "__fv_page";
  doc.body.innerHTML = page.html + (page.record ? recordScript(id, page.record) : "");
  const selector = options.container ?? "#app";
  const container = typeof selector === "string" ? doc.querySelector(selector) : selector;
  if (!container) throw new Error(`the recorded page has no ${selector as string}`);
  const scratch = doc.createElement("div");
  const before = container.innerHTML;
  const shapeBefore = [...container.childNodes].map((child) => shape(child, scratch)).join("");
  const first = container.firstChild;
  const problems: string[] = [];
  const shapeOf = (): string => [...container.childNodes].map((child) => shape(child, scratch)).join("");
  let hydrated = "";
  let shapeHydrated = "";
  const watch: Plugin = {
    install(app) {
      app.config.warnHandler = (message) => void problems.push(`warning: ${message}`);
      const mount = app.mount.bind(app);
      app.mount = (...args: Parameters<App["mount"]>) => {
        const root = mount(...args);
        hydrated = container.innerHTML;
        shapeHydrated = shapeOf();
        return root;
      };
    },
  };
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => void problems.push(`console.warn: ${args.map(String).join(" ")}`);
  console.error = (...args: unknown[]) => void problems.push(`console.error: ${args.map(String).join(" ")}`);
  let app: App;
  try {
    app = await mountPage(layout, components, { ...options, doc, container, plugins: [...(options.plugins ?? []), watch] });
    await settled(app);
  } finally {
    console.warn = warn;
    console.error = error;
  }
  if (container.firstChild !== first) problems.push("Vue replaced the server's first node");
  if (shapeHydrated !== shapeBefore) problems.push(`hydrating changed the markup:\n  server:   ${before}\n  hydrated: ${hydrated}`);
  if (problems.length) {
    app.unmount();
    throw new Error(`the page did not hydrate exactly:\n${problems.join("\n")}`);
  }
  return app;
}

/** Put a recorded page into the document's body and show it again from its record with
 * `renderPage`, as a navigation shows the next page, throwing where the client's render differs
 * from the markup the browser parsed, as `renderedShape` compares them (comments and empty text
 * aside, classes, styles and form controls by what they hold), and on anything Vue warns or logs as
 * an error. The render is compared as mounting leaves it, where `<ClientOnly>` still shows its
 * fallback as the server wrote it, and, where that differs while async components are loading,
 * once they have loaded. What is teleported out of the page is not compared. Resolves to the app,
 * mounted. */
export async function renderRecordedPage(
  page: RecordedPage,
  layout: Component,
  components: Record<string, IslandComponent>,
  options: RenderPageOptions & { record?: string } = {},
): Promise<App> {
  const doc = options.doc ?? document;
  const id = options.record ?? "__fv_page";
  doc.body.innerHTML = page.html + (page.record ? recordScript(id, page.record) : "");
  const record = page.record ?? readPage(page.html, { record: id }).record;
  const selector = options.container ?? "#app";
  const container = typeof selector === "string" ? doc.querySelector(selector) : selector;
  if (!container) throw new Error(`the recorded page has no ${selector as string}`);
  const expected = parsedShape(container);
  const problems: string[] = [];
  const watch: Plugin = {
    install(app) {
      app.config.warnHandler = (message) => void problems.push(`warning: ${message}`);
    },
  };
  const mounted = shapeAtMount();
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => void problems.push(`console.warn: ${args.map(String).join(" ")}`);
  console.error = (...args: unknown[]) => void problems.push(`console.error: ${args.map(String).join(" ")}`);
  let app: App;
  try {
    app = await renderPage(layout, components, record, { ...options, doc, container, plugins: [...(options.plugins ?? []), watch, mounted.plugin] });
    const difference = await renderDifference(app, mounted.container() ?? container, mounted.shape() ?? "", expected);
    if (difference) problems.push(difference);
  } finally {
    console.warn = warn;
    console.error = error;
  }
  if (problems.length) {
    app.unmount();
    throw new Error(`the page did not render from its record exactly:\n${problems.join("\n")}`);
  }
  return app;
}
