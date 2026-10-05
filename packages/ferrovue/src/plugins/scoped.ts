import { parse as parseJs } from "@babel/parser";
import { createHash } from "node:crypto";
import { relative, resolve as resolvePath, sep } from "node:path";
import { type Component, type N, type Scope, fail, rustStr } from "../model.ts";
import { type ScopeIdMode } from "../context.ts";
import { type Plugin, runOf } from "../plugin.ts";

interface ScopedRun {
  mode: ScopeIdMode;
  viteRoot: string;
  ids: Map<Component, string>;
  slotted: Set<Component>;
}

export function scopeIdOf(comp: Component): string | null {
  return runOf(scoped).ids.get(comp) ?? null;
}

function scopeHash(file: string, source: string): string {
  const { mode, viteRoot } = runOf(scoped);
  const path = relative(viteRoot, resolvePath(file)).split(sep).join("/");
  return createHash("sha256")
    .update(mode === "filepath" ? path : path + source)
    .digest("hex")
    .slice(0, 8);
}

interface Call {
  child: string;
  passesAttrs: boolean;
  within: string | null;
}

interface Outlet {
  passes: "id" | "forward" | "none";
  within: string | null;
}

function flowOf(comp: Component, ssr: string, children: Map<string, string>): { calls: Call[]; outlets: Outlet[] } {
  const calls: Call[] = [];
  const outlets: Outlet[] = [];
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

function childIds(s: Scope, child: Component, passesAttrs: boolean, inSlot: boolean, n: N): string | null {
  const base = passesAttrs && child.inheritAttrs ? s.attrs : null;
  const own = scopeIdOf(s.comp);
  const slotted = inSlot ? s.sid : null;
  let code: string | null;
  if (base === null && slotted === null) code = own === null ? null : rustStr(` ${own}`);
  else if (own === null && slotted === null) code = base;
  else code = `&fv::scope_attrs(${base ?? '""'}, ${own === null ? '""' : rustStr(own)}, ${slotted ?? '""'})`;
  if (code !== null && !child.inherits) fail(s.comp, "FV1012", `${child.name} is handed scope ids its render does not take`, n);
  return code;
}

export const scoped: Plugin<ScopedRun> = {
  name: "scoped",
  configure: (config, root) => ({
    mode: config.scopeId ?? "filepath-source",
    viteRoot: resolvePath(root, config.viteRoot ?? "."),
    ids: new Map(),
    slotted: new Set(),
  }),
  sfc(comp, descriptor, file, source) {
    const run = runOf(scoped);
    if (descriptor.styles.some((st) => st.scoped)) run.ids.set(comp, `data-v-${scopeHash(file, source)}`);
    if (descriptor.slotted) run.slotted.add(comp);
  },
  templateOptions(comp) {
    const id = scopeIdOf(comp);
    return { id: id ?? comp.name, scoped: id !== null, slotted: runOf(scoped).slotted.has(comp) };
  },
  analyse: (read) => scopeFlow(read),
  childIds,
};
