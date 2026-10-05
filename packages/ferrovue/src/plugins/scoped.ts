/* Scoped styles: each `<style scoped>` component's `data-v-` id, computed as the bundler computes
 * it, and where scope ids reach — which components' roots a parent may hand ids to, and which
 * components' slot content may be given a slot scope id. Both decide a generated signature —
 * `render` taking `fv_attrs`, slot content taking `fv_sid` — so they are worked out for every
 * component before any is generated.
 *
 * With `<style scoped>`, Vue's server renderer writes the component's id onto each of its elements
 * (the compiled template spells it out) and hands ids to a child component's root through the
 * child's `_attrs`: the id of the component that created it, what its parent passes on when the
 * child is that parent's root, and the slot scope ids of the slot content it is rendered in
 * (`renderComponentSubTree`). A component with `:slotted()` styles gives its slot content
 * `data-v-…-s` as well, which the content writes onto its elements as `_scopeId`.
 *
 * The same `_attrs` carries the attributes a parent passes a child beyond its props, ahead of the
 * ids (`fallthrough.ts`). */

import { parse as parseJs } from "@babel/parser";
import { createHash } from "node:crypto";
import { relative, resolve as resolvePath, sep } from "node:path";
import { type Component, type N, type Scope, fail, rustStr } from "../model.ts";
import { type ScopeIdMode } from "../context.ts";
import { type Plugin, runOf } from "../plugin.ts";

/** Scoped styles in one run: how ids are computed, from which directory a component's path is
 * hashed, and each \`<style scoped>\` component's id and whether its styles use \`:slotted()\`. */
interface ScopedRun {
  mode: ScopeIdMode;
  viteRoot: string;
  ids: Map<Component, string>;
  slotted: Set<Component>;
}

/** \`data-v-…\`, the id a component's \`<style scoped>\` gives its elements, or \`null\` without one. */
export function scopeIdOf(comp: Component): string | null {
  return runOf(scoped).ids.get(comp) ?? null;
}

/** \`getHash\` in \`@vitejs/plugin-vue\`: the first 8 hex digits of the SHA-256 of the file's path from
 * Vite's root, with \`/\` between its parts, followed in \`"filepath-source"\` mode by its source. */
function scopeHash(file: string, source: string): string {
  const { mode, viteRoot } = runOf(scoped);
  const path = relative(viteRoot, resolvePath(file)).split(sep).join("/");
  return createHash("sha256")
    .update(mode === "filepath" ? path : path + source)
    .digest("hex")
    .slice(0, 8);
}

/** A child component the compiled template renders. */
interface Call {
  child: string;
  /** Whether its props hold the parent's own `_attrs`: it is the parent's root. */
  passesAttrs: boolean;
  /** Inside slot content, which hands it `_scopeId`: the component the content is given to. */
  within: string | null;
}

/** A `<slot>` outlet: the slot scope id it passes — always one (`"id"`), the one its own slot
 * content was given (`"forward"`), or none — and the component that content is given to. */
interface Outlet {
  passes: "id" | "forward" | "none";
  within: string | null;
}

/** The child components and outlets in one component's compiled template. */
function flowOf(comp: Component, ssr: string, children: Map<string, string>): { calls: Call[]; outlets: Outlet[] } {
  const calls: Call[] = [];
  const outlets: Outlet[] = [];
  // `const _component_Tree = _resolveComponent("Tree", true)`: the component itself, by name.
  const self = new Set<string>();
  const resolve = (target: N): string | null => {
    if (target?.type === "MemberExpression" && target.object.name === "$setup") {
      return children.get(target.computed ? target.property.value : target.property.name) ?? null;
    }
    return target?.type === "Identifier" && self.has(target.name) ? comp.name : null;
  };
  const mentions = (n: N, name: string): boolean =>
    !!n && typeof n === "object" && (n.type === "Identifier" ? n.name === name : Object.values(n).some((v) => mentions(v, name)));
  const walk = (n: N, within: string | null): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x, within);
      return;
    }
    if (n.type === "VariableDeclarator" && n.init?.type === "CallExpression" && n.init.callee.name === "_resolveComponent") {
      if (n.init.arguments[0]?.value === comp.name && n.init.arguments[1]) self.add(n.id.name);
    }
    if (n.type === "CallExpression" && n.callee.type === "Identifier") {
      const a: N[] = n.arguments;
      if (n.callee.name === "_ssrRenderComponent") {
        const child = resolve(a[0]);
        if (child) calls.push({ child, passesAttrs: mentions(a[1], "_attrs"), within: a[4] ? within : null });
        // Slot content given to the child: its `_scopeId` is what the child's outlets pass.
        walk(a[2], child);
        return;
      }
      if (n.callee.name === "_ssrRenderSlot" || n.callee.name === "_ssrRenderSlotInner") {
        const id = a[6];
        const passes = !id || id.type === "NullLiteral" ? "none" : id.type === "Identifier" && id.name === "_scopeId" ? "forward" : "id";
        outlets.push({ passes, within });
      }
    }
    for (const [key, v] of Object.entries(n)) if (key !== "loc" && key !== "start" && key !== "end") walk(v, within);
  };
  walk(parseJs(ssr, { sourceType: "module" }).program, null);
  return { calls, outlets };
}

/** Set every component's `inherits` and `passesSlotIds`, each a least fixed point: a component's
 * slot content may be given an id when one of its outlets passes one, or forwards what the slot
 * content it sits in was given; a root may be handed ids by a scoped parent, by a parent that
 * passes on what it inherits, or by slot content that may be given an id. */
function scopeFlow(read: { comp: Component; ssr: string; children: Map<string, string> }[]): void {
  const flows = read.map((r) => ({ comp: r.comp, ...flowOf(r.comp, r.ssr, r.children) }));
  const byName = new Map(read.map((r) => [r.comp.name, r.comp]));
  const passes = (name: string | null): boolean => (name !== null && byName.get(name)?.passesSlotIds) ?? false;
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of flows) {
      if (!f.comp.passesSlotIds && f.outlets.some((o) => o.passes === "id" || (o.passes === "forward" && passes(o.within)))) {
        f.comp.passesSlotIds = changed = true;
      }
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of flows) {
      for (const c of f.calls) {
        const child = byName.get(c.child);
        if (!child || child.inherits) continue;
        if (scopeIdOf(f.comp) !== null || (c.passesAttrs && f.comp.inherits && child.inheritAttrs) || passes(c.within)) {
          child.inherits = changed = true;
        }
      }
    }
  }
}

/** The scope ids a child's root is handed, as a Rust `&str` (`null` for none), as
 * `renderComponentSubTree` gathers them into its `attrs`: what this component passes on when the
 * child is its root, unless the child sets `inheritAttrs: false`; this component's own id, the id of
 * the instance that created the child's virtual node — slot content's included, which renders as
 * the component that wrote it; and the slot scope id of the slot content the child is rendered in. */
function childIds(s: Scope, child: Component, passesAttrs: boolean, inSlot: boolean, n: N): string | null {
  const base = passesAttrs && child.inheritAttrs ? s.attrs : null;
  const own = scopeIdOf(s.comp);
  const slotted = inSlot ? s.sid : null;
  let code: string | null;
  if (base === null && slotted === null) code = own === null ? null : rustStr(` ${own}`);
  else if (own === null && slotted === null) code = base;
  else code = `&fv::scope_attrs(${base ?? '""'}, ${own === null ? '""' : rustStr(own)}, ${slotted ?? '""'})`;
  if (code !== null && !child.inherits) fail(s.comp, `${child.name} is handed scope ids its render does not take`, n);
  return code;
}

/** Scoped styles: \`<style scoped>\` and \`:slotted()\`, and the ids they hand on. */
export const scoped: Plugin<ScopedRun> = {
  name: "scoped",
  configure: (config, root) => ({
    mode: config.scopeId ?? "filepath-source",
    viteRoot: resolvePath(root, config.viteRoot ?? "."),
    ids: new Map(),
    slotted: new Set(),
  }),
  sfc(comp, descriptor, file, source) {
    // A scoped `<style>` adds `data-v-…` attributes, whose id is computed here as the bundler
    // computes it.
    const run = runOf(scoped);
    if (descriptor.styles.some((st) => st.scoped)) run.ids.set(comp, `data-v-${scopeHash(file, source)}`);
    if (descriptor.slotted) run.slotted.add(comp);
  },
  // As `@vitejs/plugin-vue` compiles it: the scope id written onto every element, and passed to
  // slot content only with `:slotted()` styles.
  templateOptions(comp) {
    const id = scopeIdOf(comp);
    return { id: id ?? comp.name, scoped: id !== null, slotted: runOf(scoped).slotted.has(comp) };
  },
  analyse: (read) => scopeFlow(read),
  childIds,
};
