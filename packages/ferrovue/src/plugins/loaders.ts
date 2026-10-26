import { type Component, type N, type Scope, type Ty, type Val, absence, distinctFields, enumOf, fail, nothing, rustStr, sameTy, snake } from "../model.ts";
import { GenError } from "../errors.ts";
import { ctx } from "../context.ts";
import { type Declared } from "../constants.ts";
import { resolveImport } from "../resolve.ts";
import { bareDates, datePlan, lookupStruct, markHome, readTypeFile, tyOfTs } from "../typescript.ts";
import { coerce, describeTy, expr, fieldVal } from "../expr.ts";
import { heldDates } from "../lists.ts";
import { atom, bare } from "../parens.ts";
import { header, rustTy } from "../rust.ts";
import { type Plugin, runOf, scopeOf } from "../plugin.ts";

interface LoaderParam {
  js: string;
  rust: string;
  ty: Ty;
  /** The argument may be left out, or given as `undefined`: `loadKey` leaves it out of the key
   * when no argument after it is given. */
  undefined: boolean;
  /** For a parameter typed as an interface of a `.ts` file: its fields, each written into the key
   * by its name, in the order JavaScript sorts the names. */
  fields?: LoaderParam[];
  /** The struct of the loader's module that holds such a parameter. */
  struct?: string;
}

interface Loader {
  name: string;
  file: string;
  struct: string;
  method: string;
  params: LoaderParam[];
  out: Ty;
  node: N;
  home: Component;
}

interface LoadersRun {
  loaders: Map<string, Loader>;
  readers: Set<Component>;
}

interface LoadersScope {
  /** Each name a loader is imported as: its declaration, read when the component awaits it. */
  locals: Map<string, { d: Declared; file: string }>;
  count: number;
}

const CLIENT_MODULE = "ferrovue";
const ARG_TYS = new Set(["str", "int", "float", "bool"]);
const SHAPE = "a loader is `export const loadPost = defineLoader(\"loadPost\", async (id: number): Promise<Post> => …)`";

function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The local name `file` imports `defineLoader` by, if it does. */
function defineLoaderName(body: N[]): string | null {
  for (const st of body) {
    if (st.type !== "ImportDeclaration" || st.source.value !== CLIENT_MODULE || st.importKind === "type") continue;
    for (const sp of st.specifiers) {
      if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "defineLoader" && sp.importKind !== "type") return sp.local.name;
    }
  }
  return null;
}

function isLoader(d: Declared, file: string): boolean {
  const local = defineLoaderName(ctx.tsModules.get(file)?.body ?? []);
  const init = d.node.type === "VariableDeclarator" ? d.node.init : null;
  return local !== null && init?.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === local;
}

function loaderOf(d: Declared, file: string): Loader {
  const init = d.node.init;
  const home = d.home;
  const known = runOf(loaders).loaders;
  const cached = [...known.values()].find((l) => l.node === d.node);
  if (cached) return cached;
  const [id, fn] = init.arguments;
  if (id?.type !== "StringLiteral" || !/^[A-Za-z_$][\w$]*$/.test(id.value) || init.arguments.length !== 2) {
    fail(home, "FV2002", `${SHAPE}: its name is a string literal that is a JavaScript name, and it takes the function as the only other argument`, init);
  }
  if ((fn?.type !== "ArrowFunctionExpression" && fn?.type !== "FunctionExpression") || !fn.async) fail(home, "FV2002", `${SHAPE}: the loader is an \`async\` function`, fn ?? init);
  const ret = fn.returnType?.typeAnnotation;
  const inner = ret?.type === "TSTypeReference" && ret.typeName.type === "Identifier" && ret.typeName.name === "Promise" ? ret.typeParameters?.params?.[0] : null;
  if (!inner) fail(home, "FV2004", `loader \`${id.value}\` declares what it returns: \`async (…): Promise<T> => …\``, fn);
  const out = markHome(tyOfTs(home, inner, ctx.typeStructs), "types");
  if (nothing(out)) fail(home, "FV2004", `loader \`${id.value}\` returns ${describeTy(out)}, which the payload cannot carry: return a value, or \`null\` for none`, inner);
  if (absence(out) === "undefined" || absence(out) === "either") {
    fail(home, "FV2004", `loader \`${id.value}\` may return \`undefined\`, which \`JSON.stringify\` drops from the payload: return \`null\` for none`, inner);
  }
  const params = distinctFields((fn.params as N[]).map((p): LoaderParam => {
    const t = p.type === "Identifier" ? p.typeAnnotation?.typeAnnotation : null;
    if (!t) fail(home, "FV2003", `loader \`${id.value}\` takes plain, typed parameters, \`(id: number, lang?: string)\`: no defaults, \`...rest\` or destructuring`, p);
    const refuse = (what: string): never =>
      fail(home, "FV2003", `parameter \`${p.name}\` of loader \`${id.value}\` is ${what}: a loader takes strings, numbers and booleans, which may be optional or \`null\`, as its key is the arguments as JSON`, p);
    let ty: Ty;
    try {
      ty = tyOfTs(home, t, ctx.typeStructs);
    } catch (e) {
      if (!(e instanceof GenError)) throw e;
      return refuse("a type the compiler does not translate");
    }
    if (ty.k === "struct" && !p.optional) {
      const st = lookupStruct(home, ty).st;
      const fields = (st?.fields ?? []).map((f): LoaderParam => {
        const of = f.ty.k === "opt" ? f.ty.of : f.ty;
        if (!ARG_TYS.has(of.k) || absence(f.ty) === "either" || enumOf(f.ty) !== undefined) refuse(`an object whose field \`${f.js}\` is ${describeTy(f.ty)}`);
        return { js: f.js, rust: f.rust, ty: f.ty, undefined: absence(f.ty) === "undefined" };
      });
      if (!fields.length) refuse(describeTy(ty));
      return { js: p.name, rust: snake(p.name), ty, undefined: false, fields: fields.toSorted((a, b) => (a.js < b.js ? -1 : a.js > b.js ? 1 : 0)), struct: `${pascal(id.value)}${pascal(p.name)}` };
    }
    if (p.optional && ty.k !== "opt") ty = { k: "opt", of: ty };
    const of = ty.k === "opt" ? ty.of : ty;
    if (!ARG_TYS.has(of.k) || absence(ty) === "either") refuse(describeTy(ty));
    return { js: p.name, rust: snake(p.name), ty, undefined: p.optional === true || absence(ty) === "undefined" };
  }));
  const loader: Loader = { name: id.value, file, struct: pascal(id.value), method: snake(id.value), params, out, node: d.node, home };
  const clash = known.get(id.value);
  if (clash) fail(home, "FV2005", `two loaders are called \`${id.value}\`: this one and the one in ${clash.home.file}; a loader's name is its key in the payload, so rename one`, init);
  const sameStruct = [...known.values()].find((l) => l.struct === loader.struct || l.method === loader.method);
  if (sameStruct) {
    const both = sameStruct.method === loader.method ? `the method \`${loader.method}\`` : `the struct \`${loader.struct}\``;
    fail(home, "FV2005", `loaders \`${id.value}\` and \`${sameStruct.name}\` would both be ${both} in the generated \`loaders\` module; rename one`, init);
  }
  known.set(id.value, loader);
  return loader;
}

function callOf(s: Scope, n: N): { loader: Loader; args: N[] } | null {
  const own = scopeOf(loaders, s);
  const call = n?.type === "AwaitExpression" ? n.argument : null;
  if (call?.type !== "CallExpression" || call.callee.type !== "Identifier") return null;
  const found = own.locals.get(call.callee.name);
  return found ? { loader: loaderOf(found.d, found.file), args: call.arguments } : null;
}

function argCode(s: Scope, loader: Loader, p: LoaderParam, n: N | undefined, at: number, call: N): string {
  if (n === undefined) {
    if (p.undefined) return "None";
    fail(s.comp, "FV2006", `\`${loader.name}\` takes \`${p.js}\`, which the call does not give`, call);
  }
  if (n.type === "SpreadElement") fail(s.comp, "FV2006", `an argument of \`${loader.name}\` spread from a list, whose length the compiler does not know: give each argument`, n);
  if (p.fields !== undefined) return objectArg(s, loader, p, n, at);
  const v: Val = expr({ ...s, settingUpAt: at }, n);
  const want = p.ty;
  const wrong = (): never => fail(s.comp, "FV2006", `\`${p.js}\` of \`${loader.name}\` is ${describeTy(want)}, and the call gives ${describeTy(v.ty)}`, n);
  if (want.k === "opt" && nothing(v.ty)) {
    if (absence(v.ty) !== absence(want) && absence(v.ty) !== null) {
      fail(s.comp, "FV2006", `\`${p.js}\` of \`${loader.name}\` is ${describeTy(want)}, and the call gives ${describeTy(v.ty)}, which the key would write as another argument`, n);
    }
    return "None";
  }
  if (want.k === "str") return v.ty.k === "str" ? `String::from(${bare(v.code)})` : wrong();
  if (want.k === "opt" && want.of.k === "str") {
    if (v.ty.k === "str") return `Some(String::from(${bare(v.code)}))`;
    if (v.ty.k === "opt" && v.ty.of.k === "str" && absence(v.ty) === absence(want)) return `${atom(v.code)}.map(String::from)`;
    return wrong();
  }
  if (v.ty.k === "opt" && absence(v.ty) !== absence(want)) wrong();
  try {
    return coerce(s.comp, v, want, n);
  } catch (e) {
    if (e instanceof GenError) wrong();
    throw e;
  }
}

function objectArg(s: Scope, loader: Loader, p: LoaderParam, n: N, at: number): string {
  const fields = p.fields!;
  if (n.type === "ObjectExpression") {
    const given = new Map<string, N>();
    for (const q of n.properties) {
      if (q.type !== "ObjectProperty" || q.computed) fail(s.comp, "FV2006", `\`${p.js}\` of \`${loader.name}\` is an object of plain keys: \`{ slug: props.slug }\``, q);
      const key: string = q.key.type === "Identifier" ? q.key.name : String(q.key.value);
      if (!fields.some((f) => f.js === key)) fail(s.comp, "FV2006", `\`${p.js}\` of \`${loader.name}\` has no field \`${key}\``, q);
      given.set(key, q.value);
    }
    const inits = fields.map((f) => `${f.rust}: ${argCode(s, loader, f, given.get(f.js), at, n)}`);
    return `super::loaders::${p.struct!} { ${inits.join(", ")} }`;
  }
  const v = expr({ ...s, settingUpAt: at }, n);
  if (v.ty.k !== "struct" || !sameTy(markHome(v.ty, "types"), markHome(p.ty, "types"))) {
    fail(s.comp, "FV2006", `\`${p.js}\` of \`${loader.name}\` is ${describeTy(p.ty)}, and the call gives ${describeTy(v.ty)}`, n);
  }
  const inits = fields.map((f) => {
    const read = fieldVal(s.comp, v.code, v.ty, f.js, n);
    const of = f.ty.k === "opt" ? f.ty.of : f.ty;
    const code = of.k === "str" ? (f.ty.k === "opt" ? `${atom(read.code)}.map(String::from)` : `String::from(${bare(read.code)})`) : bare(read.code);
    return `${f.rust}: ${code}`;
  });
  return `super::loaders::${p.struct!} { ${inits.join(", ")} }`;
}

/** `let Some(s_x) = fv_loads.get(…) else { return Ok(()); };`: the component stops where Vue's server
 * awaits, until `load` has the result. */
function callValue(s: Scope, loader: Loader, args: N[], at: number, call: N): string {
  if (args.length > loader.params.length) fail(s.comp, "FV2006", `\`${loader.name}\` takes ${loader.params.length} argument${loader.params.length === 1 ? "" : "s"}, and the call gives ${args.length}`, call);
  const fields = loader.params.map((p, i) => {
    const code = argCode(s, loader, p, args[i], at, call);
    return code === p.rust ? p.rust : `${p.rust}: ${code}`;
  });
  runOf(loaders).readers.add(s.comp);
  return `super::loaders::${loader.struct}${fields.length ? ` { ${fields.join(", ")} }` : ""}`;
}

function awaitLet(s: Scope, loader: Loader, args: N[], at: number, call: N, lets: string[]): string {
  const value = callValue(s, loader, args, at, call);
  const name = `l_${scopeOf(loaders, s).count++}`;
  lets.push(`let Some(${name}) = fv_loads.get(${value}) else { return Ok(()); };`);
  return name;
}

/** The loaders' calls of \`await Promise.all([…])\`, each asked for before the component stops
 * where the first result is missing, as Vue's server starts them all at once. */
function allOf(s: Scope, n: N): { loader: Loader; args: N[]; call: N }[] | null {
  const call = n?.type === "AwaitExpression" ? n.argument : null;
  const callee = call?.type === "CallExpression" ? call.callee : null;
  if (callee?.type !== "MemberExpression" || callee.object.type !== "Identifier" || callee.object.name !== "Promise" || callee.computed || callee.property.name !== "all") return null;
  const [list] = call.arguments;
  if (call.arguments.length !== 1 || list?.type !== "ArrayExpression") fail(s.comp, "FV2001", "`Promise.all` awaits an array literal of loaders' calls: `await Promise.all([loadPost(slug), loadViews(slug)])`", call);
  const own = scopeOf(loaders, s);
  return list.elements.map((el: N) => {
    const found = el?.type === "CallExpression" && el.callee.type === "Identifier" ? own.locals.get(el.callee.name) : undefined;
    if (found === undefined) fail(s.comp, "FV2001", "only loaders' results are awaited on the server, and `Promise.all` takes their calls: declare each function with `defineLoader`", el ?? list);
    return { loader: loaderOf(found.d, found.file), args: el.arguments, call: el };
  });
}

function awaitAll(s: Scope, calls: { loader: Loader; args: N[]; call: N }[], at: number, lets: string[], bound: (i: number) => boolean): string[] {
  const own = scopeOf(loaders, s);
  const names = calls.map(({ loader, args, call }) => {
    const name = `l_${own.count++}`;
    lets.push(`let ${name} = fv_loads.get(${callValue(s, loader, args, at, call)});`);
    return name;
  });
  if (names.length) lets.push(`let (${names.map((n, i) => `Some(${bound(i) ? n : "_"})`).join(", ")}${names.length === 1 ? "," : ""}) = (${names.join(", ")}${names.length === 1 ? "," : ""}) else { return Ok(()); };`);
  return names;
}

/** The result `name` holds, `&Output`, as the value the template reads. */
function resultVal(name: string, ty: Ty): Val {
  const dated = heldDates(name, ty, true);
  if (dated !== null) return dated;
  if (ty.k === "str") return { code: `&**${name}`, ty };
  if (ty.k === "int" || ty.k === "float" || ty.k === "bool") return { code: `*${name}`, ty };
  if (ty.k === "opt" && ty.of.k === "str") return { code: `${name}.as_deref()`, ty };
  if (ty.k === "opt" && (ty.of.k === "int" || ty.of.k === "float" || ty.of.k === "bool")) return { code: `*${name}`, ty };
  if (ty.k === "opt") return { code: `${name}.as_ref()`, ty };
  return { code: name, ty };
}

function staticTy(ty: Ty, home: Component): string {
  if (bareDates(ty)) {
    if (ty.k === "date") return "fv::date::JsDate";
    if (ty.k === "opt") return `Option<${staticTy(ty.of, home)}>`;
    if (ty.k === "list") return `Vec<${staticTy(ty.of, home)}>`;
    if (ty.k === "record") return `fv::props::Record<'static, ${staticTy(ty.of, home)}>`;
  }
  return rustTy(ty, home).replace(/\bCow<'a, /g, "std::borrow::Cow<'static, ").replace(/'a\b/g, "'static");
}

function argTy(ty: Ty): string {
  const of = ty.k === "opt" ? ty.of : ty;
  const one = of.k === "str" ? "String" : of.k === "int" ? "i64" : of.k === "float" ? "f64" : "bool";
  return ty.k === "opt" ? `Option<${one}>` : one;
}

function objectSource(l: Loader): string {
  return l.params
    .filter((p) => p.fields !== undefined)
    .map((p) => `/// \`${p.js}\` of a call of \`${l.name}\`, in ${l.home.file}: its fields.
#[derive(Debug, Clone, PartialEq)]
pub struct ${p.struct!} {
${p.fields!.map((f) => `    pub ${f.rust}: ${argTy(f.ty)},`).join("\n")}
}

`)
    .join("");
}

function objectKey(p: LoaderParam): string {
  const fields = p.fields!.map((f) =>
    f.undefined ? `        if let Some(v) = &self.${p.rust}.${f.rust} {\n            key.field(${rustStr(f.js)}, v);\n        }` : `        key.field(${rustStr(f.js)}, &self.${p.rust}.${f.rust});`,
  );
  return `        key.object();\n${fields.join("\n")}\n        key.end();`;
}

function loaderSource(l: Loader, home: Component): string {
  const fields = l.params.map((p) => `    pub ${p.rust}: ${p.struct ?? argTy(p.ty)},`).join("\n");
  const firstOptional = l.params.findIndex((_, i) => l.params.slice(i).every((q) => q.undefined));
  const args = l.params
    .map((p, i) => {
      if (p.fields !== undefined) return objectKey(p);
      const push = `key.arg(&self.${p.rust});`;
      if (firstOptional < 0 || i < firstOptional) return `        ${push}`;
      const given = l.params.slice(i).map((q) => `self.${q.rust}.is_some()`).join(" || ");
      return `        if ${given} {\n            ${push}\n        }`;
    })
    .join("\n");
  const plan = datePlan(home, l.out);
  const dates = plan === null ? "" : `\n    const DATES: &'static str = ${rustStr(plan)};`;
  if (plan !== null) ctx.datePlans.loaders.set(l.name, plan);
  return `${objectSource(l)}/// A call of \`${l.name}\`, in ${l.home.file}: its arguments.
#[derive(Debug, Clone, PartialEq)]
pub struct ${l.struct}${fields ? ` {\n${fields}\n}` : ";"}

impl fv::loaders::Load for ${l.struct} {
    const NAME: &'static str = ${rustStr(l.name)};
    type Output = ${staticTy(l.out, home)};${dates}
    fn args(&self, ${args ? `key: &mut fv::loaders::LoadKey) {\n${args}\n    }` : "_key: &mut fv::loaders::LoadKey) {}"}
}
`;
}

function loadersSource(): string {
  const all = [...runOf(loaders).loaders.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  const home = { ...all[0]!.home, module: "loaders" };
  const files = [...new Set(all.map((l) => l.home.file))].toSorted();
  const structs = all.map((l) => loaderSource(l, home)).join("\n");
  const methods = all
    .map(
      (l) => `    /// \`${l.name}\`, in ${l.home.file}.
    fn ${l.method}(&self, call: ${l.struct}) -> impl std::future::Future<Output = Result<<${l.struct} as fv::loaders::Load>::Output, Self::Error>> + Send;`,
    )
    .join("\n\n");
  const arms = all.map((l) => `        <${l.struct} as fv::loaders::Load>::NAME => call.run(|c: ${l.struct}| loaders.${l.method}(c)),`).join("\n");
  const fixtures = all
    .map(
      (l) => `        <${l.struct} as fv::loaders::Load>::NAME => call.run(|c: ${l.struct}| {
            let found = results.get(&fv::loaders::load_key(&c)).ok_or_else(|| format!("the fixture has no result for {}", fv::loaders::load_key(&c))).and_then(|raw| serde_json::from_str::<<${l.struct} as fv::loaders::Load>::Output>(raw.get()).map_err(|e| e.to_string()));
            async move { found }
        }),`,
    )
    .join("\n");
  return `${header(files.join(", "), "the loaders")}
//! The loaders components await in \`<script setup>\`: a struct for each one's call, and the
//! [\`Loaders\`] trait the app implements to run them.

use ferrovue as fv;

${structs}
/// The app's loaders: one method for each \`defineLoader\`, given its call, returning what the
/// client's loader returns. A method that fails fails the render, with [\`fv::loaders::LoadError\`].
pub trait Loaders: Sync {
    /// What a loader fails with.
    type Error;

${methods}
}

/// Run \`call\` with the loader of its name.
pub fn dispatch<'a, L: Loaders>(loaders: &'a L, call: fv::loaders::LoadCall) -> fv::loaders::LoadFuture<'a, L::Error> {
    match call.name() {
${arms}
        name => unreachable!("no loader is called \`{name}\`"),
    }
}

/// Render with \`loaders\`: [\`fv::loaders::load\`], each call run by its method of [\`Loaders\`]. Write the
/// payload with [\`fv::loaders::Loads::script_into\`] after the components, for the client to hydrate from.
pub async fn load<L: Loaders, T>(loaders: &L, render: impl FnMut(&fv::loaders::Loads<'_>) -> T) -> Result<T, fv::loaders::LoadError<L::Error>> {
    fv::loaders::load(render, |call| dispatch(loaders, call)).await
}

/// Each call answered from a fixture's \`$loads\`, by its key.
#[cfg(test)]
pub fn from_fixture(results: &std::collections::HashMap<String, Box<serde_json::value::RawValue>>) -> impl FnMut(fv::loaders::LoadCall) -> fv::loaders::LoadFuture<'static, String> + '_ {
    move |call| match call.name() {
${fixtures}
        name => unreachable!("no loader is called \`{name}\`"),
    }
}
`;
}

export const loaders: Plugin<LoadersRun, LoadersScope> = {
  name: "loaders",
  configure: () => ({ loaders: new Map(), readers: new Set() }),
  scope: () => ({ locals: new Map(), count: 0 }),
  scriptImport(s, st, from) {
    if (st.importKind === "type" || from.endsWith(".vue")) return false;
    const file = resolveImport(s.comp.file, from);
    if (file === null) return false;
    readTypeFile(file);
    const decls = ctx.constDecls.get(file);
    for (const sp of st.specifiers) {
      if (sp.type !== "ImportSpecifier" || sp.importKind === "type") continue;
      const d = decls?.get(sp.imported.name ?? sp.imported.value);
      if (d?.exported && isLoader(d, file)) scopeOf(loaders, s).locals.set(sp.local.name, { d, file });
    }
    return false;
  },
  scriptBinding(s, d, lets) {
    const init = d.init;
    const all = allOf(s, init);
    if (all !== null) {
      if (d.id.type !== "ArrayPattern" || d.id.elements.length > all.length || d.id.elements.some((el: N) => el !== null && el.type !== "Identifier")) {
        fail(s.comp, "FV2007", "the results of `Promise.all` are bound to an array of plain names, one for each call: `const [post, views] = await Promise.all([…])`", d.id);
      }
      const names = awaitAll(s, all, d.start, lets, (i) => (d.id.elements[i] ?? null) !== null);
      d.id.elements.forEach((el: N, i: number) => {
        if (el !== null) s.setup.set(el.name, resultVal(names[i]!, all[i]!.loader.out));
      });
      return true;
    }
    const call = callOf(s, init);
    if (!call) {
      if (init?.type !== "AwaitExpression") return false;
      let err: GenError | null = null;
      try {
        fail(s.comp, "FV2001", "only a loader's result is awaited on the server: declare the function with `defineLoader`", init);
      } catch (e) {
        if (!(e instanceof GenError)) throw e;
        err = e;
      }
      const what = "it awaits a value that is not a loader's result, which the server does not have: declare the function with `defineLoader`";
      for (const name of d.id.type === "Identifier" ? [d.id.name] : []) {
        s.clientOnly.set(name, what);
        s.refusedBy.set(name, err);
      }
      return d.id.type === "Identifier";
    }
    const { loader, args } = call;
    const name = awaitLet(s, loader, args, d.start, init.argument, lets);
    const result = resultVal(name, loader.out);
    if (d.id.type === "Identifier") {
      s.setup.set(d.id.name, result);
      return true;
    }
    if (d.id.type !== "ObjectPattern" || loader.out.k !== "struct") {
      fail(s.comp, "FV2007", `the result of \`${loader.name}\` is bound to a name, or destructured into the fields of the object it returns: \`const { title } = await ${loader.name}(…)\``, d.id);
    }
    for (const p of d.id.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
        fail(s.comp, "FV2007", `the result of \`${loader.name}\` is destructured into plain names: \`{ title, tags: labels }\`, with no defaults, \`...rest\` or nesting`, p);
      }
      const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
      s.setup.set(p.value.name, fieldVal(s.comp, result.code, loader.out, key, p));
    }
    return true;
  },
  scriptStatement(s, st, lets) {
    const all = allOf(s, st.expression);
    if (all !== null) {
      awaitAll(s, all, st.start, lets, () => false);
      return true;
    }
    const call = callOf(s, st.expression);
    if (!call) return false;
    awaitLet(s, call.loader, call.args, st.start, st.expression.argument, lets);
    return true;
  },
  params: [
    {
      name: "fv_loads",
      ty: "&fv::loaders::Loads<'_>",
      pageTy: "&'p fv::loaders::Loads<'p>",
      reads: (c) => runOf(loaders).readers.has(c),
      test: {
        lines: [],
        arg: "fv_loads",
        fixture: true,
        around: (render) => [
          "let loading = ferrovue::loaders::load(",
          "    |fv_loads| {",
          "        out.clear();",
          ...render.split("\n").map((l) => `        ${l}`),
          "    },",
          "    loaders::from_fixture(&fixture.loads),",
          ");",
          "let mut cx = std::task::Context::from_waker(std::task::Waker::noop());",
          "match std::future::Future::poll(std::pin::pin!(loading), &mut cx) {",
          "    std::task::Poll::Ready(done) => done.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?,",
          '    std::task::Poll::Pending => return Err(String::from("a fixture\'s loader is still running")),',
          "}",
        ],
      },
      fixtureField: '    #[serde(rename = "$loads", default)]\n    loads: std::collections::HashMap<String, Box<serde_json::value::RawValue>>,',
    },
  ],
  modules: () => (runOf(loaders).loaders.size ? [["loaders.rs", loadersSource()]] : []),
};
