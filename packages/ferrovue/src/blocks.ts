import { type Component, type Fn, type N, type Scope, type Val, fail, GenError, nothing } from "./model.ts";
import { ctx } from "./context.ts";
import { expr, typedBy } from "./expr.ts";
import { collected, heldList } from "./lists.ts";
import { atom, bare, occurrences, operand, UNARY } from "./parens.ts";
import { presence } from "./narrowing.ts";
import { asCow, heldStr, isTemporary } from "./strings.ts";
import { intFromF64 } from "./numbers.ts";
import { ownedStruct, ownedStructs } from "./objects.ts";
import { mutableLet } from "./statements.ts";

const COW = "std::borrow::Cow::<str>";

/** Runtime calls that panic where JavaScript throws, or user code that may. */
export const PANICS = /\bfv::js_(?:repeat|pad_start|pad_end|date_parse|date_utc|to_iso_string)\(|\bfv_i18n\.t\(/;

export function panicky(code: string): boolean {
  return PANICS.test(code) || Object.values(ctx.helpers).some((h) => code.includes(`${h.rust}(`));
}

/** How a value is held in a Rust `let`: what the `let` is given, how the name reads back, and
 * whether the `let` owns what a read borrows (a `String`, a `Cow`, a `Vec`). */
export function bindingOf(v: Val): { init: string; read: (at: string) => Val; owned: boolean } {
  const lone = v.lone ? { lone: true } : {};
  if (v.variant !== undefined) {
    const optional = v.ty.k === "opt";
    return { init: bare(v.variant), read: (at) => ({ code: optional ? `${at}.map(|v| v.as_str())` : `${at}.as_str()`, ty: v.ty, variant: at, ...lone }), owned: false };
  }
  if (v.owned) return { init: bare(v.code), read: (at) => ({ code: v.ty.k === "opt" ? `${at}.as_ref()` : at, ty: v.ty, ...lone }), owned: true };
  if (v.slice) return { init: bare(v.code), read: (at) => ({ code: at, ty: v.ty, slice: true, ...lone }), owned: false };
  if (v.ty.k === "list" && v.iter !== undefined) return { init: collected(v), read: (at) => heldList(at, v.ty.k === "list" ? v.ty.of : v.ty, v.lone), owned: true };
  if (v.held !== undefined) return { init: v.held, read: (at) => ({ code: `${at}.as_deref()`, ty: v.ty, ...lone }), owned: true };
  if (v.ty.k === "int" && v.f64 !== undefined && (v.code.endsWith(" as i64") || Object.is(v.num, -0))) {
    return {
      init: bare(v.f64),
      read: (at) => ({ ...intFromF64(at), ...lone, ...(v.num !== undefined ? { num: v.num } : {}), ...(v.konst !== undefined ? { konst: v.konst } : {}) }),
      owned: false,
    };
  }
  if (isTemporary(v)) return { init: heldStr(v), read: (at) => ({ code: `&*${at}`, ty: v.ty, ...lone }), owned: true };
  const place = v.ty.k === "list" || v.ty.k === "record" || v.ty.k === "struct" || v.ty.k === "child";
  return {
    init: place ? `&${operand(v.code, UNARY)}` : bare(v.code),
    read: (at) => ({ code: at, ty: v.ty, ...lone, ...(v.konst !== undefined ? { konst: v.konst } : {}) }),
    owned: false,
  };
}

const SKIP = new Set(["loc", "start", "end", "extra", "range", "typeAnnotation", "typeParameters", "returnType", "leadingComments", "trailingComments", "innerComments", "__fv", "label"]);

let renames = 0;

type Env = Map<string, string | null>;

function spot(from: N): N {
  return { loc: from?.loc, start: from?.start, end: from?.end, __fv: from?.__fv };
}

function declared(st: N): string[] {
  if (st?.type === "VariableDeclaration") return st.declarations.flatMap((d: N) => patternNames(d.id));
  return [];
}

function patternNames(p: N): string[] {
  switch (p?.type) {
    case "Identifier":
      return [p.name];
    case "ObjectPattern":
      return p.properties.flatMap((q: N) => patternNames(q.type === "RestElement" ? q.argument : q.value));
    case "ArrayPattern":
      return p.elements.flatMap((q: N) => (q ? patternNames(q) : []));
    case "AssignmentPattern":
      return patternNames(p.left);
    case "RestElement":
      return patternNames(p.argument);
    default:
      return [];
  }
}

class Renamer {
  private readonly comp: Component;

  constructor(comp: Component) {
    this.comp = comp;
  }

  statements(sts: N[], outer: Env): N[] {
    const env: Env = new Map(outer);
    for (const st of sts) for (const name of declared(st)) env.set(name, null);
    return sts.map((st) => {
      if (st.type !== "VariableDeclaration") return this.node(st, env);
      const declarations = st.declarations.map((d: N) => {
        if (d.id.type === "Identifier" && (d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression")) {
          const id = this.pattern(d.id, env);
          return { ...d, id, init: this.node(d.init, env) };
        }
        const init = this.node(d.init, env);
        return { ...d, init, id: this.pattern(d.id, env) };
      });
      return { ...st, declarations };
    });
  }

  pattern(p: N, env: Env): N {
    switch (p?.type) {
      case "Identifier": {
        const to = `${p.name}#${++renames}`;
        env.set(p.name, to);
        return { ...p, name: to, fvName: p.name };
      }
      case "ObjectPattern":
        return {
          ...p,
          properties: p.properties.map((q: N) =>
            q.type === "RestElement" ? { ...q, argument: this.pattern(q.argument, env) } : { ...q, key: q.computed ? this.node(q.key, env) : q.key, value: this.pattern(q.value, env), shorthand: false },
          ),
        };
      case "ArrayPattern":
        return { ...p, elements: p.elements.map((q: N) => (q ? this.pattern(q, env) : q)) };
      case "AssignmentPattern":
        return { ...p, right: this.node(p.right, env), left: this.pattern(p.left, env) };
      case "RestElement":
        return { ...p, argument: this.pattern(p.argument, env) };
      default:
        return p;
    }
  }

  node(n: N, env: Env): N {
    if (!n || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map((x) => this.node(x, env));
    switch (n.type) {
      case "Identifier": {
        const to = env.get(n.name);
        if (to === null) fail(this.comp, "FV1901", `\`${n.name}\` is read before its declaration, where JavaScript throws a \`ReferenceError\``, n);
        return to === undefined ? n : { ...n, name: to, fvName: n.name };
      }
      case "MemberExpression":
      case "OptionalMemberExpression":
        return { ...n, object: this.node(n.object, env), property: n.computed ? this.node(n.property, env) : n.property };
      case "ObjectProperty":
        return { ...n, key: n.computed ? this.node(n.key, env) : n.key, value: this.node(n.value, env), shorthand: false };
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
      case "ObjectMethod": {
        const inner: Env = new Map(env);
        for (const p of n.params) for (const name of patternNames(p)) inner.delete(name);
        if (n.type === "FunctionExpression" && n.id) inner.delete(n.id.name);
        const body = n.body.type === "BlockStatement" ? { ...n.body, body: this.statements(n.body.body, inner) } : this.node(n.body, inner);
        return { ...n, body };
      }
      case "BlockStatement":
        return { ...n, body: this.statements(n.body, env) };
      case "SwitchStatement":
        return { ...n, discriminant: this.node(n.discriminant, env), cases: n.cases.map((c: N) => ({ ...c, test: this.node(c.test, env), consequent: this.statements(c.consequent, env) })) };
      case "ForOfStatement":
      case "ForInStatement": {
        const right = this.node(n.right, env);
        const inner: Env = new Map(env);
        const left = n.left.type === "VariableDeclaration" ? { ...n.left, declarations: n.left.declarations.map((d: N) => ({ ...d, id: this.pattern(d.id, inner) })) } : this.node(n.left, env);
        return { ...n, left, right, body: this.node(n.body, inner) };
      }
      case "ForStatement": {
        const inner: Env = new Map(env);
        let init: N = n.init;
        if (init?.type === "VariableDeclaration") {
          for (const name of declared(init)) inner.set(name, null);
          init = { ...init, declarations: init.declarations.map((d: N) => ({ ...d, init: this.node(d.init, inner), id: this.pattern(d.id, inner) })) };
        } else init = this.node(init, inner);
        return { ...n, init, test: this.node(n.test, inner), update: this.node(n.update, inner), body: this.node(n.body, inner) };
      }
    }
    const copy: N = { ...n };
    for (const key of Object.keys(n)) {
      if (SKIP.has(key)) continue;
      const v = n[key];
      if (v && typeof v === "object") copy[key] = this.node(v, env);
    }
    return copy;
  }
}

interface Cont {
  sts: N[];
  next: Cont | null;
  brk: Cont | null | undefined;
  falls?: N;
  leaf?: N;
}

const COUNT = "count with `for (let i = start; i < end; i++)` to an integer bound, or iterate with `for (const x of list)`";

const LOOPS: Record<string, string> = {
  ForInStatement: "a `for…in` loop, which walks an object's keys: iterate `Object.keys(…)` with `for (const key of …)`",
  WhileStatement: `a \`while\` loop, which the compiler cannot bound: ${COUNT}`,
  DoWhileStatement: `a \`do…while\` loop, which the compiler cannot bound: ${COUNT}`,
};

const OTHERS: Record<string, string> = {
  TryStatement: "`try`, which only catches what the body throws",
  ThrowStatement: "`throw`, which ends the render with an error",
  LabeledStatement: "a labelled statement",
  FunctionDeclaration: "a function declared inside it with `function`, which is hoisted: declare it with `const f = (…) => …` before it is called",
  ClassDeclaration: "a class declared inside it",
  DebuggerStatement: "`debugger`",
  WithStatement: "`with`",
};

const SUBSET = "it holds `const` and `let`, assignments to its `let`s, `if` / `else`, `switch`, `for…of` and counting `for` loops, and `return`";

const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);

function walk(n: N, visit: (n: N, parent: N) => boolean, parent: N = null): void {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) {
    for (const x of n) walk(x, visit, parent);
    return;
  }
  if (!visit(n, parent)) return;
  for (const key of Object.keys(n)) if (!SKIP.has(key) && n[key] && typeof n[key] === "object") walk(n[key], visit, n);
}

function ownNames(body: N): { lets: Set<string>; consts: Set<string> } {
  const lets = new Set<string>();
  const consts = new Set<string>();
  walk(body, (n) => {
    if (FUNCTIONS.has(n.type)) return false;
    if (n.type === "VariableDeclaration") for (const d of n.declarations) for (const name of patternNames(d.id)) (n.kind === "let" ? lets : consts).add(name);
    return true;
  });
  return { lets, consts };
}

function targetOf(n: N): N {
  return n.type === "UpdateExpression" ? n.argument : n.left;
}

function assignedIn(n: N): Set<string> {
  const names = new Set<string>();
  walk(n, (x) => {
    if (FUNCTIONS.has(x.type)) return false;
    if ((x.type === "AssignmentExpression" || x.type === "UpdateExpression") && targetOf(x).type === "Identifier") names.add(targetOf(x).name);
    return true;
  });
  return names;
}

function reads(n: N, names: Set<string>): N | null {
  let found: N | null = null;
  walk(n, (x) => {
    if (found) return false;
    if (x.type === "Identifier" && names.has(x.name)) found = x;
    return true;
  });
  return found;
}

/** The `let`s of a body that it assigns again, each assignment checked: a statement of its own that
 * assigns a `let` the body itself declares. */
function assignments(comp: Component, body: N[], whose: string): Set<string> {
  const top = ownNames(body);
  const assigned = new Set<string>();
  const check = (n: N, parent: N, own: { lets: Set<string>; consts: Set<string> }, outer: Set<string>, nested: boolean): void => {
    const target = targetOf(n);
    const op = `\`${n.operator}\``;
    if (target.type !== "Identifier") {
      const what = target.type === "MemberExpression" || target.type === "OptionalMemberExpression" ? "a field or an item" : "a pattern";
      fail(comp, "FV1902", `an assignment (${op}) to ${what}, which changes an object or a list in place, and ${whose} does not translate that: build the new value and give it a \`const\``, n);
    }
    const name = target.fvName ?? target.name;
    if (!own.lets.has(target.name)) {
      if (own.consts.has(target.name)) fail(comp, "FV1902", `\`${name}\` is a \`const\`, which JavaScript does not let a body assign: declare it with \`let\``, n);
      if (nested && outer.has(target.name)) {
        fail(comp, "FV1902", `\`${name}\` is a \`let\` of the body around this function, which a function inside it may not assign (${op}): return the value from the function, and assign it in the body`, n);
      }
      fail(comp, "FV1902", `\`${name}\` is assigned (${op}), and it is no \`let\` of this body: ${whose} assigns only the \`let\`s it declares, and leaves a prop, a ref, a \`computed\`, a parameter and a name from outside it as they are; copy the value into a \`let\` of the body`, n);
    }
    const statement = (parent?.type === "ExpressionStatement" && parent.expression === n) || (parent?.type === "ForStatement" && parent.update === n);
    if (!statement) fail(comp, "FV1902", `an assignment (${op}) inside an expression, whose value JavaScript then reads: write the assignment as a statement of its own`, n);
  };
  const scan = (from: N, own: { lets: Set<string>; consts: Set<string> }, outer: Set<string>, nested: boolean): void => {
    walk(from, (n, parent) => {
      if (FUNCTIONS.has(n.type)) {
        const mine = n.body?.type === "BlockStatement" ? ownNames(n.body.body) : { lets: new Set<string>(), consts: new Set<string>() };
        scan(n.body, mine, new Set([...outer, ...own.lets]), true);
        return false;
      }
      if (n.type === "AssignmentExpression" || n.type === "UpdateExpression") {
        check(n, parent, own, outer, nested);
        if (!nested) assigned.add(targetOf(n).name);
      }
      return true;
    });
  };
  scan(body, top, new Set(), false);
  if (assigned.size) {
    walk(body, (n) => {
      if (FUNCTIONS.has(n.type)) return false;
      if (n.type !== "VariableDeclarator" || !FUNCTIONS.has(n.init?.type)) return true;
      const read = reads(n.init, assigned);
      if (read) {
        const fn = n.id.fvName ?? n.id.name;
        fail(comp, "FV1902", `\`${fn}\` reads \`${read.fvName ?? read.name}\`, a \`let\` the body assigns again: the server gives a function the values the body holds where the function is declared, and JavaScript reads them where it is called; pass the value to \`${fn}\` as a parameter`, read);
      }
      return false;
    });
  }
  return assigned;
}

function stepOf(update: N, name: string): number {
  if (update?.type === "UpdateExpression" && update.argument.type === "Identifier" && update.argument.name === name) return update.operator === "++" ? 1 : -1;
  if (update?.type !== "AssignmentExpression" || update.left.type !== "Identifier" || update.left.name !== name) return 0;
  const by = update.right;
  if (by.type !== "NumericLiteral" || !Number.isSafeInteger(by.value) || by.value <= 0) return 0;
  return update.operator === "+=" ? by.value : update.operator === "-=" ? -by.value : 0;
}

/** How many times a body's statements may be translated again after an `if` or a `case` that
 * falls off its end: each such path continues with the statements after it, translated on its own,
 * so sequential `switch`es of `break`ing cases multiply them. */
export const PATH_BUDGET = 4096;

class Desugar {
  private readonly comp: Component;
  private readonly whose: string;
  private readonly assigned: Set<string>;
  private readonly loops: Cont[] = [];
  private paths = 0;

  constructor(comp: Component, whose = "a function's body", assigned: Set<string> = new Set()) {
    this.comp = comp;
    this.whose = whose;
    this.assigned = assigned;
  }

  run(sts: N[], k: Cont | null, brk: Cont | null | undefined, from: N): N {
    for (let i = 0; i < sts.length; i++) {
      const st = sts[i]!;
      const rest = sts.slice(i + 1);
      const after: Cont | null = rest.length ? { sts: rest, next: k, brk } : k;
      switch (st.type) {
        case "EmptyStatement":
          continue;
        case "ReturnStatement":
          if (!st.argument) fail(this.comp, "FV1903", "`return` without a value returns `undefined`: return the value the function gives on this path", st);
          this.dead(rest, "`return`");
          return this.loops.length ? { type: "FvStep", kind: "return", argument: st.argument, ...spot(st) } : st.argument;
        case "BreakStatement":
          this.dead(rest, "`break`");
          return this.go(brk as Cont | null, st);
        case "ContinueStatement":
          this.dead(rest, "`continue`");
          return this.go(this.loops.at(-1)!, st);
        case "ForOfStatement":
          return this.forOf(st, after);
        case "ForStatement":
          return this.forCount(st, after);
        case "BlockStatement":
          return this.run(st.body, after, brk, st);
        case "IfStatement": {
          const yes = this.run(this.branch(st.consequent), after, brk, st);
          const no = st.alternate ? this.run(this.branch(st.alternate), after, brk, st) : this.go(after, st);
          return { type: "ConditionalExpression", test: st.test, consequent: yes, alternate: no, fvIf: true, ...spot(st) };
        }
        case "SwitchStatement":
          return this.switched(st, after);
        case "VariableDeclaration": {
          if (st.kind !== "const" && st.kind !== "let") fail(this.comp, "FV1901", `${this.whose} may not hold \`${st.kind}\`: declare the value with \`const\``, st);
          const body = this.run(rest, k, brk, st);
          return st.declarations.reduceRight((inner: N, d: N) => this.bind(d, inner), body);
        }
        case "ExpressionStatement":
          if (st.expression.type === "AssignmentExpression" || st.expression.type === "UpdateExpression") return this.assign(st.expression, this.run(rest, k, brk, st));
          return fail(this.comp, "FV1901", `${this.whose} may not hold an expression statement (\`${st.expression.type}\`), whose value is dropped and which could only change something: ${SUBSET}`, st);
        default: {
          if (LOOPS[st.type]) return fail(this.comp, "FV1901", `${this.whose} may not hold ${LOOPS[st.type]}`, st);
          return fail(this.comp, "FV1901", `${this.whose} may not hold ${OTHERS[st.type] ?? `\`${st.type}\``}: ${SUBSET}`, st);
        }
      }
    }
    return this.go(k, from);
  }

  private assign(e: N, body: N): N {
    const target = targetOf(e);
    const at = spot(e);
    let value: N;
    if (e.type === "UpdateExpression") {
      value = { type: "BinaryExpression", operator: e.operator[0], left: { ...target }, right: { type: "NumericLiteral", value: 1, ...at }, ...at };
    } else if (e.operator === "=") {
      value = e.right;
    } else {
      const op: string = e.operator.slice(0, -1);
      value = { type: op === "&&" || op === "||" || op === "??" ? "LogicalExpression" : "BinaryExpression", operator: op, left: { ...target }, right: e.right, ...at };
    }
    return { type: "FvSet", name: target.name, js: target.fvName ?? target.name, value, count: e.type === "UpdateExpression" ? e.operator : undefined, body, ...at };
  }

  private loopBody(sts: N[], update: N | null, from: N): N {
    const next: Cont = { sts: [], next: null, brk: undefined, leaf: { type: "FvStep", kind: "next" } };
    const cont: Cont = update ? { sts: [{ type: "ExpressionStatement", expression: update, ...spot(update) }], next, brk: undefined } : next;
    const brk: Cont = { sts: [], next: null, brk: undefined, leaf: { type: "FvStep", kind: "break" } };
    this.loops.push(cont);
    try {
      return this.run(sts, cont, brk, from);
    } finally {
      this.loops.pop();
    }
  }

  private carried(st: N, head: string[]): string[] {
    const local = new Set<string>(head);
    walk(st.body, (n) => {
      if (FUNCTIONS.has(n.type)) return false;
      if (n.type === "VariableDeclaration") for (const d of n.declarations) for (const name of patternNames(d.id)) local.add(name);
      return true;
    });
    const assigned = assignedIn(st.body);
    if (st.update) for (const name of assignedIn(st.update)) assigned.add(name);
    return [...assigned].filter((name) => !local.has(name));
  }

  private forOf(st: N, after: Cont | null): N {
    if (st.await) fail(this.comp, "FV1909", "`for await`, which waits on promises a render cannot wait on: iterate the values themselves", st);
    const decl = st.left;
    const d = decl.type === "VariableDeclaration" && (decl.kind === "const" || decl.kind === "let") && decl.declarations.length === 1 ? decl.declarations[0] : null;
    if (!d || d.init) fail(this.comp, "FV1909", "a `for…of` loop declares its item in its head, as `for (const x of list)`", decl);
    const id = d.id;
    const right = st.right;
    const entries =
      id.type === "ArrayPattern" &&
      right.type === "CallExpression" &&
      right.arguments.length === 0 &&
      right.callee.type === "MemberExpression" &&
      !right.callee.computed &&
      right.callee.property.name === "entries";
    let index: string | null = null;
    let pattern: N | null = id;
    if (entries) {
      const [i, x] = id.elements as N[];
      if (id.elements.length > 2 || (i && i.type !== "Identifier") || x?.type === "RestElement") {
        fail(this.comp, "FV1909", "`for (const [i, x] of list.entries())` names the index and the item: `[i, x]`, `[i]` or `[, x]`", id);
      }
      index = i?.name ?? null;
      pattern = x ?? null;
    }
    const item = `item#${++renames}`;
    const states = this.carried(st, patternNames(id));
    const nested = this.loops.length > 0;
    const inner = this.loopBody(this.branch(st.body), null, st);
    const body = pattern ? this.pattern(pattern, { type: "Identifier", name: item, ...spot(right) }, inner, d) : inner;
    const over = entries ? right.callee.object : right;
    return { type: "FvLoop", kind: "of", over, entries, item, index, body, after: this.go(after, st), states, nested, ...spot(st) };
  }

  private forCount(st: N, after: Cont | null): N {
    const init = st.init;
    const d = init?.type === "VariableDeclaration" && init.kind === "let" && init.declarations.length === 1 ? init.declarations[0] : null;
    const counter: N = d?.id.type === "Identifier" && d.init ? d.id : null;
    const by = counter ? stepOf(st.update, counter.name) : 0;
    const test = st.test;
    const order = test?.type === "BinaryExpression" && test.left.type === "Identifier" && test.left.name === counter?.name ? (test.operator as string) : "";
    const rising = order === "<" || order === "<=";
    const falling = order === ">" || order === ">=";
    if (!counter || !((rising && by > 0) || (falling && by < 0))) {
      fail(this.comp, "FV1909", `a \`for\` loop that is no counting loop, which the compiler cannot bound: ${COUNT}`, st);
    }
    const name = counter.fvName ?? counter.name;
    if (assignedIn(st.body).has(counter.name)) fail(this.comp, "FV1909", `the body of a counting loop assigns \`${name}\`, which the loop's head alone counts: ${COUNT}`, st.body);
    const states = this.carried(st, []);
    const limit = test.right;
    const changed = reads(limit, new Set(states));
    if (changed) fail(this.comp, "FV1909", `the bound of a counting loop reads \`${changed.fvName ?? changed.name}\`, which the loop changes, so the compiler cannot bound it: ${COUNT}`, changed);
    const nested = this.loops.length > 0;
    const body = this.loopBody(this.branch(st.body), st.update, st);
    const loop = { type: "FvLoop", kind: "count", counter: counter.name, test, bound: limit, body, after: this.go(after, st), states, nested, ...spot(st) };
    return this.pattern(counter, d.init, loop, d);
  }

  private branch(st: N): N[] {
    return st.type === "BlockStatement" ? st.body : [st];
  }

  private dead(rest: N[], after: string): void {
    const first = rest.find((r) => r.type !== "EmptyStatement");
    if (first) fail(this.comp, "FV1904", `code after ${after}, which never runs: remove it`, first);
  }

  private go(k: Cont | null, from: N): N {
    if (k === null) {
      return fail(this.comp, "FV1903", "the function can reach its end here without a `return`, and JavaScript then returns `undefined`: return a value on every path", from);
    }
    if (k.leaf) return { ...k.leaf, ...spot(from) };
    if (k.falls) fail(this.comp, "FV1904", "this case falls through into the next one, which runs its statements too: end it with `return` or `break`", k.falls);
    if (k.sts.length && ++this.paths > PATH_BUDGET) {
      fail(this.comp, "FV1905", `the body's \`if\`s and \`switch\`es continue with the statements after them on more than ${PATH_BUDGET} paths, each translated on its own: end the cases in \`return\`, or split the body into \`computed\`s`, from);
    }
    return this.run(k.sts, k.next, k.brk, from);
  }

  private bind(d: N, body: N): N {
    if (!d.init) {
      const name: string = d.id.fvName ?? d.id.name ?? "a pattern";
      const none = this.assigned.has(d.id.name) ? `, and JavaScript gives it \`undefined\` until it is assigned: give it a value where it is declared, \`let ${name}: T | undefined = undefined\` for none` : ": give it one where it is declared";
      fail(this.comp, "FV1901", `\`${name}\` is declared without a value${none}`, d);
    }
    const typed = d.id.typeAnnotation?.typeAnnotation;
    const init = typed ? typedBy(d.init, typed) : d.init;
    return this.pattern(d.id, init, body, d);
  }

  pattern(p: N, value: N, body: N, d: N): N {
    switch (p.type) {
      case "Identifier":
        if (this.assigned.has(p.name)) return { type: "FvLet", name: p.name, js: p.fvName ?? p.name, init: value, body, mutable: true, declared: p.typeAnnotation?.typeAnnotation, ...spot(d) };
        return { type: "FvLet", name: p.name, js: p.fvName ?? p.name, init: value, body, ...spot(d) };
      case "ObjectPattern":
      case "ArrayPattern": {
        const tmp = `fv#${++renames}`;
        const ref = (): N => ({ type: "Identifier", name: tmp, ...spot(value) });
        const parts: [N, N][] = [];
        if (p.type === "ObjectPattern") {
          for (const q of p.properties) {
            if (q.type === "RestElement" || q.computed) fail(this.comp, "FV1901", "a destructuring pattern names each field it reads, without `...rest` or a computed key", q);
            const key: string = q.key.type === "Identifier" ? q.key.name : String(q.key.value);
            parts.push([q.value, { type: "MemberExpression", computed: false, object: ref(), property: { type: "Identifier", name: key, ...spot(q.key) }, ...spot(q) }]);
          }
        } else {
          p.elements.forEach((q: N, i: number) => {
            if (!q) return;
            if (q.type === "RestElement") fail(this.comp, "FV1901", "a destructuring pattern names each item it reads, without `...rest`", q);
            parts.push([q, { type: "MemberExpression", computed: true, object: ref(), property: { type: "NumericLiteral", value: i, ...spot(q) }, ...spot(q) }]);
          });
        }
        for (const [q] of parts) if (q.type === "AssignmentPattern") fail(this.comp, "FV1901", "a default in a destructuring pattern, which applies to `undefined` alone: write `?? fallback` where it is read", q);
        const inner = parts.reduceRight((acc: N, [q, v]) => this.pattern(q, v, acc, d), body);
        return { type: "FvLet", name: tmp, js: "the destructured value", init: value, body: inner, ...spot(d) };
      }
      default:
        return fail(this.comp, "FV1901", "a declaration binds a name, or an object or array pattern of names", p);
    }
  }

  private switched(st: N, after: Cont | null): N {
    const d = `switch#${++renames}`;
    const subject = (): N => ({ type: "Identifier", name: d, ...spot(st.discriminant) });
    const groups: { tests: N[]; body: N[]; dflt: boolean; at: N }[] = [];
    let open: { tests: N[]; body: N[]; dflt: boolean; at: N } | null = null;
    for (const c of st.cases) {
      if (!open) {
        open = { tests: [], body: [], dflt: false, at: c };
        groups.push(open);
      }
      if (c.test) open.tests.push(c.test);
      else open.dflt = true;
      const lexical = c.consequent.find((x: N) => x.type === "VariableDeclaration" || x.type === "FunctionDeclaration" || x.type === "ClassDeclaration");
      if (lexical) fail(this.comp, "FV1904", "a declaration directly in a `case`, which the whole `switch` shares: wrap the case's statements in `{ … }`", lexical);
      if (c.consequent.some((x: N) => x.type !== "EmptyStatement")) {
        open.body = c.consequent;
        open = null;
      }
    }
    const brk = after;
    const bodyOf = (g: (typeof groups)[number], i: number): N => {
      const last = i === groups.length - 1;
      const k: Cont | null = last ? after : { sts: [], next: null, brk: undefined, falls: g.body.at(-1) ?? g.at };
      if (!g.body.length) return last ? this.go(after, g.at) : this.go(k, g.at);
      return this.run(g.body, k, brk, g.body.at(-1));
    };
    const fallback = groups.findIndex((g) => g.dflt);
    let chain: N = fallback >= 0 ? bodyOf(groups[fallback]!, fallback) : this.go(after, st);
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]!;
      if (i === fallback) continue;
      const test = g.tests
        .map((t): N => ({ type: "BinaryExpression", operator: "===", left: subject(), right: t, ...spot(t) }))
        .reduce((a: N, b: N): N => ({ type: "LogicalExpression", operator: "||", left: a, right: b, ...spot(b) }));
      chain = { type: "ConditionalExpression", test, consequent: bodyOf(g, i), alternate: chain, ...spot(g.at) };
    }
    return { type: "FvLet", name: d, js: "the `switch`'s value", init: st.discriminant, body: chain, ...spot(st) };
  }
}

const desugared = new WeakMap<object, object>();

/** The expression a function's body computes: the expression of an arrow function, or a block of
 * statements in the subset ferrovue translates, written as one expression. */
export function bodyExpr(comp: Component, fn: N, whose = "a function's body"): N {
  if (fn.body.type !== "BlockStatement") return fn.body;
  const done = desugared.get(fn);
  if (done) return done;
  const shadowed: Env = new Map();
  const renamed = new Renamer(comp).statements(fn.body.body, shadowed);
  const assigned = assignments(comp, renamed, whose);
  const out = new Desugar(comp, whose, assigned).run(renamed, null, undefined, fn.body.body.at(-1) ?? fn);
  desugared.set(fn, out);
  return out;
}

/** `p` (a name, or an object or array pattern of names) bound to `value` around `body`. */
export function destructured(comp: Component, p: N, value: N, body: N): N {
  return new Desugar(comp).pattern(p, value, body, p);
}

/** `fn` with an expression for its body, where it is an arrow or function expression with a block. */
export function expressionBodied(comp: Component, fn: N): N {
  if ((fn?.type !== "ArrowFunctionExpression" && fn?.type !== "FunctionExpression") || fn.body.type !== "BlockStatement") return fn;
  return { ...fn, body: bodyExpr(comp, fn) };
}

function simple(v: Val): boolean {
  if (v.iter !== undefined || v.held !== undefined || v.format !== undefined) return false;
  if (nothing(v.ty)) return true;
  if (v.variant !== undefined) return /^[A-Za-z_]\w*(?:\.\w+)*$/.test(v.variant);
  return /^(?:&\*?|\*)?[A-Za-z_]\w*(?:\.\w+)*$/.test(v.code) || /^"(?:[^"\\]|\\.)*"$/.test(v.code) || /^-?\d[\w.]*$/.test(v.code);
}

export function reps(v: Val): string[] {
  return [v.code, v.iter, v.held, v.f64, ...(v.format?.args ?? [])].filter((r): r is string => r !== undefined);
}

function ownedCow(v: Val): string {
  if (/^&\*fv_m\d+$/.test(v.code)) return `${COW}::Owned(${v.code.slice(2)})`;
  if (!isTemporary(v)) return /^&\*\w+(?:\.[\w#]+)+$/.test(v.code) ? `${COW}::Owned(str::to_owned(${v.code}))` : `${COW}::Owned(${atom(v.code).replace(/^&\*?/, "")}.to_owned())`;
  const cow = asCow(v);
  return cow.startsWith(`${COW}::Owned(`) ? cow : `${COW}::Owned(${atom(cow)}.into_owned())`;
}

/** `const name = init` around `body`: the value `body` computes with `name` bound once, as a Rust
 * `let` in a block that hands out nothing borrowed from it. */
export function letIn(s: Scope, n: N): Val {
  let init: N = n.init;
  while (init?.type === "ParenthesizedExpression" || init?.type === "TSAsExpression" || init?.type === "TSSatisfiesExpression") init = init.expression;
  if (n.mutable) return mutableLet(s, n, init);
  if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
    const fn: Fn = { name: n.js, node: init, home: s.comp, file: null };
    const inner: Scope = {
      ...s,
      functions: new Map(s.functions).set(n.name, fn),
      clientOnly: new Map(s.clientOnly).set(n.name, "it is a function declared in a body, which that body may call, and not use as a value"),
    };
    fn.captured = inner;
    return expr(inner, n.body);
  }
  return bound(s, n.name, expr(s, n.init), (inner) => expr(inner, n.body));
}

/** `v` bound once to `name` for `body`, which is given the scope that reads it. */
export function bound(s: Scope, local: string, v: Val, then: (inner: Scope) => Val): Val {
  if (simple(v)) return then({ ...s, locals: new Map(s.locals).set(local, v) });
  const name = `fv_c${++ctx.narrowCount}`;
  const { init, read, owned } = bindingOf(v);
  const held = read(name);
  const body = then({ ...s, locals: new Map(s.locals).set(local, held) });
  if (reps(body).join("\0") === reps(held).join("\0")) return v;
  const uses = reps(body).some((r) => occurrences(r, name) > 0);
  if (!uses && !panicky(init)) return body;
  return around(`let ${uses ? name : "_"} = ${init};`, body, owned, !!v.owned && uses);
}

/** `body` after the Rust statements `lead`, as a block that hands out nothing borrowed from what
 * they declare: `owned` when a statement owns what `body` may borrow (a `String`, a `Cow`, a
 * `Vec`), `ownedUses` when it holds a struct or a list `body` reads. */
export function around(lead: string, body: Val, owned: boolean, ownedUses = false): Val {
  const block = (code: string): string => `{ ${lead} ${bare(code)} }`;
  const lone = body.lone ? { lone: true as const } : {};
  if (body.ty.k === "step") return { code: body.code === "{}" ? `{ ${lead} }` : block(body.code), ty: body.ty };
  if (body.owned) return { code: `(${block(body.code)})`, ty: body.ty, owned: true, ...lone };
  if (ownedUses) {
    const of = body.ty.k === "opt" || body.ty.k === "list" ? body.ty.of : body.ty;
    if (of.k === "struct" && body.ty.k === "struct") return { code: `(${block(ownedStruct(body))})`, ty: body.ty, owned: true, ...lone };
    if (of.k === "struct" && body.ty.k === "opt") return { code: `(${block(`${atom(body.code)}.cloned()`)})`, ty: body.ty, owned: true, ...lone };
    if (of.k === "struct" && body.ty.k === "list") return { code: `(${block(ownedStructs(body))})`, ty: body.ty, owned: true, ...lone };
    if (body.ty.k === "list" && body.iter === undefined) return { code: `(${block(`${atom(body.code)}.to_vec()`)})`, ty: body.ty, owned: true, ...lone };
  }
  switch (body.ty.k) {
    case "int":
    case "float":
    case "bool":
    case "undef":
    case "null":
      return { code: block(body.code), ty: body.ty, ...lone, ...(body.f64 !== undefined ? { f64: block(body.f64) } : {}) };
    case "str":
      if (!owned && !isTemporary(body)) return { code: block(body.code), ty: body.ty, ...lone };
      return { code: `&*${block(owned ? ownedCow(body) : asCow(body))}`, ty: body.ty, ...lone };
    case "list": {
      if (!owned && body.iter === undefined) return { code: block(body.code), ty: body.ty, ...(body.slice ? { slice: true } : {}), ...lone };
      const all = block(collected(body));
      return { code: all, ty: body.ty, iter: `${all}.into_iter()`, ...lone };
    }
    case "opt":
      if (body.ty.of.k === "str" && (owned || body.held !== undefined)) {
        const kept = block(owned ? `${atom(body.code)}.map(|v| ${COW}::Owned(v.to_owned()))` : body.held!);
        return { code: `${kept}.as_deref()`, ty: body.ty, held: kept, ...lone };
      }
      return { code: block(body.code), ty: body.ty, ...lone };
    default: {
      const ref = /^\w+(?:\.[\w#]+)+$/.test(body.code) ? `&${body.code}` : body.code;
      return { code: `(${block(ref)})`, ty: body.ty, ...lone };
    }
  }
}

/** Whether a desugared `if` whose test is `a && b` or `a || b` should be split, so that a side
 * that narrows a value narrows what follows it, as TypeScript narrows it. */
export function splits(s: Scope, test: N): boolean {
  if (test.type !== "LogicalExpression" || (test.operator !== "&&" && test.operator !== "||")) return false;
  const narrows = (side: N): boolean => {
    if (side.type === "LogicalExpression" && side.operator === test.operator) return splits(s, side);
    try {
      return presence(s, side) !== null;
    } catch (e) {
      if (e instanceof GenError) return false;
      throw e;
    }
  };
  return narrows(test.left) || narrows(test.right);
}

/** `a && b ? x : y` as `a ? (b ? x : y) : y`, and `a || b ? x : y` as `a ? x : (b ? x : y)`. */
export function split(n: N): N {
  const { left, right, operator } = n.test;
  const inner = { ...n, test: right };
  return operator === "&&" ? { ...n, test: left, consequent: inner, alternate: n.alternate } : { ...n, test: left, consequent: n.consequent, alternate: inner };
}
