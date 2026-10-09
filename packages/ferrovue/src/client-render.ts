import { normalizeCssVarValue } from "@vue/shared";
import { type App, Fragment, type Plugin, Static } from "vue";
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
  const style = styleShape(el.getAttribute("style") ?? "", scratch);
  if (style) attrs.push(` style=${JSON.stringify(style)}`);
  for (const name of state) attrs.push(` .${name}=${JSON.stringify((el as unknown as Record<string, unknown>)[name])}`);
  const children = el.tagName === "TEXTAREA" ? "" : nodes(el.childNodes, scratch);
  return `<${el.localName}${attrs.join("")}>${children}</${el.localName}>`;
}

function styleShape(text: string, scratch: HTMLElement): string {
  scratch.setAttribute("style", text);
  const { style } = scratch;
  const own: string[] = [];
  const custom: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    const declared = `${name.replace(/\\(.)/g, "$1")}: ${style.getPropertyValue(name).trim()}${style.getPropertyPriority(name) ? " !important" : ""};`;
    (name.startsWith("--") ? custom : own).push(declared);
  }
  return [...own, ...custom.toSorted()].join(" ");
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
 * holds, a `style` attribute by the declarations it holds (custom properties, which Vue's client
 * sets for `v-bind()` in `<style>` after the others, by name in any order), and the state of a form control (an
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

interface VNodeShape {
  type: unknown;
  shapeFlag: number;
  el: Node | null;
  anchor: Node | null;
  children: unknown;
  component: InstanceShape | null;
  suspense: { activeBranch: VNodeShape | null } | null;
}

interface InstanceShape {
  subTree: VNodeShape;
  getCssVars?: () => Record<string, unknown>;
}

function setVarsOnNode(node: Node, vars: Record<string, unknown>): void {
  if (node.nodeType !== 1) return;
  for (const key in vars) (node as HTMLElement).style.setProperty(`--${key}`, normalizeCssVarValue(vars[key]));
}

function setVarsOnVNode(vnode: VNodeShape | null, vars: Record<string, unknown>): void {
  let at = vnode && vnode.shapeFlag & 128 ? (vnode.suspense?.activeBranch ?? null) : vnode;
  while (at?.component) at = at.component.subTree;
  if (!at) return;
  if (at.shapeFlag & 1 && at.el) setVarsOnNode(at.el, vars);
  else if (at.type === Fragment && Array.isArray(at.children)) for (const c of at.children as VNodeShape[]) setVarsOnVNode(c, vars);
  else if (at.type === Static) {
    for (let el = at.el; el; el = el.nextSibling) {
      setVarsOnNode(el, vars);
      if (el === at.anchor) break;
    }
  }
}

function eachInstance(vnode: VNodeShape | null, visit: (instance: InstanceShape) => void): void {
  if (!vnode) return;
  if (vnode.component) {
    visit(vnode.component);
    eachInstance(vnode.component.subTree, visit);
  }
  if (vnode.shapeFlag & 128) eachInstance(vnode.suspense?.activeBranch ?? null, visit);
  if (Array.isArray(vnode.children)) for (const c of vnode.children as unknown[]) if (c && typeof c === "object") eachInstance(c as VNodeShape, visit);
}

/** Set the custom properties `v-bind()` in `<style>` gives each component's root elements, as Vue's
 * client sets them once mounted, where Vue's build does not set them itself (its Node build) and a
 * component tells them through `getCssVars`, as `attachSsrRender` makes it. */
export function applyCssVars(app: App): void {
  const root = (app as unknown as { _instance: InstanceShape | null })._instance;
  if (!root) return;
  const visit = (instance: InstanceShape): void => {
    if (instance.getCssVars) setVarsOnVNode(instance.subTree, instance.getCssVars());
  };
  visit(root);
  eachInstance(root.subTree, visit);
}

/** Where `app`, mounted on `container`, showed something other than `expected` (a
 * `renderedShape`): as mounting left it (`atMount`), and, where that differs while async
 * components are loading, once they have loaded. `null` where it agrees at either point. */
export async function renderDifference(app: App, container: Element, atMount: string, expected: string): Promise<string | null> {
  let shown = atMount;
  if (shown !== expected && stillLoading(app)) {
    await settled(app);
    applyCssVars(app);
    shown = renderedShape(container);
  }
  return shown === expected ? null : `the client renders it differently:\n  server: ${expected}\n  client: ${shown}`;
}
