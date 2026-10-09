import { parse as parseJs } from "@babel/parser";
import { type Component, type N, declares } from "./model.ts";

interface AttrsCall {
  child: string;
  keys: string[];
  passesAttrs: boolean;
  passesDollar: boolean;
}

export function isDollarAttrs(n: N, bindings: Set<string>): boolean {
  if (n?.type !== "MemberExpression" || n.object.type !== "Identifier") return false;
  const prop: string | undefined = n.computed ? n.property.value : n.property.name;
  if (n.object.name === "_ctx") return prop === "$attrs";
  return n.object.name === "$setup" && prop !== undefined && bindings.has(prop);
}

export function passedKey(child: Component, key: string): boolean {
  if (["", "key", "ref", "ref_for", "ref_key", "innerHTML", "textContent"].includes(key)) return false;
  if (isListener(key)) return declares(child, key);
  return !(key.endsWith("Modifiers") && declares(child, key === "modelModifiers" ? "modelValue" : key.slice(0, -"Modifiers".length)));
}

export function isListener(key: string): boolean {
  return /^on[^a-z]/.test(key);
}

export function attrsFlow(read: { comp: Component; ssr: string; children: Map<string, string>; attrsBindings: Set<string> }[]): void {
  const byName = new Map(read.map((r) => [r.comp.name, r.comp]));
  const flows = read.map((r) => {
    const calls: AttrsCall[] = [];
    const self = new Set<string>();
    const walk = (n: N): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        n.forEach(walk);
        return;
      }
      if (n.type === "VariableDeclarator" && n.init?.type === "CallExpression" && n.init.callee.name === "_resolveComponent") {
        if (n.init.arguments[0]?.value === r.comp.name && n.init.arguments[1]) self.add(n.id.name);
      }
      if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_ssrRenderComponent") {
        const target = n.arguments[0];
        const child =
          target?.type === "MemberExpression" && target.object.name === "$setup"
            ? r.children.get(target.computed ? target.property.value : target.property.name)
            : target?.type === "Identifier" && self.has(target.name)
              ? r.comp.name
              : undefined;
        const props = n.arguments[1];
        const parts: N[] = props?.type === "CallExpression" && props.callee.name === "_mergeProps" ? props.arguments : props ? [props] : [];
        if (child) {
          calls.push({
            child,
            keys: [
              ...parts.filter((p) => p.type === "ObjectExpression").flatMap((p) => p.properties.filter((q: N) => q.type === "ObjectProperty" && !q.computed).map((q: N): string => q.key.name ?? String(q.key.value))),
              ...(parts.some((p) => p.type === "Identifier" && p.name === "_cssVars") ? ["style"] : []),
            ],
            passesAttrs: parts.some((p) => p.type === "Identifier" && p.name === "_attrs"),
            passesDollar: parts.some((p) => isDollarAttrs(p, r.attrsBindings)),
          });
        }
      }
      for (const [key, v] of Object.entries(n)) if (key !== "loc" && key !== "start" && key !== "end") walk(v);
    };
    walk(parseJs(r.ssr, { sourceType: "module" }).program);
    return { comp: r.comp, calls };
  });
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of flows) {
      for (const c of f.calls) {
        const child = byName.get(c.child);
        if (!child) continue;
        const names = c.keys.filter((k) => passedKey(child, k));
        if ((c.passesAttrs && f.comp.inheritAttrs) || c.passesDollar) names.push(...f.comp.attrNames);
        for (const name of names) {
          if (declares(child, name) || child.attrNames.has(name)) continue;
          child.attrNames.add(name);
          changed = true;
        }
        if (c.passesAttrs && f.comp.inherits && !child.idsInAttrs) child.idsInAttrs = changed = true;
      }
    }
  }
}
