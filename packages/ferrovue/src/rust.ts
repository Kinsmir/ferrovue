/* The Rust source written for each component, and the modules beside them. */

import { parse as parseJs } from "@babel/parser";
import { basename } from "node:path";
import { type Component, type Field, type N, type Struct, type Ty, fail, GenError, rustStr, snake, tagAst } from "./model.ts";
import { allRoutes, type RouteDef, ctx } from "./context.ts";
import { lookupStruct } from "./typescript.ts";
import { childOf } from "./expr.ts";
import { Emitter } from "./emitter.ts";
import { extraParams, fieldInit, slotFieldBorrows, slotFieldTy, slotTypeName, statements, takesSlots } from "./template.ts";
import { storeHome } from "./stores.ts";
import { scopeFor } from "./script.ts";

export function needsLifetime(ty: Ty, comp: Component, seen: Set<string> = new Set()): boolean {
  switch (ty.k) {
    // A record's keys are strings.
    case "str":
    case "record":
      return true;
    case "opt":
    case "list":
      return needsLifetime(ty.of, comp, seen);
    case "struct": {
      // A struct that holds itself borrows only if something else in it does.
      if (seen.has(ty.name)) return false;
      const { st, owner } = lookupStruct(comp, ty);
      const inner = new Set(seen).add(ty.name);
      return !!st && st.fields.some((f) => needsLifetime(f.ty, owner, inner));
    }
    case "child": {
      const child = childOf(ty.name);
      return structLifetime(child.props, child);
    }
    // A configured type that borrows says so by naming the props' lifetime: `Trusted<'a>`.
    case "html":
      return ctx.trustedHtml?.includes("'a") ?? false;
    default:
      return false;
  }
}

export function structLifetime(st: Struct, comp: Component): boolean {
  return st.fields.some((f) => needsLifetime(f.ty, comp, new Set([st.name])));
}

export function rustTy(ty: Ty, comp: Component): string {
  switch (ty.k) {
    case "str":
      return "Cow<'a, str>";
    case "int":
      return "i64";
    case "float":
      return "f64";
    case "bool":
      return "bool";
    case "opt":
      return `Option<${rustTy(ty.of, comp)}>`;
    case "list":
      return `Vec<${rustTy(ty.of, comp)}>`;
    case "record":
      return `ferrovue::Record<'a, ${rustTy(ty.of, comp)}>`;
    case "struct": {
      const { st, owner, path } = lookupStruct(comp, ty);
      if (!st) throw new GenError(`no type \`${ty.name}\``);
      return `${path}${ty.name}${structLifetime(st, owner) ? "<'a>" : ""}`;
    }
    case "html":
      return ctx.trustedHtml!;
    case "child": {
      const child = childOf(ty.name);
      return `super::${child.module}::Props${structLifetime(child.props, child) ? "<'a>" : ""}`;
    }
    default:
      throw new GenError("no Rust type for `undefined`");
  }
}

/** A constructor parameter for a field of type \`ty\`, and how its argument becomes the field's
 * value: strings from anything that turns into a \`Cow\`, lists of them from any iterator. */
function param(ty: Ty, comp: Component, arg: string): { ty: string; value: string } {
  if (ty.k === "str") return { ty: "impl Into<Cow<'a, str>>", value: `${arg}.into()` };
  if (ty.k === "list" && ty.of.k === "str") {
    return { ty: "impl IntoIterator<Item = impl Into<Cow<'a, str>>>", value: `${arg}.into_iter().map(Into::into).collect()` };
  }
  return { ty: rustTy(ty, comp), value: arg };
}

/** \`new\` with every required field, and a chainable setter for each optional one, so building
 * props from Rust takes neither \`Cow\` nor \`None\`. */
function builderSource(st: Struct, comp: Component, life: string): string {
  const required = st.fields.filter((f) => f.ty.k !== "opt");
  const optional = st.fields.filter((f) => f.ty.k === "opt");
  const arg = (f: Field) => f.rust.replace(/^r#/, "");
  const params = required.map((f) => `${arg(f)}: ${param(f.ty, comp, arg(f)).ty}`).join(", ");
  const inits = st.fields
    .map((f) => (f.ty.k === "opt" ? `${f.rust}: None` : fieldInit(f.rust, param(f.ty, comp, arg(f)).value)))
    .join(", ");
  const setters = optional
    .filter((f) => f.rust !== "new")
    .map((f) => {
      const p = param((f.ty as Ty & { k: "opt" }).of, comp, arg(f));
      return `
    /// Set \`${f.js}\`, which is absent otherwise.
    pub fn ${f.rust}(mut self, ${arg(f)}: ${p.ty}) -> Self {
        self.${f.rust} = Some(${p.value});
        self
    }`;
    })
    .join("\n");
  const usesA = /'a/.test(params + setters);
  // A struct without strings has no lifetime for its constructor to name.
  const impl = life ? "impl<'a>" : usesA ? "impl<'a>" : "impl";
  return `${impl} ${st.name}${life} {
    /// ${st.name} with ${required.length ? "its required fields" : "nothing set"}${optional.length ? ", every optional one absent" : ""}.
${required.length > 7 ? "    // One argument per required field, however many the type declares.\n    #[allow(clippy::too_many_arguments)]\n" : ""}    pub fn new(${params}) -> Self {
        ${st.name} { ${inits} }
    }
${setters}
}
`;
}

export function structSource(st: Struct, comp: Component, doc: string): string {
  const life = structLifetime(st, comp) ? "<'a>" : "";
  const fields = st.fields
    .map((f) => {
      const attrs =
        f.ty.k === "opt"
          ? `    #[serde(rename = ${rustStr(f.js)}, default, skip_serializing_if = "Option::is_none")]`
          : `    #[serde(rename = ${rustStr(f.js)})]`;
      return `${attrs}\n    pub ${f.rust}: ${rustTy(f.ty, comp)},`;
    })
    .join("\n");
  /* `Deserialize` only for the conformance suite. Props go out as JSON and never come back in, and a
   * `Deserialize` in production would be a way to make a `TrustedHtml` value out of any string. */
  return `${doc}#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
pub struct ${st.name}${life} {
${fields}
}

${builderSource(st, comp, life)}
`;
}

export function header(source: string, edit = "the `.vue` file"): string {
  return `// @generated by ferrovue from ${source}. Do not edit: change ${edit} and run
// \`ferrovue\`.
`;
}

/** Rust expressions summing the lengths of the strings a value of type `ty` at `place` holds. */
export function textLen(comp: Component, place: string, ty: Ty, seen: Set<string> = new Set()): string[] {
  switch (ty.k) {
    case "str":
      return [`${place}.len()`];
    case "html":
      return [`fv::TrustedHtml::trusted_html(&${place}).len()`];
    case "opt":
      if (ty.of.k === "str") return [`${place}.as_deref().map_or(0, str::len)`];
      if (ty.of.k === "html") return [`${place}.as_ref().map_or(0, |v| fv::TrustedHtml::trusted_html(v).len())`];
      if (ty.of.k === "struct") {
        const inner = textLen(comp, "v", ty.of, seen);
        return inner.length ? [`${place}.as_ref().map_or(0, |v| ${inner.join(" + ")})`] : [];
      }
      return [];
    case "struct": {
      // A recursive structure is counted to its first level: the reservation is an estimate.
      if (seen.has(ty.name)) return [];
      const { st, owner } = lookupStruct(comp, ty);
      const inner = new Set(seen).add(ty.name);
      return (st?.fields ?? []).flatMap((f) => textLen(owner, `${place}.${f.rust}`, f.ty, inner));
    }
    case "list": {
      const inner = textLen(comp, "v", ty.of, seen);
      return inner.length ? [`${place}.iter().map(|v| ${inner.join(" + ")}).sum::<usize>()`] : [];
    }
    case "record": {
      const inner = textLen(comp, "v", ty.of, seen);
      return [`${place}.iter().map(|(k, ${inner.length ? "v" : "_"})| ${["k.len()", ...inner].join(" + ")}).sum::<usize>()`];
    }
    default:
      return [];
  }
}

/** `render`, and for a component a parent may hand scope ids to, `render_scoped`, which takes them
 * last, as `ssrRenderAttrs` writes them onto its root; `render` hands it none. */
function renderSource(comp: Component, life: string, args: string, e: Emitter): string {
  const doc = "/// Write the component's server render into `out`.\n";
  // Props or ids the render never reads, as when a component only passes its slot on.
  const props = e.reads("props", 0) ? "props" : "_props";
  if (!comp.inherits) return `${doc}pub fn render(out: &mut String, ${props}: &Props${life}${extraParams(comp)}) {\n${e.lines.join("\n")}\n}`;
  // A root that is a fragment, or a `<Teleport>`, takes no ids.
  const attrs = e.reads("fv_attrs", 0) ? "fv_attrs" : "_fv_attrs";
  return `${doc}pub fn render(out: &mut String, props: &Props${life}${extraParams(comp)}) {
    render_scoped(out, props${args}, "");
}

/// [\`render\`], with the scope ids a parent hands the root: \` data-v-…\` each.
#[doc(hidden)]
pub fn render_scoped(out: &mut String, ${props}: &Props${life}${extraParams(comp)}, ${attrs}: &str) {
${e.lines.join("\n")}
}`;
}

export function componentSource(comp: Component, ast: N[], ssr: string, components: Map<string, Component>): string {
  const { scope, lets } = scopeFor(comp, ast, components);
  const program = parseJs(ssr, { sourceType: "module" }).program;
  tagAst(program, "template");
  const fn = (program.body as N[]).find(
    (s: N) => s.type === "ExportNamedDeclaration" && s.declaration?.id?.name === "ssrRender",
  )?.declaration;
  if (!fn) fail(comp, "the compiled template has no `ssrRender`");

  const e = new Emitter();
  for (const l of lets) e.stmt(l);
  statements(scope, e, fn.body.body);
  // A setup value the render never reads is not computed. Checked from the last up, since one may
  // read another declared before it.
  for (let i = lets.length - 1; i >= 0; i--) {
    const name = /^let (\w+)/.exec(lets[i]!)![1]!;
    if (!e.reads(name, i + 1)) e.lines.splice(i, 1);
  }
  e.flush();
  /* The literal markup, a loop's once per item, what the helpers can write, and every string the
   * props hold. Literals in untaken branches overcount and escaping or a string used twice
   * undercounts, so it is an estimate — close enough that the buffer is sized once, where
   * reserving the literals alone leaves it to grow again at the first long label. */
  const text = textLen(comp, "props", { k: "struct", name: "Props" });
  const fixed = e.literalBytes + scope.helperBytes.n;
  const reserve = [...(fixed || !(e.perItem.length + text.length) ? [String(fixed)] : []), ...e.perItem, ...text];
  e.lines.unshift(`    out.reserve(${reserve.join(" + ")});`);

  const life = structLifetime(comp.props, comp) ? "<'_>" : "";
  const gen = life ? "<'p, 'a>" : "<'p>";
  const named = life ? "<'a>" : "";
  // An `interface Props` that `defineProps` takes is the props struct itself, written once below.
  const structs = [...comp.structs.values()]
    .filter((st) => st.name !== "Props" && !st.slot)
    .map((st) => structSource(st, comp, `/// \`${st.name}\` in \`${basename(comp.file)}\`.\n`))
    .join("\n");
  // `Cow` is imported only where a field is one: a lifetime that comes from another component's props
  // alone borrows through that type, not through a `Cow` written here.
  const usesCow = /Cow</.test(structs + structSource(comp.props, comp, ""));
  const plain = !takesSlots(comp) && !comp.usesRoute && !comp.usesStores && !comp.usesI18n && !comp.usesTeleports;
  const slotFields = [
    ...comp.slotNames.map((n) => {
      const outlet = `\`<slot${n === "default" ? "" : ` name="${n}"`}>\``;
      const type = comp.slotShapes.has(n) ? `&'s ${slotTypeName(n, "Slot")}<'s>` : "fv::Slot<'s>";
      return `    /// ${outlet}\n    pub ${snake(n)}: Option<${type}>,`;
    }),
    ...(comp.routerView ? ["    /// The page `<RouterView>` shows.\n    pub router_view: fv::Slot<'s>,"] : []),
  ];
  const slotTypes = [...comp.slotShapes.entries()]
    .map(([n, shape]) => {
      const outlet = `\`<slot${n === "default" ? "" : ` name="${n}"`}>\``;
      const borrows = shape.fields.some((f) => slotFieldBorrows(f.ty));
      const fields = shape.fields.map((f) => `    pub ${f.rust}: ${slotFieldTy(f.ty, comp)},`).join("\n");
      const props = `${shape.name}${borrows ? "<'v>" : ""}`;
      return `/// The props ${outlet} passes the content a parent gives it, borrowed for the render.
pub struct ${props} {
${fields}
}

/// A parent's content for ${outlet}, given its props${comp.passesSlotIds ? " and the slot scope id to write onto its elements" : ""}: returns whether it wrote anything but comments.
pub type ${slotTypeName(n, "Slot")}<'s> = dyn ${borrows ? "for<'v> " : ""}Fn(&mut String, &${props}${comp.passesSlotIds ? ", &str" : ""}) -> bool + 's;

`;
    })
    .join("");
  const slotsStruct = takesSlots(comp)
    ? `${slotTypes}/// What a parent puts in the slots \`${basename(comp.file)}\` renders.
#[derive(Clone, Copy${comp.routerView ? "" : ", Default"})]
pub struct Slots<'s> {
${slotFields.join("\n")}
}

`
    : "";
  const args =
    (takesSlots(comp) ? ", fv_slots" : "") + (comp.usesRoute ? ", fv_route" : "") + (comp.usesStores ? ", fv_stores" : "") + (comp.usesI18n ? ", fv_i18n" : "") + (comp.usesTeleports ? ", fv_teleports" : "");
  const params =
    (takesSlots(comp) ? ", fv_slots: Slots<'p>" : "") +
    (comp.usesRoute ? ", fv_route: &'p fv::Route<'p>" : "") +
    (comp.usesStores ? ", fv_stores: &'p super::stores::Stores<'p>" : "") +
    (comp.usesI18n ? ", fv_i18n: &'p fv::I18n" : "") +
    (comp.usesTeleports ? ", fv_teleports: &'p fv::Teleports" : "");
  const wrappers = plain
    ? `/// The component's markup, for a maud page that shows it without hydrating it.
pub fn html${gen}(props: &'p Props${named}) -> fv::Html<'p, Props${named}> {
    fv::Html::markup(props, render)
}

/// The component as an island the client hydrates.
pub fn island${gen}(props: &'p Props${named}) -> fv::Html<'p, Props${named}> {
    fv::Html::island(NAME, props, render)
}
`
    : `/// The component's markup, for a maud page that shows it.
pub fn html${gen}(props: &'p Props${named}${params}) -> fv::Html<'p, Props${named}, impl Fn(&mut String, &Props${named}) + 'p> {
    fv::Html::markup(props, move |out: &mut String, props: &Props${named}| render(out, props${args}))
}
`;
  return `${header(comp.file)}
${usesCow ? "use std::borrow::Cow;\n\n" : ""}use ferrovue as fv;

/// The component's name, as \`data-island\` carries it.
pub const NAME: &str = ${rustStr(comp.name)};

${structs ? structs + "\n" : ""}${structSource(comp.props, comp, `/// The props \`${basename(comp.file)}\` declares.\n`)}
${slotsStruct}${renderSource(comp, life, args, e)}

${wrappers}`;
}

export function modSource(comps: Component[]): string {
  const arms = comps
    .map((c) => {
      const lines = [`let props: ${c.module}::Props = serde_json::from_str(json).map_err(|e| e.to_string())?;`];
      let args = "";
      if (takesSlots(c) || c.usesRoute || c.usesStores || c.usesI18n) lines.push("let fixture: Fixture = serde_json::from_str(json).map_err(|e| e.to_string())?;");
      if (takesSlots(c)) {
        const names = [...c.slotNames, ...(c.routerView ? ["routerView"] : [])];
        for (const n of names) {
          const local = `s_${snake(n).replace(/^r#/, "")}`;
          const shape = c.slotShapes.get(n);
          if (shape) {
            // A fixture's content for a scoped slot is static: it is given the props and ignores them.
            const life = shape.fields.some((f) => slotFieldBorrows(f.ty)) ? "<'_>" : "";
            lines.push(`let ${local} = |out: &mut String, _: &${c.module}::${shape.name}${life}${c.passesSlotIds ? ", _: &str" : ""}| -> bool { out.push_str(fixture.slot(${rustStr(n)}).unwrap_or_default()); true };`);
          } else lines.push(`let ${local} = |out: &mut String| out.push_str(fixture.slot(${rustStr(n)}).unwrap_or_default());`);
        }
        const fields = c.slotNames.map((n) => {
          const local = `s_${snake(n).replace(/^r#/, "")}`;
          const value = c.slotShapes.has(n) ? `&${local} as &${c.module}::${slotTypeName(n, "Slot")}` : `ferrovue::Slot::new(&${local})`;
          return `${snake(n)}: fixture.slot(${rustStr(n)}).map(|_| ${value})`;
        });
        if (c.routerView) fields.push("router_view: ferrovue::Slot::new(&s_router_view)");
        args += `, ${c.module}::Slots { ${fields.join(", ")} }`;
      }
      if (c.usesRoute) {
        lines.push("let router = route_table::router();", "let route = router.at(&fixture.route);");
        args += ", &route";
      }
      if (c.usesStores) {
        lines.push("let state: stores::Stores = serde_json::from_value(fixture.stores.clone()).map_err(|e| e.to_string())?;");
        args += ", &state";
      }
      if (c.usesI18n) {
        lines.push("let i18n = i18n::i18n(fixture.locale.as_deref().unwrap_or(i18n::LOCALE));");
        args += ", &i18n";
      }
      if (c.usesTeleports) {
        lines.push("let teleports = ferrovue::Teleports::new();");
        args += ", &teleports";
      }
      lines.push(`${c.module}::render(&mut out, &props${args});`);
      // What was teleported follows the render, as the conformance suite records Vue's.
      if (c.usesTeleports) lines.push("teleports_into(&mut out, teleports);");
      return `        ${rustStr(c.name)} => {\n${lines.map((l) => "            " + l).join("\n")}\n        }`;
    })
    .join("\n");
  const fixture = comps.some((c) => takesSlots(c) || c.usesRoute || c.usesStores || c.usesI18n)
    ? `
/// What a fixture holds besides the props: each slot's content, and the location it renders at.
#[cfg(test)]
#[derive(serde::Deserialize)]
struct Fixture {
    #[serde(rename = "$slots", default)]
    slots: std::collections::HashMap<String, String>,
    #[serde(rename = "$route", default = "Fixture::root")]
    route: String,
    #[serde(rename = "$stores", default = "Fixture::no_stores")]
    stores: serde_json::Value,
    #[serde(rename = "$locale", default)]
    locale: Option<String>,
}

#[cfg(test)]
impl Fixture {
    fn root() -> String {
        "/".to_owned()
    }

    fn no_stores() -> serde_json::Value {
        serde_json::Value::Object(Default::default())
    }

    fn slot(&self, name: &str) -> Option<&str> {
        self.slots.get(name).map(String::as_str)
    }
}
`
    : "";
  return `${header(ctx.componentsDir)}
//! The component renderers, one module per \`.vue\` file.

// The modules pass rustc's default warnings and clippy's default lints, with one exception:
// \`dead_code\`. Every component gets the whole of its API (\`render\`, \`html\`, \`island\`, \`NAME\`, a
// constructor and a setter per optional prop) and an app calls only what it needs.
#![allow(dead_code)]

${comps.map((c) => `pub mod ${c.module};`).join("\n")}${ctx.routes ? "\npub mod route_table;" : ""}${ctx.stores.size ? "\npub mod stores;" : ""}${ctx.typeStructs.size ? "\npub mod types;" : ""}${ctx.i18n ? "\npub mod i18n;" : ""}
${fixture}
${comps.some((c) => c.usesTeleports) ? `/// What was teleported, after a marker, as the conformance suite writes Vue's: \`{"target":"…"}\`.
#[cfg(test)]
fn teleports_into(out: &mut String, teleports: ferrovue::Teleports) {
    let targets = teleports.into_targets();
    if targets.is_empty() {
        return;
    }
    let pairs: Vec<String> = targets
        .iter()
        .map(|(t, html)| format!("{}:{}", serde_json::to_string(t).unwrap(), serde_json::to_string(html).unwrap()))
        .collect();
    out.push_str("<!--fv-teleports-->{");
    out.push_str(&pairs.join(","));
    out.push('}');
}

` : ""}/// Render one component from its props as JSON, for the conformance suite.
#[cfg(test)]
pub fn render_json(component: &str, json: &str) -> Result<String, String> {
    let mut out = String::new();
    match component {
${arms}
        other => return Err(format!("no component called {other}")),
    }
    Ok(out)
}
`;
}

export function storesSource(dir: string): string {
  const home = storeHome(dir);
  // Test-only `Default` lets a fixture name only the stores it reads; the rest are never looked at.
  const testDerive = (src: string) =>
    src.replace("#[cfg_attr(test, derive(serde::Deserialize))]", "#[cfg_attr(test, derive(Default, serde::Deserialize))]\n#[cfg_attr(test, serde(default))]");
  const structs = [...ctx.storeStructs.values()]
    .map((st) => testDerive(structSource(st, home, `/// \`${st.name}\` in \`${ctx.storeFiles.get(st.name)}\`.\n`)))
    .join("\n");
  const all: Struct = {
    name: "Stores",
    fields: [...ctx.stores.values()].map((st) => ({ js: st.id, rust: st.field, ty: { k: "struct", name: st.state, store: true } })),
  };
  const top = testDerive(structSource(all, home, "/// Every store's state, keyed by id as `pinia.state.value` is: what the page sends the client.\n"));
  return `${header(dir, "the store files")}
//! The Pinia stores' state, which components read while they render on the server.

${/Cow</.test(structs) ? "use std::borrow::Cow;\n\n" : ""}${structs}
${top}`;
}

export function typesSource(): string {
  const home = storeHome("types");
  home.structs = ctx.typeStructs;
  home.module = "types";
  const files = [...new Set(ctx.typeFiles.values())].toSorted();
  const structs = [...ctx.typeStructs.values()]
    .map((st) => structSource(st, home, `/// \`${st.name}\` in \`${ctx.typeFiles.get(st.name)}\`.\n`))
    .join("\n");
  return `${header(files.join(", "), "the type files")}
//! The types components import from shared \`.ts\` files, written once so that components passing
//! them to one another agree on them.

${/Cow</.test(structs) ? "use std::borrow::Cow;\n\n" : ""}${structs}`;
}

/** Route definitions as \`ferrovue::RouteDef\` literals, children nested. */
function routeDefs(routes: RouteDef[], depth: number): string {
  const pad = "    ".repeat(depth);
  return routes
    .map((r) => {
      const name = r.name === undefined ? "None" : `Some(${rustStr(r.name)})`;
      const children = r.children?.length ? `&[\n${routeDefs(r.children, depth + 1)}\n${pad}]` : "&[]";
      return `${pad}ferrovue::RouteDef { path: ${rustStr(r.path)}, name: ${name}, children: ${children} },`;
    })
    .join("\n");
}

export function routesSource(routes: RouteDef[], file: string): string {
  return `${header(file, "the routes file")}
//! The app's routes: what \`<RouterLink>\` resolves against and \`useRoute()\` reads.

/// Each route: its vue-router path, its name if it has one, and the routes nested in it.
pub const ROUTES: &[ferrovue::RouteDef<'static>] = &[
${routeDefs(routes, 1)}
];

/// Every route's full path, nested ones included.
pub const PATHS: &[&str] = &[
${allRoutes(routes).map((r) => `    ${rustStr(r.fullPath)},`).join("\n")}
];

/// The history's base, which every link's \`href\` starts with.
pub const BASE: &str = ${rustStr(ctx.routerBase)};

/// The router these routes make: build it once, and resolve each request's location with
/// [\`ferrovue::Router::at\`].
pub fn router() -> ferrovue::Router {
    ferrovue::Router::tree(ROUTES).with_base(BASE)
}
`;
}
