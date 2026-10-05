import { parse as parseJs } from "@babel/parser";
import { type Component, type N, fail } from "../model.ts";
import { isAttrs } from "../attrs.ts";
import { slotContent } from "../slots.ts";
import { statements } from "../template.ts";
import { type Plugin, runOf } from "../plugin.ts";

export const CLIENT_MODULES = new Set(["ferrovue", "ferrovue/client"]);

interface ClientOnlyRun {
  locals: Map<Component, Set<string>>;
  outside: Map<Component, Set<string>>;
}

function setupName(target: N): string | null {
  if (target?.type !== "MemberExpression" || target.object.type !== "Identifier" || target.object.name !== "$setup") return null;
  return target.computed ? (target.property.value ?? null) : target.property.name;
}

function clientOnlyLocals(script: N[]): Set<string> {
  const locals = new Set<string>();
  for (const st of script) {
    if (st.type !== "ImportDeclaration" || !CLIENT_MODULES.has(st.source.value) || st.importKind === "type") continue;
    for (const sp of st.specifiers) {
      if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "ClientOnly") locals.add(sp.local.name);
    }
  }
  return locals;
}

function namesOutside(code: string, locals: Set<string>): Set<string> {
  const names = new Set<string>();
  const walk = (n: N): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (n.type === "Identifier") names.add(n.name);
    if (n.type === "VariableDeclarator") {
      walk(n.init);
      return;
    }
    if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_ssrRenderComponent" && locals.has(setupName(n.arguments[0]) ?? "")) {
      const [, props, slots, ...rest] = n.arguments;
      walk([props, rest]);
      if (slots?.type === "ObjectExpression") {
        for (const p of slots.properties) if ((p.key?.name ?? p.key?.value) !== "default") walk(p);
      } else walk(slots);
      return;
    }
    for (const [key, v] of Object.entries(n)) if (key !== "loc" && key !== "start" && key !== "end") walk(v);
  };
  walk(parseJs(code, { sourceType: "module" }).program);
  return names;
}

export const clientOnly: Plugin<ClientOnlyRun> = {
  name: "client-only",
  configure: () => ({ locals: new Map(), outside: new Map() }),
  compiled(comp, code, script) {
    const locals = clientOnlyLocals(script);
    if (!locals.size) return;
    const run = runOf(clientOnly);
    run.locals.set(comp, locals);
    run.outside.set(comp, namesOutside(code, locals));
  },
  resolveComponent(s, local) {
    const outside = runOf(clientOnly).outside.get(s.comp);
    return outside !== undefined && !outside.has(local);
  },
  component(s, e, n) {
    if (!runOf(clientOnly).locals.get(s.comp)?.has(setupName(n.arguments[0]) ?? "")) return false;
    const [, props, slots] = n.arguments;
    if (props && props.type !== "NullLiteral" && !isAttrs(props)) {
      fail(s.comp, "`<ClientOnly>` takes no attributes: the server renders none of them; put them on an element inside it", props);
    }
    let fallback: N = null;
    if (slots && slots.type !== "NullLiteral") {
      if (slots.type !== "ObjectExpression") fail(s.comp, "unexpected `<ClientOnly>` content", slots);
      for (const p of slots.properties) {
        const key: string | undefined = p.key?.name ?? p.key?.value;
        if (key === "_" || key === "default") continue;
        if (key !== "fallback" || p.type !== "ObjectProperty" || p.computed) fail(s.comp, "`<ClientOnly>` has a default slot and a `#fallback` slot, and no other", p);
        fallback = p.value;
      }
    }
    if (fallback === null) {
      e.lit("<!---->");
      return true;
    }
    const { body, param } = slotContent(s, fallback);
    if (param && !(param.type === "Identifier" && param.name === "_")) fail(s.comp, "`<ClientOnly>`'s `#fallback` passes no props", param);
    e.lit("<!--[-->");
    statements({ ...s, fill: false, vnode: false, sid: null }, e, body);
    e.lit("<!--]-->");
    return true;
  },
};
