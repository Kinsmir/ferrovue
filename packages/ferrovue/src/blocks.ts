import { type Component, type N, type Scope, type Val, fail, GenError, nothing } from "./model.ts";
import { ctx } from "./context.ts";
import { expr, typedBy } from "./expr.ts";
import { collected, heldList } from "./lists.ts";
import { atom, bare, occurrences, operand, UNARY } from "./parens.ts";
import { presence } from "./narrowing.ts";
import { asCow, heldStr, isTemporary } from "./strings.ts";
import { intFromF64 } from "./numbers.ts";

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
}

const LOOPS: Record<string, string> = {
  ForStatement: "a `for` loop",
  ForOfStatement: "a `for…of` loop",
  ForInStatement: "a `for…in` loop",
  WhileStatement: "a `while` loop",
  DoWhileStatement: "a `do…while` loop",
};

const OTHERS: Record<string, string> = {
  TryStatement: "`try`, which only catches what the body throws",
  ThrowStatement: "`throw`, which ends the render with an error",
  LabeledStatement: "a labelled statement",
  ContinueStatement: "`continue`",
  FunctionDeclaration: "a function declared inside it",
  ClassDeclaration: "a class declared inside it",
  DebuggerStatement: "`debugger`",
  WithStatement: "`with`",
};

const SUBSET = "it holds `const` (and `let` never assigned again), `if` / `else`, `switch` and `return`";

function assignments(comp: Component, body: N[]): void {
  const lets = new Set<string>();
  const visit = (n: N): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (n.type === "VariableDeclaration" && n.kind === "let") for (const d of n.declarations) for (const name of patternNames(d.id)) lets.add(name);
    if (n.type === "AssignmentExpression" || n.type === "UpdateExpression") {
      const target = n.type === "AssignmentExpression" ? n.left : n.argument;
      const shown = `\`${n.operator}\``;
      if (target.type === "Identifier" && lets.has(target.name)) {
        fail(comp, "FV1902", `\`let ${target.name}\` is assigned again with ${shown}, which a function's body does not translate: give each value a \`const\` of its own`, n);
      }
      fail(comp, "FV1902", `an assignment (${shown}) changes a value, which a function's body does not translate: give each value a \`const\` of its own`, n);
    }
    for (const key of Object.keys(n)) if (!SKIP.has(key) && n[key] && typeof n[key] === "object") visit(n[key]);
  };
  visit(body);
}

/** How many times a body's statements may be translated again after an `if` or a `case` that
 * falls off its end: each such path continues with the statements after it, translated on its own,
 * so sequential `switch`es of `break`ing cases multiply them. */
export const PATH_BUDGET = 4096;

class Desugar {
  private readonly comp: Component;
  private paths = 0;

  constructor(comp: Component) {
    this.comp = comp;
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
          return st.argument;
        case "BreakStatement":
          if (st.label || brk === undefined) fail(this.comp, "FV1901", "`break` outside a `switch`'s case, which only a loop could take", st);
          this.dead(rest, "`break`");
          return this.go(brk, st);
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
          if (st.kind !== "const" && st.kind !== "let") fail(this.comp, "FV1901", `a function's body may not hold \`${st.kind}\`: declare the value with \`const\``, st);
          const body = this.run(rest, k, brk, st);
          return st.declarations.reduceRight((inner: N, d: N) => this.bind(d, inner), body);
        }
        case "ExpressionStatement":
          return fail(this.comp, "FV1901", `a function's body may not hold an expression statement (\`${st.expression.type}\`), whose value is dropped and which could only change something: ${SUBSET}`, st);
        default: {
          const what = LOOPS[st.type] ?? OTHERS[st.type] ?? `\`${st.type}\``;
          const why = LOOPS[st.type] ? `: ${SUBSET}; compute a list with \`.map()\`, \`.filter()\` or \`.reduce()\`` : `: ${SUBSET}`;
          return fail(this.comp, "FV1901", `a function's body may not hold ${what}${why}`, st);
        }
      }
    }
    return this.go(k, from);
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
    if (k.falls) fail(this.comp, "FV1904", "this case falls through into the next one, which runs its statements too: end it with `return` or `break`", k.falls);
    if (k.sts.length && ++this.paths > PATH_BUDGET) {
      fail(this.comp, "FV1905", `the body's \`if\`s and \`switch\`es continue with the statements after them on more than ${PATH_BUDGET} paths, each translated on its own: end the cases in \`return\`, or split the body into \`computed\`s`, from);
    }
    return this.run(k.sts, k.next, k.brk, from);
  }

  private bind(d: N, body: N): N {
    if (!d.init) fail(this.comp, "FV1901", `\`${d.id.fvName ?? d.id.name ?? "a pattern"}\` is declared without a value: give it one where it is declared`, d);
    const typed = d.id.typeAnnotation?.typeAnnotation;
    const init = typed ? typedBy(d.init, typed) : d.init;
    return this.pattern(d.id, init, body, d);
  }

  pattern(p: N, value: N, body: N, d: N): N {
    switch (p.type) {
      case "Identifier":
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
export function bodyExpr(comp: Component, fn: N): N {
  if (fn.body.type !== "BlockStatement") return fn.body;
  const done = desugared.get(fn);
  if (done) return done;
  assignments(comp, fn.body.body);
  const shadowed: Env = new Map();
  const renamed = new Renamer(comp).statements(fn.body.body, shadowed);
  const out = new Desugar(comp).run(renamed, null, undefined, fn.body.body.at(-1) ?? fn);
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
  return /^(?:&\*?|\*)?[A-Za-z_]\w*(?:\.\w+)*$/.test(v.code) || /^"(?:[^"\\]|\\.)*"$/.test(v.code) || /^-?\d[\w.]*$/.test(v.code);
}

function reps(v: Val): string[] {
  return [v.code, v.iter, v.held, v.f64, ...(v.format?.args ?? [])].filter((r): r is string => r !== undefined);
}

function ownedCow(v: Val): string {
  if (!isTemporary(v)) return `${COW}::Owned(${atom(v.code).replace(/^&\*?/, "")}.to_owned())`;
  const cow = asCow(v);
  return cow.startsWith(`${COW}::Owned(`) ? cow : `${COW}::Owned(${atom(cow)}.into_owned())`;
}

/** `const name = init` around `body`: the value `body` computes with `name` bound once, as a Rust
 * `let` in a block that hands out nothing borrowed from it. */
export function letIn(s: Scope, n: N): Val {
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
  const lead = `let ${uses ? name : "_"} = ${init};`;
  const block = (code: string): string => `{ ${lead} ${bare(code)} }`;
  const lone = body.lone ? { lone: true as const } : {};
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
