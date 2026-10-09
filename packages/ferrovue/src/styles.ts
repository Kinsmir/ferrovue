import { escapeHtml, hyphenate, parseStringStyle } from "@vue/shared";
import { type Component, type N, type Scope, type Val, fail, nothing, rustStr } from "./model.ts";
import { describeTy, expr } from "./expr.ts";
import { cond, known } from "./narrowing.ts";
import { condition, logical, not, receiver, strArg } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { display, valueAttr } from "./attrs.ts";
import { isTemporary } from "./strings.ts";

/** Put the object Vue's server compiler declares as `_cssVars`, the `v-bind()` variables in
 * `<style>`, in place of each use of it in the compiled template's statements, with each value
 * marked to be written as `ssrRenderStyle` writes a variable. */
export function inlineCssVars(comp: Component, body: N[]): N[] {
  const at = body.findIndex((st) => st.type === "VariableDeclaration" && st.declarations[0]?.id?.name === "_cssVars");
  if (at < 0) return body;
  const vars: N[] = body[at].declarations[0].init.properties[0].value.properties;
  const place = (n: N, where: N): N => {
    if (Array.isArray(n)) return n.map((x) => place(x, where));
    if (!n || typeof n !== "object") return n;
    const copy: N = {};
    for (const [k, v] of Object.entries(n)) copy[k] = k === "loc" ? where.loc : place(v, where);
    if (typeof n.type === "string") copy.__fv = "source";
    return copy;
  };
  const object = (): N => ({
    type: "ObjectExpression",
    properties: [{
      type: "ObjectProperty",
      computed: false,
      key: { type: "Identifier", name: "style" },
      value: {
        type: "ObjectExpression",
        properties: vars.map((p, i) => {
          const where = comp.cssVarsAt?.[i] ?? p;
          return {
            type: "ObjectProperty",
            computed: false,
            key: { type: "StringLiteral", value: String(p.key.value).replace(/^:/, "") },
            value: { type: "FvCssVar", value: place(p.value, where), loc: where.loc, __fv: where.__fv },
          };
        }),
      },
    }],
  });
  const swap = (n: N): void => {
    if (!n || typeof n !== "object") return;
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc") continue;
      if (Array.isArray(v)) {
        v.forEach((x, i) => {
          if (x?.type === "Identifier" && x.name === "_cssVars") v[i] = object();
          else swap(x);
        });
      } else if (v && typeof v === "object") {
        if ((v as N).type === "Identifier" && (v as N).name === "_cssVars") n[k] = object();
        else swap(v);
      }
    }
  };
  const rest = body.filter((_, i) => i !== at);
  swap(rest);
  return rest;
}

function cssVarOf(s: Scope, n: N): Val {
  const v = expr(s, n.value);
  const of = v.ty.k === "opt" ? v.ty.of : v.ty;
  if (!nothing(v.ty) && of.k !== "str" && of.k !== "int" && of.k !== "float") {
    fail(s.comp, "FV1006", `\`v-bind()\` in \`<style>\` of ${describeTy(of)}: Vue writes a string or a number, and warns of anything else`, n);
  }
  return v;
}

function writeCssVar(s: Scope, e: Emitter, css: string, n: N): void {
  const one = (v: Val): void => {
    if (nothing(v.ty)) {
      e.lit(`${escapeHtml(css)}:initial;`);
      return;
    }
    if (v.ty.k === "opt") {
      e.open(`if let Some(v) = ${v.code}`);
      one({ code: "v", ty: v.ty.of });
      e.close(" else {");
      e.lit(`${escapeHtml(css)}:initial;`);
      e.close();
      return;
    }
    e.lit(`${escapeHtml(css)}:`);
    const k = v.ty.k === "str" ? known(v) : true;
    if (k === false) e.lit(" ");
    else if (k === undefined && isTemporary(v)) e.stmt(`match AsRef::<str>::as_ref(${strArg(v.code)}) { "" => out.push(' '), v => fv::escape_into(out, v) }`);
    else if (k === undefined) {
      e.open(`if ${receiver(v.code)}.is_empty()`);
      e.lit(" ");
      e.close(" else {");
      display(e, v);
      e.close();
    } else display(e, v);
    e.lit(";");
  };
  one(cssVarOf(s, n));
}

function cssVarAttr(s: Scope, n: N): string {
  const one = (v: Val): string => {
    if (nothing(v.ty)) return 'fv::Attr::str("initial")';
    if (v.ty.k === "opt") return `match ${v.code} { Some(v) => ${one({ code: "v", ty: v.ty.of })}, None => fv::Attr::str("initial") }`;
    const k = v.ty.k === "str" ? known(v) : true;
    if (k === false) return 'fv::Attr::str(" ")';
    if (k === undefined) return `if ${receiver(v.code)}.is_empty() { fv::Attr::str(" ") } else { ${valueAttr(s, v, n)} }`;
    return valueAttr(s, v, n);
  };
  return one(cssVarOf(s, n));
}

export function mergedStyle(s: Scope, e: Emitter, n: N): void {
  if (n.type === "StringLiteral") {
    renderStyle(s, e, { type: "ArrayExpression", elements: [n] });
    return;
  }
  if (n.fvMerged || ["ObjectExpression", "ArrayExpression", "ConditionalExpression", "LogicalExpression", "NullLiteral"].includes(n.type)) {
    renderStyle(s, e, n);
    return;
  }
  const v = expr(s, n);
  if (v.ty.k === "str") e.stmt(`fv::style_text_into(out, ${strArg(v.code)});`);
  else if (v.ty.k === "opt" && v.ty.of.k === "str") {
    e.open(`if let Some(v) = ${v.code}`);
    e.stmt("fv::style_text_into(out, v);");
    e.close();
  } else if (!nothing(v.ty)) fail(s.comp, "FV1007", "a style binding is a string, an object or an array", n);
}

export function styleAttr(s: Scope, n: N): string {
  switch (n.type) {
    case "StringLiteral":
      return `fv::Attr::str(${rustStr(n.value)})`;
    case "NullLiteral":
      return "fv::Attr::Undefined";
    case "ObjectExpression": {
      const entries = n.properties.map((p: N) => {
        if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "FV1008", "a style object holds plain `property: value` pairs", p);
        const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
        if (/^\d+$/.test(key) || key.startsWith(":")) fail(s.comp, "FV1009", `style property \`${key}\``, p);
        return `(${rustStr(key)}, ${p.value.type === "FvCssVar" ? cssVarAttr(s, p.value) : valueAttr(s, expr(s, p.value), p.value)})`;
      });
      return `fv::Attr::style([${entries.join(", ")}])`;
    }
    case "ArrayExpression":
      return `fv::Attr::styles([${n.elements.map((el: N) => (el ? styleAttr(s, el) : "fv::Attr::Undefined")).join(", ")}])`;
    case "LogicalExpression":
      if (n.operator === "&&") return `if ${condition(cond(s, n.left))} { ${styleAttr(s, n.right)} } else { fv::Attr::Undefined }`;
      break;
    case "ConditionalExpression":
      return `if ${condition(cond(s, n.test))} { ${styleAttr(s, n.consequent)} } else { ${styleAttr(s, n.alternate)} }`;
  }
  const v = expr(s, n);
  if (v.ty.k === "str" || nothing(v.ty) || (v.ty.k === "opt" && v.ty.of.k === "str")) return valueAttr(s, v, n);
  return fail(s.comp, "FV1007", "a style binding is a string, an object or an array", n);
}

export interface StyleItem {
  cond: string | null;
  entries: { key: string; css: string; value: N }[];
}

export function styleItems(s: Scope, n: N, when: string | null): StyleItem[] {
  if (when === "false") return [];
  if (when === "true") when = null;
  const both = (a: string | null, b: string) => (a === null ? b : logical(a, "&&", b));
  switch (n.type) {
    case "NullLiteral":
      return [];
    case "ArrayExpression":
      return n.elements.flatMap((el: N) => (el ? styleItems(s, el, when) : []));
    case "StringLiteral":
      return [{ cond: when, entries: Object.entries(parseStringStyle(n.value)).map(([key, v]) => ({ key, css: key, value: { type: "StringLiteral", value: v } })) }];
    case "ConditionalExpression": {
      const t = cond(s, n.test);
      return [...styleItems(s, n.consequent, both(when, t)), ...styleItems(s, n.alternate, both(when, not(t)))];
    }
    case "LogicalExpression":
      if (n.operator === "&&") return styleItems(s, n.right, both(when, cond(s, n.left)));
      break;
    case "ObjectExpression":
      return [{
        cond: when,
        entries: n.properties.map((p: N) => {
          if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "FV1008", "a style object holds plain `property: value` pairs", p);
          const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
          if (/^\d+$/.test(key) || key.startsWith(":")) fail(s.comp, "FV1009", `style property \`${key}\``, p);
          return { key, css: key.startsWith("--") ? key : hyphenate(key), value: p.value };
        }),
      }];
  }
  return fail(s.comp, "FV1010", "a style binding is an object, an array of objects, or a string on its own", n);
}

export function renderStyle(s: Scope, e: Emitter, n: N): void {
  if (n.type === "StringLiteral") {
    e.lit(escapeHtml(n.value));
    return;
  }
  if (n.type !== "ObjectExpression" && n.type !== "ArrayExpression" && n.type !== "ConditionalExpression" && n.type !== "LogicalExpression" && n.type !== "NullLiteral") {
    const v = expr(s, n);
    if (v.ty.k === "str") e.stmt(`fv::escape_into(out, ${strArg(v.code)});`);
    else if (v.ty.k === "opt" && v.ty.of.k === "str") {
      e.open(`if let Some(v) = ${v.code}`);
      e.stmt("fv::escape_into(out, v);");
      e.close();
    } else if (!nothing(v.ty)) fail(s.comp, "FV1007", "a style binding is a string, an object or an array", n);
    return;
  }
  const items = styleItems(s, n, null);
  const order: string[] = [];
  const sets = new Map<string, { cond: string | null; css: string; value: N }[]>();
  for (const it of items) {
    for (const en of it.entries) {
      if (!sets.has(en.key)) {
        order.push(en.key);
        sets.set(en.key, []);
      }
      sets.get(en.key)!.push({ cond: it.cond, css: en.css, value: en.value });
    }
  }
  const write = (css: string, value: N): void => {
    if (value.type === "FvCssVar") {
      writeCssVar(s, e, css, value);
      return;
    }
    if (value.type === "StringLiteral" || value.type === "NumericLiteral") {
      e.lit(escapeHtml(`${css}:${String(value.value)};`));
      return;
    }
    const v = expr(s, value);
    const one = (w: Val): void => {
      if (w.ty.k === "str" || w.ty.k === "int" || w.ty.k === "float") {
        e.lit(`${escapeHtml(css)}:`);
        display(e, w);
        e.lit(";");
      } else if (w.ty.k === "opt") {
        e.open(`if let Some(v) = ${w.code}`);
        one({ code: "v", ty: w.ty.of });
        e.close();
      }
    };
    one(v);
  };
  const flat = items.flatMap((it, i) => it.entries.map((en) => ({ key: en.key, item: i, cond: it.cond })));
  for (const key of order) {
    const at = flat.filter((f) => f.key === key);
    if (at.length < 2 || at[0]!.cond === null) continue;
    const first = flat.indexOf(at[0]!);
    const again = flat.indexOf(at[at.length - 1]!);
    const between = flat.slice(first + 1, again).some((f) => order.indexOf(f.key) > order.indexOf(key));
    if (between) fail(s.comp, "FV1011", `the place of style property \`${key}\` would depend on a condition; set it unconditionally first`, n);
  }
  for (const key of order) {
    const chain: { cond: string | null; css: string; value: N }[] = [];
    for (const set of sets.get(key)!.toReversed()) {
      chain.push(set);
      if (set.cond === null) break;
    }
    if (chain.length === 1 && chain[0]!.cond === null) {
      write(chain[0]!.css, chain[0]!.value);
      continue;
    }
    chain.forEach((set, i) => {
      if (set.cond === null) {
        e.close(" else {");
      } else if (i === 0) {
        e.open(`if ${condition(set.cond)}`);
      } else {
        e.close(` else if ${condition(set.cond)} {`);
      }
      write(set.css, set.value);
    });
    e.close();
  }
}
