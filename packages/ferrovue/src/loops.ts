import { type N, type Scope, type Ty, type Val, fail, INT, STR } from "./model.ts";
import { enumItemVal } from "./enums.ts";
import { fresh, jsHint } from "./names.ts";
import { expr, fieldVal } from "./expr.ts";
import { isObjectCall } from "./calls.ts";
import { atom, operand, OR } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { statements } from "./template.ts";
import { unbound } from "./narrowing.ts";
import { bindEntry } from "./lists.ts";

export function list(s: Scope, e: Emitter, c: N): void {
  const fn = c.arguments[1];
  if (fn.type !== "ArrowFunctionExpression" || fn.body.type !== "BlockStatement") {
    fail(s.comp, "FV0006", "unexpected `ssrRenderList` callback", c);
  }
  if (isObjectCall(c.arguments[0], "entries")) {
    const [pair, index] = fn.params as N[];
    const r = c.arguments[0].arguments.length === 1 ? expr(s, c.arguments[0].arguments[0]) : null;
    if (r?.ty.k !== "record") return fail(s.comp, "FV0814", "`Object.entries()` takes a `Record<string, T>`", c.arguments[0]);
    if (pair?.type !== "ArrayPattern" || pair.elements.length > 2 || pair.elements.some((x: N) => x?.type !== "Identifier")) {
      return fail(s.comp, "FV0818", "a `v-for` over `Object.entries()` names its items `[key, value]`", pair ?? c);
    }
    recordLoop(s, e, r, fn, pair.elements[1], pair.elements[0], index);
    return;
  }
  const src = expr(s, c.arguments[0]);
  if (src.ty.k === "record") {
    const [value, key, index] = fn.params as N[];
    recordLoop(s, e, src, fn, value, key, index);
    return;
  }
  const [item, index] = fn.params as N[];
  const idx = index ? fresh("i", jsHint(index.name)) : null;
  const itemHint = item.type === "Identifier" ? jsHint(item.name) : "item";
  const itemName = item.type === "Identifier" ? fresh("a", itemHint) : fresh("item", itemHint);
  const inner = new Map(s.locals);
  let of: Ty;
  let walk: string;
  let bound: string;
  let itemLet = -1;
  let itemOf: Val | undefined;
  const loop = (it: string, i: string | null) => (i ? `for (${i}, ${it}) in ${atom(walk)}.enumerate()` : `for ${it} in ${walk}`);
  if (src.ty.k === "list" && src.enums !== undefined) {
    of = src.ty.of;
    const itemCode = fresh("a", `${itemHint}_ref`);
    walk = `${atom(src.enums.place)}.iter()`;
    bound = itemCode;
    e.open(loop(bound, idx));
    e.stmt(`let ${itemName} = *${itemCode};`);
    itemLet = e.lines.length - 1;
    itemOf = enumItemVal(itemName, of, src.enums.def);
  } else if (src.ty.k === "list" && src.iter !== undefined) {
    of = src.ty.of;
    walk = src.iter;
    bound = of.k === "str" ? fresh("a", `${itemHint}_cow`) : itemName;
    e.open(loop(bound, idx));
    if (of.k === "str") {
      e.stmt(`let ${itemName}: &str = &${bound};`);
      itemLet = e.lines.length - 1;
    }
  } else if (src.ty.k === "int") {
    of = INT;
    walk = `1..=${operand(src.code, OR)}`;
    bound = itemName;
    e.open(loop(bound, idx));
  } else if (src.ty.k === "list") {
    of = src.ty.of;
    if (of.k === "undef") fail(s.comp, "FV0819", "`v-for` over an empty array literal", c);
    const itemCode = fresh("a", `${itemHint}_ref`);
    walk = `${atom(src.code)}.iter()`;
    bound = itemCode;
    e.open(loop(bound, idx));
    if (of.k === "str") e.stmt(`let ${itemName}: &str = ${itemCode};`);
    else if (of.k === "struct" || of.k === "child") e.stmt(`let ${itemName} = ${itemCode};`);
    else if (of.k === "opt" && of.of.k === "str") e.stmt(`let ${itemName} = ${itemCode}.as_deref();`);
    else if (of.k === "opt" && !["int", "float", "bool", "date"].includes(of.of.k)) e.stmt(`let ${itemName} = ${itemCode}.as_ref();`);
    else e.stmt(`let ${itemName} = *${itemCode};`);
    itemLet = e.lines.length - 1;
  } else {
    return fail(s.comp, "FV0820", "`v-for` walks an array, or counts to a number", c);
  }
  let idxLet = -1;
  if (idx) {
    e.stmt(`let ${idx} = ${idx} as i64;`);
    idxLet = e.lines.length - 1;
  }
  const bodyFrom = e.lines.length;
  if (item.type === "Identifier") inner.set(item.name, itemOf ?? { code: itemName, ty: of, ...(src.lone ? { lone: true } : {}) });
  else if (item.type === "ObjectPattern") {
    for (const p of item.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
        fail(s.comp, "FV0821", "a destructured `v-for` item binds plain names, without defaults", p);
      }
      inner.set(p.value.name, fieldVal(s.comp, itemName, of, p.key.name ?? p.key.value, p));
    }
  } else if (item.type === "ArrayPattern" && of.k === "entry") bindEntry(s.comp, item, { code: itemName, ty: of, ...(src.lone ? { lone: true } : {}) }, inner, [], "FV0818");
  else fail(s.comp, "FV0822", `a \`v-for\` item is a name or ${of.k === "entry" ? "an array pattern of a `[key, value]` pair" : "an object pattern"}`, item);
  if (index) inner.set(index.name, { code: idx!, ty: INT });
  const before = e.literalBytes;
  const over = src.enums?.place ?? src.code;
  const fromProps = src.ty.k === "list" && (src.iter === undefined || src.enums !== undefined) && /^\(?props\./.test(over);
  statements({ ...s, locals: inner, narrowed: rebound(s, inner), loop: fromProps ? { item: itemName, over } : undefined }, e, fn.body.body);
  const unusedItem = !e.reads(itemName, bodyFrom);
  const unusedIdx = idx !== null && !e.reads(idx, bodyFrom);
  const head = bodyFrom - 1 - (idx ? 1 : 0) - (itemLet >= 0 ? 1 : 0);
  e.replace(head, loop(bound, idx), loop(unusedItem ? "_" : bound, unusedIdx ? null : idx));
  if (unusedIdx) e.lines.splice(idxLet, 1);
  if (unusedItem && itemLet >= 0) e.lines.splice(itemLet, 1);
  e.close();
  const body = e.literalBytes - before;
  e.literalBytes = before;
  if (body > 0 && fromProps) e.perItem.push(`${body === 1 ? "" : `${body} * `}${atom(over)}.len()`);
  else if (body > 0 && src.ty.k === "list" && s.loop && src.iter === undefined && new RegExp(`^${s.loop.item}(?:\\.\\w+)+$`).test(src.code)) {
    const outer = s.loop;
    e.perItem.push(`${body === 1 ? "" : `${body} * `}${atom(outer.over)}.iter().map(|${outer.item}| ${src.code}.len()).sum::<usize>()`);
  }
}

function recordLoop(s: Scope, e: Emitter, r: Val, fn: N, value: N | undefined, key: N | undefined, index: N | undefined): void {
  if (r.ty.k !== "record") return;
  const of = r.ty.of;
  for (const p of [key, index]) if (p && p.type !== "Identifier") fail(s.comp, "FV0823", "a record's key and index in `v-for` are plain names", p);
  const vHint = value?.type === "Identifier" ? jsHint(value.name) : "value";
  const v = fresh(value?.type === "Identifier" ? "a" : "value", vHint);
  const vRef = fresh("a", `${vHint}_ref`);
  const k = key ? fresh("a", jsHint(key.name)) : fresh("key", "key");
  const i = index ? fresh("i", jsHint(index.name)) : fresh("index", "index");
  e.open(`for (${i}, (${k}, ${vRef})) in ${atom(r.code)}.iter().enumerate()`);
  const head = e.lines.length - 1;
  const indent = /^ */.exec(e.lines[head]!)![0];
  const inner = new Map(s.locals);
  e.stmt(of.k === "str" ? `let ${v}: &str = ${vRef};` : of.k === "int" || of.k === "float" || of.k === "bool" ? `let ${v} = *${vRef};` : of.k === "date" ? `let ${v} = fv::js_date::js_time_of(${vRef});` : `let ${v} = ${vRef};`);
  e.stmt(`let ${i} = ${i} as i64;`);
  const bodyFrom = e.lines.length;
  if (value?.type === "Identifier") inner.set(value.name, { code: v, ty: of });
  else if (value?.type === "ObjectPattern" && (of.k === "struct" || of.k === "child")) {
    for (const p of value.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
        fail(s.comp, "FV0821", "a destructured `v-for` item binds plain names, without defaults", p);
      }
      inner.set(p.value.name, fieldVal(s.comp, v, of, p.key.name ?? p.key.value, p));
    }
  } else if (value) fail(s.comp, "FV0822", "a `v-for` item is a name, or an object pattern of an object", value);
  if (key) inner.set(key.name, { code: k, ty: STR });
  if (index) inner.set(index.name, { code: i, ty: INT });
  const before = e.literalBytes;
  statements({ ...s, locals: inner, narrowed: rebound(s, inner) }, e, fn.body.body);
  const reads = (name: string) => e.reads(name, bodyFrom);
  const [readsV, readsK, readsI] = [reads(v), reads(k), reads(i)];
  if (!readsI) e.lines.splice(head + 2, 1);
  if (!readsV) e.lines.splice(head + 1, 1);
  const pair = `(${readsK ? k : "_"}, ${readsV ? vRef : "_"})`;
  e.lines[head] = `${indent}for ${readsI ? `(${i}, ${pair}) in ${atom(r.code)}.iter().enumerate()` : `${pair} in ${atom(r.code)}.iter()`} {`;
  e.close();
  const body = e.literalBytes - before;
  e.literalBytes = before;
  if (body > 0 && /^\(?props\./.test(r.code)) e.perItem.push(`${body === 1 ? "" : `${body} * `}${atom(r.code)}.len()`);
}

function rebound(s: Scope, inner: Map<string, Val>): Map<string, Val> {
  return unbound(s.narrowed, [...inner.keys()].filter((k) => inner.get(k) !== s.locals.get(k)));
}
