import { type Cell, type LoopFrame, type LoopState, type N, type Scope, type Ty, type Val, absence, BOOL, fail, FLOAT, INT, isAscii, nothing, rustChar, rustStr, sameTy, STEP, strTy, withAbsence } from "./model.ts";
import { ctx } from "./context.ts";
import { describeTy, expr, statedTy, typedBy } from "./expr.ts";
import { around, bound, panicky, reps } from "./blocks.ts";
import { asF64, intFromF64, isNumber } from "./numbers.ts";
import { truthTested, truthy, unbound } from "./narrowing.ts";
import { items, itemVal, ownedString } from "./lists.ts";
import { atom, bare, closing, condition, enclosed, literalEnd, occurrences, outermost, receiver } from "./parens.ts";

const ITEMS = new Set(["str", "int", "float", "bool", "struct", "child", "entry"]);

const UNREAD = /\.copied\(\)$|\.map\(\|v\| std::borrow::Cow::<str>::Borrowed\(&\*\*v\)\)$/;

const LITERAL = /'(?:[^'\\]|\\u\{[0-9a-f]+\}|\\.)'|"(?:[^"\\]|\\.)*"/g;

function outsideLiterals(code: string, f: (part: string) => string): string {
  let out = "";
  let at = 0;
  for (const m of code.matchAll(LITERAL)) {
    out += f(code.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + f(code.slice(at));
}

function marked(code: string, rust: string): string {
  return outsideLiterals(code, (part) => part.replace(new RegExp(`(?<![\\w$])${rust}(?![\\w$])`, "g"), () => `$${rust}`));
}

function unmarked(code: string, rust: string): string {
  return outsideLiterals(code, (part) => part.replace(new RegExp(`\\$${rust}(?![\\w$])`, "g"), () => rust));
}

function flattened(code: string): string {
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      i = literalEnd(code, i);
      continue;
    }
    if (ch !== "{" || code[i + 1] !== " " || code[i + 2] !== "{") continue;
    const outer = closing(code, i);
    const inner = closing(code, i + 2);
    if (inner > 0 && outer === inner + 2) return flattened(code.slice(0, i) + code.slice(i + 2, inner + 1) + code.slice(outer + 1));
  }
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      i = literalEnd(code, i);
      continue;
    }
    if (ch !== "{" || code[i + 1] !== " " || !code.startsWith("; ", i - 2)) continue;
    const inner = closing(code, i);
    if (inner > 0 && code[inner - 1] === " " && code.startsWith(" }", inner + 1)) return flattened(code.slice(0, i) + code.slice(i + 2, inner - 1) + code.slice(inner + 1));
  }
  return code;
}

function readsAtMost(n: N, name: string, most: number): boolean {
  let count = 0;
  let nested = false;
  const visit = (x: N, inside: boolean): void => {
    if (!x || typeof x !== "object" || count > 1 || nested) return;
    if (Array.isArray(x)) {
      for (const y of x) visit(y, inside);
      return;
    }
    if (x.type === "Identifier" && x.name === name) {
      count++;
      if (inside) nested = true;
      return;
    }
    const deeper = inside || x.type === "FvLoop" || x.type === "ArrowFunctionExpression" || x.type === "FunctionExpression";
    for (const key of Object.keys(x)) {
      if (key === "loc" || key === "__fv" || key === "typeAnnotation") continue;
      if (x.type === "FvLoop" && key === "after") visit(x[key], inside);
      else if (x[key] && typeof x[key] === "object") visit(x[key], deeper);
    }
  };
  visit(n, false);
  return count <= most && !nested;
}

function fits(declared: Ty, v: Ty): boolean {
  const has = absence(v);
  const takes = absence(declared);
  if (has !== null && takes !== "either" && has !== takes) return false;
  if (nothing(v)) return takes !== null;
  const want = declared.k === "opt" ? declared.of : declared;
  const got = v.k === "opt" ? v.of : v;
  if (isNumber(want)) return isNumber(got);
  if (want.k === "list") return got.k === "list" && (got.of.k === "undef" || fits(want.of, got.of));
  if (want.k === "struct") return got.k === "struct" && got.name === want.name;
  return want.k === got.k;
}

/** A `let` the body assigns again, bound to its first value: its type is the one it is declared
 * with, or the type of that value. */
export function mutableLet(s: Scope, n: N, init: N): Val {
  const comp = s.comp;
  if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
    fail(comp, "FV1912", `\`let ${n.js}\` holds a function and is assigned again: declare each function with \`const\``, n);
  }
  const v = expr(s, n.init);
  if (!n.declared && nothing(v.ty)) {
    fail(comp, "FV1912", `\`let ${n.js}\` starts as \`${v.ty.k === "null" ? "null" : "undefined"}\` with no type, which TypeScript leaves open: state the type it holds, as \`let ${n.js}: string | undefined = undefined\``, n);
  }
  const ty = n.declared ? statedTy(s, n.declared) : v.ty;
  const lets = new Map(s.lets ?? []).set(n.name, { ty, js: n.js, ...(n.declared ? { node: n.declared } : {}) });
  return bound({ ...s, lets }, n.name, v, (inner) => expr(inner, n.body));
}

/** An assignment to a `let` of the body: the new value bound to its name for the statements after it. */
export function assignedLet(s: Scope, n: N): Val {
  const comp = s.comp;
  const declared = s.lets?.get(n.name);
  if (!declared) return fail(comp, "FV1902", `\`${n.js}\` is assigned where the server holds no \`let\` of that name: copy the value into a \`let\` of the body`, n);
  const v = expr(s, declared.node ? typedBy(n.value, declared.node) : n.value);
  if (n.count && !isNumber(v.ty)) {
    fail(comp, "FV1912", `\`${n.count}\` counts a number, and \`${n.js}\` holds ${describeTy(declared.ty)}, which JavaScript would convert to a number first: write \`${n.js} = Number(${n.js}) ${n.count[0]} 1\``, n);
  }
  if (!fits(declared.ty, v.ty)) {
    fail(comp, "FV1912", `\`${n.js}\` is declared as ${describeTy(declared.ty)}, and assigned ${describeTy(v.ty)} here: give the other value a \`let\` of its own`, n);
  }
  const after: Scope = { ...s, narrowed: unbound(s.narrowed, [n.name]) };
  if (!reps(v).some(panicky) && readsAtMost(n.body, n.name, s.frame?.states.some((st) => st.name === n.name) ? 0 : 1)) return expr({ ...after, locals: new Map(s.locals).set(n.name, v) }, n.body);
  return bound(after, n.name, v, (inner) => expr(inner, n.body));
}

function cellOf(s: Scope, declared: { ty: Ty; js: string }, cur: Val, n: N): Cell {
  const ty = declared.ty;
  const base = ty.k === "opt" ? ty.of : ty;
  const kind = base.k === "str" ? "str" : isNumber(base) ? "num" : base.k === "bool" ? "bool" : null;
  const none = absence(ty);
  if (kind === null) {
    fail(s.comp, "FV1911", `the loop assigns \`${declared.js}\`, which holds ${describeTy(ty)}: a loop carries a string, a number or a boolean from one item to the next; build a list with \`.map()\` or \`.filter()\`, and pick an item with \`.find()\``, n);
  }
  if (none === "either") {
    fail(s.comp, "FV1911", `the loop assigns \`${declared.js}\`, which may be \`null\` or \`undefined\`, and the Rust \`Option\` a loop carries it in cannot tell the two apart: declare it as \`T | undefined\``, n);
  }
  const now = cur.ty.k === "opt" ? cur.ty.of : cur.ty;
  return { kind, none, int: kind === "num" && none === null && now.k === "int", ascii: kind === "str" && (nothing(cur.ty) || isAscii(now)), lone: !!cur.lone };
}

function plainTy(c: Cell): Ty {
  return c.kind === "str" ? strTy(c.ascii) : c.kind === "bool" ? BOOL : c.int ? INT : FLOAT;
}

function readOf(c: Cell, rust: string): Val {
  const lone = c.lone ? { lone: true as const } : {};
  if (c.none !== null) return { code: c.kind === "str" ? `${rust}.as_deref()` : rust, ty: withAbsence(plainTy(c), c.none), ...lone };
  if (c.kind === "str") return { code: `&*${rust}`, ty: plainTy(c), ...lone };
  if (c.kind === "num") return c.int ? intFromF64(rust) : { code: rust, ty: FLOAT };
  return { code: rust, ty: BOOL };
}

function slotRead(c: Cell, rust: string): Val {
  const lone = c.lone ? { lone: true as const } : {};
  if (c.kind === "str") return { code: `${rust}.as_deref().unwrap_or_default()`, ty: plainTy(c), ...lone };
  if (c.kind === "num" && c.int) return intFromF64(`${rust}.unwrap_or_default()`);
  return { code: `${rust}.unwrap_or_default()`, ty: plainTy(c) };
}

function rustTy(c: Cell): string {
  const of = c.kind === "str" ? "String" : c.kind === "num" ? "f64" : "bool";
  return c.none === null ? of : `Option<${of}>`;
}

function owned(c: Cell, v: Val): string {
  if (c.kind === "str") return ownedString(v, "");
  if (c.kind === "num") return bare(asF64(v));
  return bare(v.code);
}

function optional(c: Cell, v: Val): string {
  if (nothing(v.ty)) return "None";
  if (v.ty.k !== "opt") return `Some(${owned(c, v)})`;
  if (c.kind === "str") return v.held !== undefined ? `${atom(v.held)}.map(std::borrow::Cow::into_owned)` : `${atom(v.code)}.map(String::from)`;
  if (c.kind === "num" && v.ty.of.k === "int") return `${atom(v.code)}.map(|v| v as f64)`;
  return bare(v.code);
}

function widen(f: LoopFrame, c: Cell, v: Val): void {
  if (nothing(v.ty)) return;
  const now = v.ty.k === "opt" ? v.ty.of : v.ty;
  if (c.kind === "num" && c.int && now.k !== "int") {
    c.int = false;
    f.retry = true;
  }
  if (c.kind !== "str") return;
  if (v.lone && !c.lone) {
    c.lone = true;
    f.retry = true;
  }
  if (c.ascii && !isAscii(now)) {
    c.ascii = false;
    f.retry = true;
  }
}

function write(f: LoopFrame, st: LoopState, v: Val): { code: string; value: string } {
  const c = st.cell;
  const m = st.rust;
  widen(f, c, v);
  if (c.none !== null) {
    const value = optional(c, v);
    return { code: `${m} = ${value};`, value };
  }
  const value = owned(c, v);
  if (c.kind === "num") {
    const top = outermost(value);
    if (top && ["+", "-", "*", "/", "%"].includes(top.op)) {
      if (top.left === m) return { code: `${m} ${top.op}= ${bare(top.right)};`, value };
      if ((top.op === "+" || top.op === "*") && top.right === m) return { code: `${m} ${top.op}= ${bare(top.left)};`, value };
    }
  }
  const fmt = v.format;
  if (c.kind === "str" && fmt && fmt.args[0] === m && fmt.text.startsWith("{}") && fmt.args.slice(1).every((a) => occurrences(a, m) === 0)) {
    const text = fmt.text.slice(2);
    const args = fmt.args.slice(1);
    const plain = text.replace(/\{\{|\}\}/g, (x) => x[0]!);
    if (!args.length) return { code: String.fromCodePoint(plain.codePointAt(0) ?? 0) === plain ? `${m}.push(${rustChar(plain)});` : `${m}.push_str(${rustStr(plain)});`, value };
    return { code: `{ use std::fmt::Write as _; let _ = write!(${m}, ${rustStr(text)}, ${args.join(", ")}); }`, value };
  }
  return { code: `${m} = ${value};`, value };
}

function returned(s: Scope, f: LoopFrame, n: N): Val {
  const v = expr(s, n.argument);
  const kind = v.ty.k === "str" ? "str" : isNumber(v.ty) ? "num" : v.ty.k === "bool" ? "bool" : null;
  if (kind === null) {
    fail(s.comp, "FV1911", `\`return\` inside a loop gives ${describeTy(v.ty)}: a \`return\` inside a loop gives a string, a number or a boolean that is present; find an item with \`.find()\`, or return after the loop`, n.argument);
  }
  if (f.slot === null) {
    f.slot = { kind, none: null, int: kind === "num" && v.ty.k === "int", ascii: kind === "str" && isAscii(v.ty), lone: !!v.lone };
    f.retry = true;
  } else if (f.slot.kind !== kind) {
    fail(s.comp, "FV1911", `the loop's \`return\`s give ${describeTy(plainTy(f.slot))} and ${describeTy(v.ty)}: return one type from inside a loop`, n.argument);
  } else widen(f, f.slot, v);
  return { code: `{ ${f.slotName} = Some(${owned(f.slot, v)});${f.once ? "" : " break;"} }`, ty: STEP };
}

/** Where a loop's body ends an item: at its end or a `continue`, at a `break`, or at a `return`. */
export function loopStep(s: Scope, n: N): Val {
  const f = s.frame;
  if (!f) throw new Error("a loop's `break`, `continue` or `return` outside its body");
  if (n.kind === "return") return returned(s, f, n);
  if (n.kind === "next") f.nexts++;
  const writes: { st: LoopState; code: string; value: string }[] = [];
  for (const st of f.states) {
    if (n.kind === "break" && !st.liveBreak) continue;
    const v = s.locals.get(st.name)!;
    if (v === st.read || (sameTy(v.ty, st.read.ty) && reps(v).join("\0") === reps(st.read).join("\0"))) continue;
    writes.push({ st, ...write(f, st, v) });
  }
  const clash = writes.some((w, j) => writes.slice(0, j).some((x) => occurrences(w.code, x.st.rust) > 0));
  const temps = writes.map(() => `fv_t${++ctx.narrowCount}`);
  const stmts = clash
    ? [...writes.map((w, j) => marked(`let ${temps[j]!} = ${w.value};`, w.st.rust)), ...writes.map((w, j) => marked(`${w.st.rust} = ${temps[j]!};`, w.st.rust))]
    : writes.map((w) => marked(w.code, w.st.rust));
  for (const w of writes) w.st.assigned++;
  const all = stmts.join(" ");
  if (n.kind === "break" && !f.once) return { code: `{ ${all ? `${all} ` : ""}break; }`, ty: STEP };
  return { code: all ? `{ ${all} }` : "{}", ty: STEP };
}

/** A `for…of` or counting `for` loop, with the statements after it: the `let`s it assigns carried
 * from one item to the next in Rust variables, and its `return`s kept for after it. */
export function loopIn(s: Scope, n: N): Val {
  const cells = new Map<string, Cell | null>();
  const breaks = new Map<string, boolean>();
  for (const name of n.states as string[]) {
    const cur = s.locals.get(name);
    const declared = s.lets?.get(name);
    if (!cur || !declared) throw new Error(`a loop assigns \`${name}\`, which no \`let\` around it declares`);
    cells.set(name, cellOf(s, declared, cur, n));
    breaks.set(name, true);
  }
  const box: { slot: Cell | null; once: boolean } = { slot: null, once: false };
  for (let pass = 0; pass < 64; pass++) {
    const done = attempt(s, n, cells, breaks, box);
    if (done) return done;
  }
  throw new Error("a loop's translation does not settle");
}

function attempt(s: Scope, n: N, cells: Map<string, Cell | null>, breaks: Map<string, boolean>, box: { slot: Cell | null; once: boolean }): Val | null {
  const comp = s.comp;
  const states: LoopState[] = [];
  for (const [name, cell] of cells) {
    if (!cell) continue;
    const rust = `fv_m${++ctx.narrowCount}`;
    states.push({ name, rust, cell, read: readOf(cell, rust), liveBreak: breaks.get(name)!, assigned: 0 });
  }
  const frame: LoopFrame = { states, slot: box.slot, slotName: `fv_r${++ctx.narrowCount}`, retry: false, nexts: 0, once: box.once };
  const locals = new Map(s.locals);
  for (const st of states) locals.set(st.name, st.read);
  const narrowed = unbound(s.narrowed, n.states);
  const inner: Scope = { ...s, locals, narrowed, frame };
  const bodyLocals = new Map(locals);
  const lets = new Map(s.lets ?? []);
  let head: (uses: (name: string) => boolean) => string;
  let prelude: (uses: (name: string) => boolean) => string = () => "";
  const once = box.once ? ".take(1)" : "";
  if (n.kind === "of") {
    const v = expr(s, n.over);
    const k = ++ctx.narrowCount;
    if (v.ty.k === "list" && ITEMS.has(v.ty.of.k)) {
      const of = v.ty.of;
      const p = `fv_${of.k === "str" ? "s" : "a"}${k}`;
      bodyLocals.set(n.item, itemVal(of, p, false, v.lone));
      const iter = items(v);
      if (n.entries) {
        const i = `fv_i${k}`;
        if (n.index) {
          bodyLocals.set(n.index, { code: i, ty: INT });
          lets.set(n.index, { ty: INT, js: String(n.index).replace(/#\d+$/, "") });
        }
        head = (uses) => `for (${uses(i) ? i : "_"}, ${uses(p) ? p : "_"}) in ${iter}.enumerate()${once}`;
        prelude = (uses) => (uses(i) ? `let ${i} = ${i} as i64; ` : "");
      } else head = (uses) => (uses(p) ? `for ${p} in ${iter}${once}` : `for _ in ${iter.replace(UNREAD, "")}${once}`);
    } else if (v.ty.k === "str" && !n.entries) {
      const p = `fv_s${k}`;
      bodyLocals.set(n.item, { code: p, ty: strTy(isAscii(v.ty)), ...(v.lone ? { lone: true } : {}) });
      head = (uses) => `for ${uses(p) ? p : "_"} in ${receiver(v.code)}.split_inclusive(|_: char| true)${once}`;
    } else {
      const of = v.ty.k === "list" ? v.ty.of : null;
      const is = of === null ? describeTy(v.ty) : of.k === "undef" ? "an empty array literal" : `a list of ${describeTy(of).replace(/^an? /, "")}s`;
      const what = n.entries ? `\`.entries()\` of ${is}` : is;
      const fix =
        v.ty.k === "opt" ? ": narrow it first, or iterate `x ?? []`"
        : of?.k === "opt" ? ": keep the items that are present with `.filter(Boolean)`"
        : v.ty.k === "record" ? ": iterate `Object.keys(…)` or `Object.entries(…)`"
        : of === null || of.k === "undef" ? "" : ": iterate a list of strings, numbers, booleans or objects";
      return fail(comp, "FV1910", `\`for…of\` iterates a list of strings, numbers, booleans or objects, or a string by its characters, and this is ${what}${fix}`, n.over);
    }
  } else {
    const b = expr(inner, n.bound);
    if (b.ty.k !== "int") {
      const is = b.ty.k === "float" ? "a `Float`, which may hold a fraction or be `NaN`" : describeTy(b.ty);
      fail(comp, "FV1909", `a counting loop runs to an integer bound, and this one is ${is}: round it with \`Math.floor()\`, or iterate a list with \`for…of\``, n.bound);
    }
    const counter = states.find((st) => st.name === n.counter);
    if (counter && !counter.cell.int) fail(comp, "FV1909", "a counting loop counts from an integer: start it at a whole number", n);
    const test = condition(truthy(truthTested(inner, n.test)));
    head = () => `${box.once ? "if" : "while"} ${test}`;
  }
  const body = expr({ ...inner, locals: bodyLocals, lets }, n.body);
  if (body.ty.k !== "step") throw new Error("a loop's body gives a value");
  if (frame.retry) {
    box.slot = frame.slot;
    return null;
  }
  if (frame.nexts === 0 && !box.once) {
    box.once = true;
    return null;
  }
  const afterLocals = new Map(s.locals);
  for (const st of states) afterLocals.set(st.name, st.read);
  let afterAst: N = n.after;
  if (frame.slot) {
    const k = ++ctx.narrowCount;
    const at = { loc: n.loc, start: n.start, end: n.end, __fv: n.__fv };
    const id = (name: string): N => ({ type: "Identifier", name, ...at });
    afterLocals.set(`fv$has${k}`, { code: `${frame.slotName}.is_some()`, ty: BOOL });
    afterLocals.set(`fv$ret${k}`, slotRead(frame.slot, frame.slotName));
    const ret = id(`fv$ret${k}`);
    afterAst = { type: "ConditionalExpression", test: id(`fv$has${k}`), consequent: n.nested ? { type: "FvStep", kind: "return", argument: ret, ...at } : ret, alternate: n.after, ...at };
  }
  const after = expr({ ...s, locals: afterLocals, narrowed }, afterAst);
  const uses = (name: string): boolean => occurrences(body.code, name) > 0;
  const top = head(uses);
  const inBody = `${top} ${body.code}`;
  const inAfter = reps(after).join(" ");
  let changed = false;
  for (const st of states) {
    const later = occurrences(inAfter, st.rust) > 0;
    if (!later && occurrences(inBody, st.rust) === 0) {
      cells.set(st.name, null);
      changed = true;
    } else if (st.liveBreak !== later) {
      breaks.set(st.name, later);
      changed = true;
    } else if (st.assigned === 0) {
      cells.set(st.name, null);
      changed = true;
    }
  }
  if (changed) return null;
  const decls = states.map((st) => `let mut ${st.rust}: ${rustTy(st.cell)} = ${st.cell.none === null ? owned(st.cell, s.locals.get(st.name)!) : optional(st.cell, s.locals.get(st.name)!)};`);
  if (frame.slot) decls.push(`let mut ${frame.slotName}: Option<${rustTy(frame.slot)}> = None;`);
  let inside = outsideLiterals(flattened(bare(body.code)), (part) => part.replaceAll(" else {}", ""));
  if (inside.startsWith("{") && enclosed(inside)) inside = inside.slice(1, -1).trim();
  inside = prelude(uses) + inside;
  let loop = `${top} {${inside ? ` ${inside} ` : ""}}`;
  for (const st of states) loop = unmarked(loop, st.rust);
  const holdsStr = states.some((st) => st.cell.kind === "str") || frame.slot?.kind === "str";
  return around([...decls, loop].join(" "), after, holdsStr);
}
