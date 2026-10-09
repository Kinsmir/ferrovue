import type { App, Plugin } from "vue";
import { settled, stillLoading } from "./settle.ts";

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STATE_ATTRS: Record<string, string[]> = { INPUT: ["value", "checked"], TEXTAREA: ["value"], OPTION: ["selected"] };

function element(el: Element, scratch: HTMLElement): string {
  const state = STATE_ATTRS[el.tagName] ?? [];
  const attrs = el
    .getAttributeNames()
    .filter((name) => name !== "style" && name !== "class" && !state.includes(name))
    .toSorted()
    .map((name) => ` ${name}=${JSON.stringify(el.getAttribute(name))}`);
  const classes = [...new Set((el.getAttribute("class") ?? "").split(/[\t\n\f\r ]+/).filter(Boolean))].toSorted();
  if (classes.length) attrs.push(` class=${JSON.stringify(classes.join(" "))}`);
  scratch.setAttribute("style", el.getAttribute("style") ?? "");
  if (scratch.style.cssText) attrs.push(` style=${JSON.stringify(scratch.style.cssText)}`);
  for (const name of state) attrs.push(` .${name}=${JSON.stringify((el as unknown as Record<string, unknown>)[name])}`);
  const children = el.tagName === "TEXTAREA" ? "" : nodes(el.childNodes, scratch);
  return `<${el.localName}${attrs.join("")}>${children}</${el.localName}>`;
}

function nodes(list: NodeListOf<ChildNode>, scratch: HTMLElement): string {
  let out = "";
  let text = "";
  for (const node of list) {
    if (node.nodeType === 3) {
      text += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== 1) continue;
    out += escapeText(text) + element(node as Element, scratch);
    text = "";
  }
  return out + escapeText(text);
}

/** The DOM inside `container` as a client render is compared with the server's markup: comments
 * left out, adjacent text joined and empty text dropped, a `class` attribute by the classes it
 * holds, a `style` attribute by the declarations it holds, and the state of a form control (an
 * `<input>`'s `value` and `checked`, a `<textarea>`'s `value`, an `<option>`'s `selected`) by its
 * property, which Vue's client sets where the server writes the attribute. */
export function renderedShape(container: Element): string {
  return nodes(container.childNodes, container.ownerDocument.createElement("div"));
}

/** A plugin that takes what the app is mounted on, and its `renderedShape` as `mount` returns,
 * before any update an `onMounted` hook scheduled has run. */
export function shapeAtMount(): { plugin: Plugin; container: () => Element | undefined; shape: () => string | undefined } {
  let container: Element | undefined;
  let shape: string | undefined;
  const plugin: Plugin = {
    install(app: App) {
      const mount = app.mount.bind(app);
      app.mount = (...args: Parameters<App["mount"]>) => {
        const root = mount(...args);
        const [target] = args;
        container = (typeof target === "string" ? document.querySelector(target) : target) as Element;
        shape = renderedShape(container);
        return root;
      };
    },
  };
  return { plugin, container: () => container, shape: () => shape };
}

/** Where `app`, mounted on `container`, showed something other than `expected` (a
 * `renderedShape`): as mounting left it (`atMount`), and, where that differs while async
 * components are loading, once they have loaded. `null` where it agrees at either point. */
export async function renderDifference(app: App, container: Element, atMount: string, expected: string): Promise<string | null> {
  let shown = atMount;
  if (shown !== expected && stillLoading(app)) {
    await settled(app);
    shown = renderedShape(container);
  }
  return shown === expected ? null : `the client renders it differently:\n  server: ${expected}\n  client: ${shown}`;
}
