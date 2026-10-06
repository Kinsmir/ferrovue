import { escapeHtml } from "@vue/shared";
import { type N, type Scope, type Val, directiveOwner, fail, nothing, rustStr, STR } from "./model.ts";
import { expr } from "./expr.ts";
import { cond, known, truthy } from "./narrowing.ts";
import { meet } from "./strings.ts";
import { atom, bare, condition, logical, not, strArg } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { valueAttr } from "./attrs.ts";

export type ClassItem = { lit: string } | { code: string };

export function classItems(s: Scope, n: N): ClassItem[] {
  switch (n.type) {
    case "StringLiteral": {
      const t = n.value.trim();
      return t ? [{ lit: t }] : [];
    }
    case "ArrayExpression":
      return n.elements.flatMap((el: N) => (el ? classItems(s, el) : []));
    case "ObjectExpression":
      const literalNames = n.properties
        .filter((p: N) => p.type === "ObjectProperty" && !p.computed)
        .map((p: N) => (p.key.type === "Identifier" ? p.key.name : String(p.key.value)));
      const arrayIndex = (k: string) => /^(0|[1-9]\d*)$/.test(k) && Number(k) < 2 ** 32 - 1;
      if (
        n.properties.some((p: N) => p.type === "ObjectProperty" && p.computed) ||
        literalNames.some(arrayIndex) ||
        new Set(literalNames).size !== literalNames.length
      ) {
        const keys: Val[] = [];
        const entries = n.properties.map((p: N) => {
          if (p.type !== "ObjectProperty") fail(s.comp, "FV1001", "a class object holds `name: condition` pairs", p);
          const key: Val = p.computed ? expr(s, p.key) : { code: rustStr(p.key.type === "Identifier" ? p.key.name : String(p.key.value)), ty: STR };
          if (key.ty.k !== "str") fail(s.comp, "FV1002", "a computed class name is a string", p.key);
          for (const other of keys) meet(s.comp, other, key, "a class object's names", p.key, "equal");
          keys.push(key);
          return `(${bare(cond(s, p.value))}, ${bare(key.code)})`;
        });
        return [{ code: `&*fv::class_object(&[${entries.join(", ")}])` }];
      }
      return n.properties.flatMap((p: N): ClassItem[] => {
        if (p.type !== "ObjectProperty") fail(s.comp, "FV1001", "a class object holds `name: condition` pairs", p);
        let name: ClassItem;
        if (!p.computed) {
          const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
          if (key !== key.trim() || !key) fail(s.comp, "FV1003", `class name \`${key}\` has spaces around it`, p);
          name = { lit: key };
        } else {
          const k = expr(s, p.key);
          if (k.ty.k !== "str") fail(s.comp, "FV1002", "a computed class name is a string", p.key);
          name = { code: `fv::js_trim(${strArg(k.code)})` };
        }
        const v = expr(s, p.value);
        const on = known(v);
        if (on !== undefined) return on ? [name] : [];
        const text = "lit" in name ? rustStr(name.lit) : name.code;
        return [{ code: `if ${condition(truthy(v))} { ${bare(text)} } else { "" }` }];
      });
    case "LogicalExpression":
      if (n.operator === "&&") {
        return conditional(cond(s, n.left), classItems(s, n.right));
      }
      break;
    case "ConditionalExpression":
      if (n.consequent.type === "NullLiteral" || n.alternate.type === "NullLiteral") {
        const branch = n.consequent.type === "NullLiteral" ? n.alternate : n.consequent;
        const test = cond(s, n.test);
        return conditional(n.consequent.type === "NullLiteral" ? not(test) : test, classItems(s, branch));
      }
      break;
  }
  const v = expr(s, n);
  if (v.ty.k === "str") return [{ code: v.code }];
  if (v.ty.k === "opt" && v.ty.of.k === "str") return [{ code: `${atom(v.code)}.unwrap_or("")` }];
  if (nothing(v.ty)) return [];
  return fail(s.comp, "FV1004", "a class is a string, an array, or an object of conditions", n);
}

function conditional(test: string, items: ClassItem[]): ClassItem[] {
  if (test === "true" || test === "false") return test === "true" ? items : [];
  return items.map((it) => ({ code: `if ${condition(test)} { ${"lit" in it ? rustStr(it.lit) : bare(it.code)} } else { "" }` }));
}

export function renderClass(s: Scope, e: Emitter, n: N, after = false): void {
  const items = classItems(s, n);
  let wrote = after;
  let i = 0;
  for (; i < items.length; i++) {
    const it = items[i]!;
    if (!("lit" in it)) break;
    e.lit((wrote ? " " : "") + escapeHtml(it.lit));
    wrote = true;
  }
  if (i < items.length) {
    const rest = items.slice(i).map((it) => ("lit" in it ? rustStr(it.lit) : it.code));
    e.stmt(`fv::class_into(out, ${wrote}, &[${rest.join(", ")}]);`);
  }
}

const UNWRITTEN = new Set(["on", "if", "else-if", "else", "for", "slot", "once", "memo", "cloak", "pre"]);

/** The class list of an element in content Vue renders from virtual nodes, in the order Vue's
 * client compiler merges a static `class` written before `:class`: the static names first, at the
 * place of the static `class`. */
export function vnodeClass(s: Scope, n: N): N {
  const last = n.type === "ArrayExpression" ? n.elements.at(-1) : null;
  if (n.fvMerged || last?.type !== "StringLiteral" || n.elements.length < 2) return n;
  const el = directiveOwner(s.comp, n.elements[0]);
  if (!el) return n;
  const own = el.props.findIndex((p: N) => p.type === 6 && p.name === "class");
  const bound = el.props.findIndex((p: N) => p.type === 7 && p.name === "bind" && p.arg?.content === "class");
  if (own < 0 || bound < own) return n;
  const between = el.props.slice(own + 1, bound).find((p: N) => p.type === 6 || !UNWRITTEN.has(p.name));
  if (between) {
    const at = { type: "VueTemplate", loc: { start: { line: between.loc.start.line, column: between.loc.start.column - 1 } }, __fv: "source" };
    fail(s.comp, "FV1013", "in content Vue renders from virtual nodes, a `class` written before `:class` is written where the `class` stands, and Vue's server compiler moves it to where `:class` stands; write the two next to each other, or `:class` first", at);
  }
  return { ...n, elements: [last, ...n.elements.slice(0, -1)] };
}

export function classPresent(s: Scope, n: N): string {
  if (n.fvMerged) return n.elements.reduce((acc: string, el: N) => logical(acc, "||", classPresent(s, el)), "false");
  switch (n.type) {
    case "StringLiteral":
    case "NullLiteral":
    case "ArrayExpression":
    case "ObjectExpression":
      return "true";
    case "LogicalExpression":
      if (n.operator === "&&") return logical(not(cond(s, n.left)), "||", classPresent(s, n.right));
      break;
    case "ConditionalExpression":
      if (n.consequent.type === "NullLiteral") return logical(cond(s, n.test), "||", classPresent(s, n.alternate));
      if (n.alternate.type === "NullLiteral") return logical(not(cond(s, n.test)), "||", classPresent(s, n.consequent));
      break;
  }
  const v = expr(s, n);
  if (nothing(v.ty)) return "false";
  if (v.ty.k === "opt") return `${atom(v.code)}.is_some()`;
  return "true";
}

export function maybeEqual(s: Scope, n: N): boolean {
  if (n.type === "StringLiteral") return true;
  if (n.fvMerged || ["ArrayExpression", "ObjectExpression", "NullLiteral", "LogicalExpression", "ConditionalExpression"].includes(n.type)) return false;
  const v = expr(s, n);
  return v.ty.k === "str" || (v.ty.k === "opt" && v.ty.of.k === "str");
}

export function literalClass(n: N): string | null {
  if (n.type === "StringLiteral") return n.value.trim();
  if (!n.fvMerged) return null;
  const parts = n.elements.map(literalClass);
  return parts.includes(null) ? null : parts.filter(Boolean).join(" ");
}

export function classAttr(s: Scope, n: N, side: "vnode" | "own"): string {
  switch (n.type) {
    case "StringLiteral":
      return `fv::Attr::str(${rustStr(n.value)})`;
    case "NullLiteral":
      return 'fv::Attr::str("")';
    case "ArrayExpression":
    case "ObjectExpression": {
      const items = classItems(s, n);
      const names = items.every((it) => "lit" in it)
        ? rustStr(items.map((it) => ("lit" in it ? it.lit : "")).join(" "))
        : `fv::class_names(&[${items.map((it) => ("lit" in it ? rustStr(it.lit) : it.code)).join(", ")}])`;
      const literal = names.startsWith('"');
      if (side === "vnode") return literal ? `fv::Attr::str(${names})` : `fv::Attr::from(${names})`;
      return `fv::Attr::Names(${literal ? `std::borrow::Cow::Borrowed(${names})` : `${names}.into()`})`;
    }
    case "LogicalExpression":
      if (n.operator === "&&") return `if ${condition(cond(s, n.left))} { ${classAttr(s, n.right, side)} } else { fv::Attr::str("") }`;
      break;
    case "ConditionalExpression":
      return `if ${condition(cond(s, n.test))} { ${classAttr(s, n.consequent, side)} } else { ${classAttr(s, n.alternate, side)} }`;
  }
  const v = expr(s, n);
  if (v.ty.k === "str" || nothing(v.ty) || (v.ty.k === "opt" && v.ty.of.k === "str")) return valueAttr(s, v, n);
  return fail(s.comp, "FV1004", "a class is a string, an array, or an object of conditions", n);
}
