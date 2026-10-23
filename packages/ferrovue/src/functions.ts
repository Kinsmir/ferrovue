import { type Component, type Fn, type N, type Scope, type Val, fail, GenError, placeOf } from "./model.ts";
import type { Const } from "./constants.ts";
import { constOfDecl } from "./constants.ts";
import { ctx } from "./context.ts";
import { expr, typedBy } from "./expr.ts";
import { bodyExpr, bound, destructured } from "./blocks.ts";
import { readTypeFile } from "./typescript.ts";
import { resolveImport } from "./resolve.ts";

const FUNCTION_INITS = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

/** The function a declaration declares: `function f() {}`, or `const f = (…) => …`. */
export function functionOf(st: N): { name: string; node: N } | null {
  if (st?.type === "FunctionDeclaration" && st.id) return { name: st.id.name, node: st };
  if (st?.type === "VariableDeclarator" && st.id.type === "Identifier" && FUNCTION_INITS.has(st.init?.type)) return { name: st.id.name, node: st.init };
  return null;
}

/** The functions a `.ts` file declares at its top level, exported or not. */
export function declareFunctions(home: Component, body: N[], file: string): Map<string, { fn: Fn; exported: boolean }> {
  const found = new Map<string, { fn: Fn; exported: boolean }>();
  for (const st of body) {
    if (st.type === "ExportDefaultDeclaration" && (st.declaration.type === "FunctionDeclaration" || FUNCTION_INITS.has(st.declaration.type))) {
      found.set("default", { fn: { name: st.declaration.id?.name ?? "default", node: st.declaration, home, file }, exported: true });
      continue;
    }
    const exported = st.type === "ExportNamedDeclaration";
    const d = exported ? st.declaration : st;
    const decls: N[] = d?.type === "VariableDeclaration" && d.kind === "const" ? d.declarations : [d];
    for (const x of decls) {
      const f = functionOf(x);
      if (f) found.set(f.name, { fn: { name: f.name, node: f.node, home, file }, exported });
    }
  }
  return found;
}

interface Module {
  home: Component;
  consts: Map<string, Const>;
  functions: Map<string, Fn>;
  clientOnly: Map<string, string>;
  refusedBy: Map<string, GenError>;
}

const modules = new WeakMap<object, Module>();

function moduleOf(file: string): Module {
  const read = ctx.tsModules.get(file)!;
  const done = modules.get(read);
  if (done) return done;
  const m: Module = { home: read.home, consts: new Map(), functions: new Map(), clientOnly: new Map(), refusedBy: new Map() };
  modules.set(read, m);
  const constant = (local: string, d: Parameters<typeof constOfDecl>[0], where: string): void => {
    try {
      m.consts.set(local, constOfDecl(d));
    } catch (e) {
      if (!(e instanceof GenError)) throw e;
      m.clientOnly.set(local, `${where}, where it is not a constant the compiler evaluates: ${e.message.split("\n")[0]!}`);
      m.refusedBy.set(local, e);
    }
  };
  for (const [name, { fn }] of read.functions) {
    m.functions.set(name, fn);
    m.clientOnly.set(name, `it is a function of ${read.home.file}, which a template or a function may call, but not read as a value`);
  }
  for (const [name, d] of ctx.constDecls.get(file) ?? []) if (!m.functions.has(name)) constant(name, d, `it is declared in ${read.home.file}`);
  for (const st of read.body) {
    if (st.type !== "ImportDeclaration" || st.importKind === "type") continue;
    const from = resolveImport(read.home.file, st.source.value);
    if (from !== null) readTypeFile(from);
    const other = from !== null ? ctx.tsModules.get(from) : undefined;
    for (const sp of st.specifiers) {
      if (sp.importKind === "type") continue;
      const imported: string = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : "default";
      const f = other?.functions.get(imported);
      const d = from !== null ? ctx.constDecls.get(from)?.get(imported) : undefined;
      if (f?.exported) m.functions.set(sp.local.name, f.fn);
      else if (d?.exported && sp.type === "ImportSpecifier") constant(sp.local.name, d, `it is imported from ${other!.home.file}`);
      else m.clientOnly.set(sp.local.name, `it is imported from \`${st.source.value}\`, which the server does not run`);
    }
  }
  return m;
}

/** What a function's body sees: its own module's names, and none of the call site's. */
function calleeScope(s: Scope, fn: Fn): Scope {
  if (fn.captured) return { ...fn.captured, within: "function", mapping: undefined, frame: undefined };
  if (fn.file === null) return { ...s, locals: new Map(), narrowed: new Map(), within: "function", mapping: undefined, lets: undefined, frame: undefined };
  const m = moduleOf(fn.file);
  return {
    ...s,
    comp: { ...s.comp, file: m.home.file, ...(m.home.source !== undefined ? { source: m.home.source } : {}) },
    setup: new Map(),
    locals: new Map(),
    narrowed: new Map(),
    settingUpAt: undefined,
    within: "function",
    mapping: undefined,
    lets: undefined,
    frame: undefined,
    typesFrom: m.home,
    helpers: new Map(),
    clientOnly: m.clientOnly,
    refusedBy: m.refusedBy,
    propsIdent: null,
    refs: new Set(),
    consts: m.consts,
    functions: m.functions,
    children: new Map(),
    attrsBindings: new Set(),
    slotsBindings: new Set(),
  };
}

const active: Fn[] = [];

const annotation = (p: N): N => (p?.type === "AssignmentPattern" ? p.left : p)?.typeAnnotation?.typeAnnotation;

let temps = 0;

/** A call of a function the server translates: its arguments evaluated in order at the call, each
 * bound once, then its body, with JavaScript's defaults for what is not passed. */
export function callFunction(s: Scope, name: string, fn: Fn, args: N[], n: N): Val {
  const comp = s.comp;
  const node = fn.node;
  const what = `\`${name}()\``;
  if (node.async || node.generator) fail(comp, "FV1907", `${what} is ${node.async ? "`async`, and returns a promise" : "a generator, and returns an iterator"}, which a render cannot wait on or walk`, n);
  const params: N[] = node.params;
  const rest = params.find((p) => p.type === "RestElement" || p.type === "TSParameterProperty");
  if (rest) fail(comp, "FV1907", `${what} takes \`...rest\` parameters, which the server does not collect: give each a name of its own`, n);
  const spread = args.find((a) => a.type === "SpreadElement");
  if (spread) fail(comp, "FV1907", `${what} given \`...\` arguments, which the server does not spread: pass each argument by itself`, spread);
  if (args.length > params.length) fail(comp, "FV1907", `${what} takes ${params.length} argument${params.length === 1 ? "" : "s"}, and is given ${args.length}`, n);
  if (fn.tdzUntil !== undefined && s.settingUpAt !== undefined && s.settingUpAt < fn.tdzUntil) {
    fail(comp, "FV1908", `${what} is called while setup runs, before \`const ${fn.name}\` is declared, where JavaScript throws a \`ReferenceError\`: declare it above, or with \`function\`, which is hoisted`, n);
  }
  if (active.includes(fn)) {
    const via = active.slice(active.indexOf(fn) + 1).map((f) => `\`${f.name}()\``);
    fail(comp, "FV1906", `${what} calls itself${via.length ? `, through ${via.join(", ")}` : ""}, which the server would inline without end: compute the value in Rust and pass it as a prop`, n);
  }
  const home = fn.file === null ? undefined : fn.home;
  const given = args.map((a, i) => {
    const t = annotation(params[i]);
    return expr(s, t ? typedBy(a, t, true, home) : a);
  });
  const names = given.map(() => `arg#${++temps}`);
  const cs = calleeScope(s, fn);
  active.push(fn);
  try {
    const t = node.returnType?.typeAnnotation;
    const body0 = bodyExpr(fn.home, node);
    let body: N = t ? typedBy(body0, t, true, home) : body0;
    for (let i = params.length - 1; i >= 0; i--) body = param(fn.home, params[i], i < given.length ? { v: given[i]!, name: names[i]! } : null, body);
    const run = (i: number, inner: Scope): Val => (i === given.length ? expr(inner, body) : bound(inner, names[i]!, given[i]!, (next) => run(i + 1, next)));
    return run(0, cs);
  } catch (e) {
    if (!(e instanceof GenError) || e.code === "FV1906" || e.code === "FV1907" || e.code === "FV1908") throw e;
    const at = placeOf(comp, n);
    const said = `${e.what} (in ${what}, called at ${[at.file, at.line, at.column].filter((p) => p !== undefined).join(":")})`;
    const inner = new GenError(e.code, e.message.replace(e.what, () => said), e.at, said, e.help);
    inner.readAt = e.readAt ?? (e.at?.file !== comp.file ? at : null);
    throw inner;
  } finally {
    active.pop();
  }
}

function param(home: Component, p: N, arg: { v: Val; name: string } | null, body: N): N {
  const ref = (): N => (arg ? { type: "Identifier", name: arg.name, loc: p.loc, __fv: p.__fv } : { type: "Identifier", name: "undefined", loc: p.loc, __fv: p.__fv });
  if (p.type !== "AssignmentPattern") return destructured(home, p, ref(), body);
  const none = arg === null || arg.v.ty.k === "undef" ? "missing" : arg.v.ty.k === "opt" ? (arg.v.ty.none ?? "undefined") : null;
  if (none === "either") fail(home, "FV1907", "a default for a parameter given a value that may be `null` or `undefined`, which its Rust `Option` cannot tell apart, though only `undefined` takes the default: give it a fallback with `??` where it is passed", p);
  const value = none === "missing" ? p.right : none === "undefined" ? { type: "LogicalExpression", operator: "??", left: ref(), right: p.right, loc: p.loc, __fv: p.__fv } : ref();
  return destructured(home, p.left, value, body);
}
