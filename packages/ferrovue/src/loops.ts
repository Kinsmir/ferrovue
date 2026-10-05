/* `v-for`: a loop over a list, a number or a record, its item and index bound as the template
 * names them, and its markup counted once per item. */

import { type N, type Scope, type Ty, type Val, fail, INT, snake, STR } from "./model.ts";
import { ctx } from "./context.ts";
import { expr, fieldVal } from "./expr.ts";
import { isObjectCall } from "./calls.ts";
import { atom, operand, OR } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { statements } from "./template.ts";

export function list(s: Scope, e: Emitter, c: N): void {
  const fn = c.arguments[1];
  if (fn.type !== "ArrowFunctionExpression" || fn.body.type !== "BlockStatement") {
    fail(s.comp, "unexpected `ssrRenderList` callback", c);
  }
  // `([key, value], i) in Object.entries(r)`, which walks the record as `(value, key, i) in r` does.
  if (isObjectCall(c.arguments[0], "entries")) {
    const [pair, index] = fn.params as N[];
    const r = c.arguments[0].arguments.length === 1 ? expr(s, c.arguments[0].arguments[0]) : null;
    if (r?.ty.k !== "record") return fail(s.comp, "`Object.entries()` takes a `Record<string, T>`", c.arguments[0]);
    if (pair?.type !== "ArrayPattern" || pair.elements.length > 2 || pair.elements.some((x: N) => x?.type !== "Identifier")) {
      return fail(s.comp, "a `v-for` over `Object.entries()` names its items `[key, value]`", pair ?? c);
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
  const idx = index ? snake(index.name) : null;
  // The item's name in Rust: its own when it is a plain name, a placeholder when it is destructured.
  const itemName = item.type === "Identifier" ? snake(item.name) : `fv_item${++ctx.narrowCount}`;
  const inner = new Map(s.locals);
  let of: Ty;
  // What the loop walks, and what its head binds each item to.
  let walk: string;
  let bound: string;
  let itemLet = -1;
  const loop = (it: string, i: string | null) => (i ? `for (${i}, ${it}) in ${atom(walk)}.enumerate()` : `for ${it} in ${walk}`);
  if (src.ty.k === "list" && src.iter !== undefined) {
    // A computed list: its items come as they are — a string as a `Cow`, read as a `&str`.
    of = src.ty.of;
    walk = src.iter;
    bound = of.k === "str" ? `${itemName}_cow` : itemName;
    e.open(loop(bound, idx));
    if (of.k === "str") {
      e.stmt(`let ${itemName}: &str = &${bound};`);
      itemLet = e.lines.length - 1;
    }
  } else if (src.ty.k === "int") {
    // `v-for="n in 5"`: 1 to 5, as `renderList` counts a number.
    of = INT;
    walk = `1..=${operand(src.code, OR)}`;
    bound = itemName;
    e.open(loop(bound, idx));
  } else if (src.ty.k === "list") {
    of = src.ty.of;
    if (of.k === "undef") fail(s.comp, "`v-for` over an empty array literal", c);
    const itemCode = `${itemName}_ref`;
    walk = `${atom(src.code)}.iter()`;
    bound = itemCode;
    e.open(loop(bound, idx));
    if (of.k === "str") e.stmt(`let ${itemName}: &str = ${itemCode};`);
    // An object — a struct, or another component's props — is borrowed; only a scalar is copied.
    else if (of.k === "struct" || of.k === "child") e.stmt(`let ${itemName} = ${itemCode};`);
    else e.stmt(`let ${itemName} = *${itemName}_ref;`);
    itemLet = e.lines.length - 1;
  } else {
    return fail(s.comp, "`v-for` walks an array, or counts to a number", c);
  }
  let idxLet = -1;
  if (idx) {
    e.stmt(`let ${idx} = ${idx} as i64;`);
    idxLet = e.lines.length - 1;
  }
  const bodyFrom = e.lines.length;
  if (item.type === "Identifier") inner.set(item.name, { code: itemName, ty: of, ...(src.lone ? { lone: true } : {}) });
  else if (item.type === "ObjectPattern") {
    // `v-for="{ name, id: key } in items"`: each name is that field of the item.
    for (const p of item.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
        fail(s.comp, "a destructured `v-for` item binds plain names, without defaults", p);
      }
      inner.set(p.value.name, fieldVal(s.comp, itemName, of, p.key.name ?? p.key.value, p));
    }
  } else fail(s.comp, "a `v-for` item is a name or an object pattern", item);
  if (index) inner.set(index.name, { code: idx!, ty: INT });
  const before = e.literalBytes;
  const fromProps = src.ty.k === "list" && src.iter === undefined && /^\(?props\./.test(src.code);
  statements({ ...s, locals: inner, loop: fromProps ? { item: itemName, over: src.code } : undefined }, e, fn.body.body);
  // An item or index the body never reads is not bound, and an index never counted: the loop only
  // counts.
  const unusedItem = !e.reads(itemName, bodyFrom);
  const unusedIdx = idx !== null && !e.reads(idx, bodyFrom);
  const head = bodyFrom - 1 - (idx ? 1 : 0) - (itemLet >= 0 ? 1 : 0);
  e.replace(head, loop(bound, idx), loop(unusedItem ? "_" : bound, unusedIdx ? null : idx));
  // Removed from the last line up, so the earlier indices stay right.
  if (unusedIdx) e.lines.splice(idxLet, 1);
  if (unusedItem && itemLet >= 0) e.lines.splice(itemLet, 1);
  e.close();
  // The body's markup is written once per item, not once.
  const body = e.literalBytes - before;
  e.literalBytes = before;
  // Counted up front only when the list is reachable from there: a list of the props, or a list in
  // each item of one, counted over all of them. One a `v-if` narrowed, or a loop deeper down, exists
  // only inside its block, and the reservation is an estimate either way.
  if (body > 0 && fromProps) e.perItem.push(`${body} * ${atom(src.code)}.len()`);
  else if (body > 0 && src.ty.k === "list" && s.loop && src.code.startsWith(`${s.loop.item}.`)) {
    const outer = s.loop;
    e.perItem.push(`${body} * ${atom(outer.over)}.iter().map(|${outer.item}| ${src.code}.len()).sum::<usize>()`);
  }
}

/** `v-for="(value, key, index) in r"` over a record: its entries in JavaScript's order of keys,
 * which is the order `renderList` walks `Object.keys`. */
function recordLoop(s: Scope, e: Emitter, r: Val, fn: N, value: N | undefined, key: N | undefined, index: N | undefined): void {
  if (r.ty.k !== "record") return;
  const of = r.ty.of;
  for (const p of [key, index]) if (p && p.type !== "Identifier") fail(s.comp, "a record's key and index in `v-for` are plain names", p);
  const n = ++ctx.narrowCount;
  const v = value?.type === "Identifier" ? snake(value.name) : `fv_value${n}`;
  const k = key ? snake(key.name) : `fv_key${n}`;
  const i = index ? snake(index.name) : `fv_index${n}`;
  e.open(`for (${i}, (${k}, ${v}_ref)) in ${atom(r.code)}.iter().enumerate()`);
  const head = e.lines.length - 1;
  const indent = /^ */.exec(e.lines[head]!)![0];
  const inner = new Map(s.locals);
  // A value is read as a list item is: a string as a `&str`, a number copied, an object borrowed.
  e.stmt(of.k === "str" ? `let ${v}: &str = ${v}_ref;` : of.k === "int" || of.k === "float" || of.k === "bool" ? `let ${v} = *${v}_ref;` : `let ${v} = ${v}_ref;`);
  e.stmt(`let ${i} = ${i} as i64;`);
  const bodyFrom = e.lines.length;
  if (value?.type === "Identifier") inner.set(value.name, { code: v, ty: of });
  else if (value?.type === "ObjectPattern" && (of.k === "struct" || of.k === "child")) {
    for (const p of value.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
        fail(s.comp, "a destructured `v-for` item binds plain names, without defaults", p);
      }
      inner.set(p.value.name, fieldVal(s.comp, v, of, p.key.name ?? p.key.value, p));
    }
  } else if (value) fail(s.comp, "a `v-for` item is a name, or an object pattern of an object", value);
  if (key) inner.set(key.name, { code: k, ty: STR });
  if (index) inner.set(index.name, { code: i, ty: INT });
  const before = e.literalBytes;
  statements({ ...s, locals: inner }, e, fn.body.body);
  // Whatever the body never reads is not bound, from the last line up.
  const reads = (name: string) => e.reads(name, bodyFrom);
  const [readsV, readsK, readsI] = [reads(v), reads(k), reads(i)];
  if (!readsI) e.lines.splice(head + 2, 1);
  if (!readsV) e.lines.splice(head + 1, 1);
  const pair = `(${readsK ? k : "_"}, ${readsV ? `${v}_ref` : "_"})`;
  e.lines[head] = `${indent}for ${readsI ? `(${i}, ${pair}) in ${atom(r.code)}.iter().enumerate()` : `${pair} in ${atom(r.code)}.iter()`} {`;
  e.close();
  const body = e.literalBytes - before;
  e.literalBytes = before;
  if (body > 0 && /^\(?props\./.test(r.code)) e.perItem.push(`${body} * ${atom(r.code)}.len()`);
}
