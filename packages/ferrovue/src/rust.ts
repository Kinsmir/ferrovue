import { parse as parseJs } from "@babel/parser";
import { basename } from "node:path";
import { type Component, type Field, type N, type Struct, type Ty, blankComponent, fail, GenError, rustStr, snake, tagAst, takesAttrs } from "./model.ts";
import { ctx, INLINE_HTML } from "./context.ts";
import { lookupStruct, typeWritten } from "./typescript.ts";
import { childOf } from "./expr.ts";
import { Emitter } from "./emitter.ts";
import { occurrences } from "./parens.ts";
import { statements } from "./template.ts";
import { inlineCssVars } from "./styles.ts";
import { slotFieldBorrows, slotFieldTy, slotTypeName } from "./slots.ts";
import { extraParams, fieldInit, takesSlots } from "./children.ts";
import { paramsOf, renderParams, slotContextOf, slotFieldsOf } from "./plugin.ts";
import { scopeFor } from "./script.ts";

export function needsLifetime(ty: Ty, comp: Component, seen: Set<string> = new Set()): boolean {
  switch (ty.k) {
    case "str":
    case "record":
      return true;
    case "opt":
    case "list":
      return needsLifetime(ty.of, comp, seen);
    case "struct": {
      if (seen.has(ty.name)) return false;
      const { st, owner } = lookupStruct(comp, ty);
      const inner = new Set(seen).add(ty.name);
      return !!st && st.fields.some((f) => needsLifetime(f.ty, owner, inner));
    }
    case "child": {
      const child = childOf(ty.name);
      return structLifetime(child.props, child);
    }
    case "html":
      return !ty.inline && (ctx.trustedHtml?.includes("'a") ?? false);
    default:
      return false;
  }
}

export function structLifetime(st: Struct, comp: Component): boolean {
  return st.fields.some((f) => needsLifetime(f.ty, comp, new Set([st.name])));
}

export function localTy(ty: Ty, comp: Component): string {
  return rustTy(ty, comp).replace(/\bCow<'a, /g, "std::borrow::Cow<").replace(/'a\b/g, "'_");
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
      if (!st) throw new GenError("FV0308", `no type \`${ty.name}\``);
      return `${path}${ty.name}${structLifetime(st, owner) ? "<'a>" : ""}`;
    }
    case "html":
      return ty.inline ? INLINE_HTML : ctx.trustedHtml!;
    case "child": {
      const child = childOf(ty.name);
      return `super::${child.module}::Props${structLifetime(child.props, child) ? "<'a>" : ""}`;
    }
    default:
      throw new GenError("FV0309", "no Rust type for `undefined`");
  }
}

function param(ty: Ty, comp: Component, arg: string): { ty: string; value: string } {
  if (ty.k === "str") return { ty: "impl Into<Cow<'a, str>>", value: `${arg}.into()` };
  if (ty.k === "list" && ty.of.k === "str") {
    return { ty: "impl IntoIterator<Item = impl Into<Cow<'a, str>>>", value: `${arg}.into_iter().map(Into::into).collect()` };
  }
  return { ty: rustTy(ty, comp), value: arg };
}

function absentNote(optional: Field[]): string {
  const nulls = optional.filter((f) => f.ty.k === "opt" && f.ty.none === "null").length;
  if (!nulls) return optional.length ? ", every optional one absent" : "";
  return nulls === optional.length ? ", every nullable one `null`" : ", every optional one absent and every nullable one `null`";
}

function builderSource(st: Struct, comp: Component, life: string): string {
  const required = st.fields.filter((f) => f.ty.k !== "opt");
  const optional = st.fields.filter((f) => f.ty.k === "opt");
  const arg = (f: Field) => f.rust;
  const params = required.map((f) => `${arg(f)}: ${param(f.ty, comp, arg(f)).ty}`).join(", ");
  const inits = st.fields
    .map((f) => (f.ty.k === "opt" ? `${f.rust}: None` : fieldInit(f.rust, param(f.ty, comp, arg(f)).value)))
    .join(", ");
  const setters = optional
    .filter((f) => f.rust !== "new")
    .map((f) => {
      const p = param((f.ty as Ty & { k: "opt" }).of, comp, arg(f));
      return `
    /// Set \`${f.js}\`, which is ${(f.ty as Ty & { k: "opt" }).none === "null" ? "`null`" : "absent"} otherwise.
    pub fn ${f.rust}(mut self, ${arg(f)}: ${p.ty}) -> Self {
        self.${f.rust} = Some(${p.value});
        self
    }`;
    })
    .join("\n");
  const usesA = /'a/.test(params + setters);
  const impl = life ? "impl<'a>" : usesA ? "impl<'a>" : "impl";
  return `${impl} ${st.name}${life} {
    /// ${st.name} with ${required.length ? "its required fields" : "nothing set"}${absentNote(optional)}.
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
        f.ty.k === "opt" && f.ty.none === undefined
          ? `    #[serde(rename = ${rustStr(f.js)}, default, skip_serializing_if = "Option::is_none")]`
          : `    #[serde(rename = ${rustStr(f.js)})]`;
      return `${attrs}\n    pub ${f.rust}: ${rustTy(f.ty, comp)},`;
    })
    .join("\n");
  const derives = st.fields.some((f) => f.ty.k !== "opt") ? "Debug, Clone" : "Debug, Clone, Default";
  return `${doc}#[derive(${derives}, serde::Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
pub struct ${st.name}${life} {
${fields}
}
${ctx.builders ? `\n${builderSource(st, comp, life)}\n` : ""}`;
}

/** The version of generated code this compiler writes, which `mod.rs` hands `ferrovue::__compat!`:
 * the highest version the `ferrovue` crate of the same release supports. RELEASING.md says when
 * it changes. */
export const GENERATED_VERSION = 1;

/** How every file ferrovue writes begins. */
export const GENERATED = "// @generated by ferrovue";

export function header(source: string, edit = "the `.vue` file"): string {
  return `${GENERATED} from ${source}. Do not edit: change ${edit} and run
// \`ferrovue\`.
`;
}

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

function manyArgs(count: number): string {
  return count > 7 ? "#[allow(clippy::too_many_arguments)]\n" : "";
}

function renderParamCount(comp: Component): number {
  return (takesSlots(comp) ? 1 : 0) + paramsOf(comp).length;
}

function renderSource(comp: Component, life: string, args: string, e: Emitter): string {
  const doc = `/// Write the component's server render into \`out\`.\n${manyArgs(2 + renderParamCount(comp))}`;
  const props = e.reads("props", 0) ? "props" : "_props";
  const unread = (name: string): boolean => {
    const shadow = e.lines.findIndex((l) => l.trimStart().startsWith(`let ${name} = `));
    const before = shadow < 0 ? e.lines : [...e.lines.slice(0, shadow), e.lines[shadow]!.replace(`let ${name} = `, "")];
    return occurrences(before.join("\n"), name) === 0;
  };
  if (!comp.inherits && !takesAttrs(comp)) return `${doc}pub fn render(out: &mut String, ${props}: &Props${life}${extraParams(comp, unread)}) {\n${e.lines.join("\n")}\n}`;
  const attrs = e.reads("fv_attrs", 0) ? "fv_attrs" : "_fv_attrs";
  const [none, ty, what] = takesAttrs(comp)
    ? ["&fv::Attrs::NONE", "&fv::Attrs<'_>", "the attributes a parent passes beyond the props, and the scope ids it hands the root"]
    : ['""', "&str", "the scope ids a parent hands the root: ` data-v-…` each"];
  return `${doc}pub fn render(out: &mut String, props: &Props${life}${extraParams(comp)}) {
    render_scoped(out, props${args}, ${none});
}

/// [\`render\`], with ${what}.
#[doc(hidden)]
${manyArgs(3 + renderParamCount(comp))}pub fn render_scoped(out: &mut String, ${props}: &Props${life}${extraParams(comp, unread)}, ${attrs}: ${ty}) {
${e.lines.join("\n")}
}`;
}

export function isIsland(comp: Component): boolean {
  return !takesSlots(comp) && comp.takes.size === 0;
}

export function componentSource(comp: Component, ast: N[], ssr: string, components: Map<string, Component>): string {
  if (takesAttrs(comp) && comp.inheritAttrs && comp.attrsDropped) {
    fail(comp, "FV0416", `a root \`<Transition>\` or \`<KeepAlive>\` around a \`v-if\` in ${comp.name}, which a parent passes attributes: Vue's server drops them, where its client puts them on the element; set \`inheritAttrs: false\` and bind \`$attrs\` on the element`, comp.attrsDropped);
  }
  const { scope, lets } = scopeFor(comp, ast, components);
  const program = parseJs(ssr, { sourceType: "module" }).program;
  tagAst(program, "template");
  const fn = (program.body as N[]).find(
    (s: N) => s.type === "ExportNamedDeclaration" && s.declaration?.id?.name === "ssrRender",
  )?.declaration;
  if (!fn) fail(comp, "FV0006", "the compiled template has no `ssrRender`");

  const e = new Emitter();
  const preludes = ctx.plugins.flatMap((p) => (p.prelude ? [p.prelude(scope)] : []));
  const opening = [...preludes.flatMap((p) => p.before), ...lets, ...preludes.flatMap((p) => p.after)];
  for (const l of opening) e.stmt(l);
  statements(scope, e, inlineCssVars(comp, fn.body.body));
  for (let i = opening.length - 1; i >= 0; i--) {
    const name = /^let (\w+)/.exec(opening[i]!)?.[1];
    if (name !== undefined && !e.reads(name, i + 1)) e.lines.splice(i, 1);
  }
  e.flush();
  const text = textLen(comp, "props", { k: "struct", name: "Props" });
  const fixed = e.literalBytes + scope.helperBytes.n;
  const reserve = [...(fixed || !(e.perItem.length + text.length) ? [String(fixed)] : []), ...e.perItem, ...text];
  e.lines.unshift(`    out.reserve(${reserve.join(" + ")});`);

  const life = structLifetime(comp.props, comp) ? "<'_>" : "";
  const gen = life ? "<'p, 'a>" : "<'p>";
  const named = life ? "<'a>" : "";
  const owned = life ? "<'a>" : "";
  const ownedLife = life ? "'a" : "'static";
  const structs = [...comp.structs.values()]
    .filter((st) => st.name !== "Props" && !st.slot)
    .map((st) => structSource(st, comp, `/// \`${st.name}\` in \`${basename(comp.file)}\`.\n`))
    .join("\n");
  const usesCow = /Cow</.test(structs + structSource(comp.props, comp, ""));
  const plain = isIsland(comp);
  const context = slotContextOf(comp);
  const contextTys = context.map((p) => `, ${p.ty}`).join("");
  const slotFields = [
    ...comp.slotNames.map((n) => {
      const outlet = `\`<slot${n === "default" ? "" : ` name="${n}"`}>\``;
      const type = comp.slotShapes.has(n) || context.length ? `&'s ${slotTypeName(n, "Slot")}<'s>` : "fv::Slot<'s>";
      return `    /// ${outlet}\n    pub ${snake(n)}: Option<${type}>,`;
    }),
    ...slotFieldsOf(comp).map((f) => `    /// ${f.doc}\n    pub ${f.rust}: fv::Slot<'s>,`),
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

/// A parent's content for ${outlet}, given its props${comp.passesSlotIds ? " and the slot scope id to write onto its elements" : ""}${context.length ? " and what its ancestors provide" : ""}: returns whether it wrote anything but comments.
pub type ${slotTypeName(n, "Slot")}<'s> = dyn ${borrows ? "for<'v> " : ""}Fn(&mut String, &${props}${comp.passesSlotIds ? ", &str" : ""}${contextTys}) -> bool + 's;

`;
    })
    .join("");
  const contextSlots = context.length
    ? comp.slotNames
        .filter((n) => !comp.slotShapes.has(n))
        .map((n) => {
          const outlet = `\`<slot${n === "default" ? "" : ` name="${n}"`}>\``;
          return `/// A parent's content for ${outlet}, given ${comp.passesSlotIds ? "the slot scope id to write onto its elements and " : ""}what its ancestors provide: returns whether it wrote anything but comments.
pub type ${slotTypeName(n, "Slot")}<'s> = dyn Fn(&mut String${comp.passesSlotIds ? ", &str" : ""}${contextTys}) -> bool + 's;

`;
        })
        .join("")
    : "";
  const slotsStruct = takesSlots(comp)
    ? `${slotTypes}${contextSlots}/// What a parent puts in the slots \`${basename(comp.file)}\` renders.
#[derive(Clone, Copy${slotFieldsOf(comp).length ? "" : ", Default"})]
pub struct Slots<'s> {
${slotFields.join("\n")}
}

`
    : "";
  const args = (takesSlots(comp) ? ", fv_slots" : "") + paramsOf(comp).map((p) => `, ${p.name}`).join("");
  const params = (takesSlots(comp) ? ", fv_slots: Slots<'p>" : "") + paramsOf(comp).map((p) => `, ${p.name}: ${p.pageTy}`).join("");
  const wrappers = plain
    ? `/// The component's markup, for a maud page that shows it without hydrating it.
pub fn html${gen}(props: &'p Props${named}) -> fv::Html<'p, Props${named}> {
    fv::Html::markup(props, render)
}

/// The component as an island the client hydrates.
pub fn island${gen}(props: &'p Props${named}) -> fv::Html<'p, Props${named}> {
    fv::Html::island(NAME, props, render)
}

/// [\`html\`], holding the props: a handler that builds them can return it.
pub fn into_html${owned}(props: Props${named}) -> fv::Html<${ownedLife}, Props${named}> {
    fv::Html::markup_owned(props, render)
}

/// [\`island\`], holding the props.
pub fn into_island${owned}(props: Props${named}) -> fv::Html<${ownedLife}, Props${named}> {
    fv::Html::island_owned(NAME, props, render)
}
`
    : `/// The component's markup, for a maud page that shows it.
${manyArgs(1 + renderParamCount(comp))}pub fn html${gen}(props: &'p Props${named}${params}) -> fv::Html<'p, Props${named}, impl Fn(&mut String, &Props${named}) + 'p> {
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

function readsFixture(c: Component): boolean {
  return takesSlots(c) || paramsOf(c).some((p) => p.test.fixture);
}

export function modSource(comps: Component[], modules: string[]): string {
  const arms = comps
    .map((c) => {
      const lines = [`let props: ${c.module}::Props = serde_json::from_str(json).map_err(|e| e.to_string())?;`];
      let args = "";
      if (readsFixture(c)) lines.push("let fixture: Fixture = serde_json::from_str(json).map_err(|e| e.to_string())?;");
      if (takesSlots(c)) {
        const names = [...c.slotNames, ...slotFieldsOf(c).map((f) => f.js)];
        const context = slotContextOf(c);
        const contextArgs = context.map((p) => `, _: ${p.slotContext}`).join("");
        for (const n of names) {
          const local = `s_${snake(n).replace(/^r#/, "")}`;
          const shape = c.slotShapes.get(n);
          const content = `out.push_str(fixture.slot(${rustStr(n)}).unwrap_or_default()); true`;
          const shapeArg = shape ? `, _: &${c.module}::${shape.name}${shape.fields.some((f) => slotFieldBorrows(f.ty)) ? "<'_>" : ""}` : "";
          if (context.length && c.slotNames.includes(n)) {
            lines.push(`let ${local}: &${c.module}::${slotTypeName(n, "Slot")} = &|out: &mut String${shapeArg}${c.passesSlotIds ? ", _: &str" : ""}${contextArgs}| -> bool { ${content} };`);
          } else if (shape) {
            lines.push(`let ${local} = |out: &mut String${shapeArg}${c.passesSlotIds ? ", _: &str" : ""}| -> bool { ${content} };`);
          } else lines.push(`let ${local} = |out: &mut String| out.push_str(fixture.slot(${rustStr(n)}).unwrap_or_default());`);
        }
        const fields = c.slotNames.map((n) => {
          const local = `s_${snake(n).replace(/^r#/, "")}`;
          const value = context.length ? local : c.slotShapes.has(n) ? `&${local} as &${c.module}::${slotTypeName(n, "Slot")}` : `ferrovue::Slot::new(&${local})`;
          return `${snake(n)}: fixture.slot(${rustStr(n)}).map(|_| ${value})`;
        });
        for (const f of slotFieldsOf(c)) fields.push(`${f.rust}: ferrovue::Slot::new(&s_${snake(f.js).replace(/^r#/, "")})`);
        args += `, ${c.module}::Slots { ${fields.join(", ")} }`;
      }
      for (const p of paramsOf(c)) {
        lines.push(...p.test.lines);
        args += `, ${p.test.arg}`;
      }
      lines.push(`${c.module}::render(&mut out, &props${args});`);
      for (const p of paramsOf(c)) lines.push(...(p.test.after ?? []));
      return `        ${rustStr(c.name)} => {\n${lines.map((l) => "            " + l).join("\n")}\n        }`;
    })
    .join("\n");
  const fields = renderParams().flatMap((p) => (p.fixtureField === undefined ? [] : [p.fixtureField]));
  const defaults = renderParams().flatMap((p) => (p.fixtureDefault === undefined ? [] : [p.fixtureDefault]));
  const fixture = comps.some(readsFixture)
    ? `
/// What a fixture holds besides the props: each slot's content, and the location it renders at.
#[cfg(test)]
#[derive(serde::Deserialize)]
struct Fixture {
    #[serde(rename = "$slots", default)]
    slots: std::collections::HashMap<String, String>,
${fields.join("\n")}
}

#[cfg(test)]
impl Fixture {
${defaults.map((d) => `${d}\n\n`).join("")}    fn slot(&self, name: &str) -> Option<&str> {
        self.slots.get(name).map(String::as_str)
    }
}
`
    : "";
  return `${header(ctx.componentsDir)}
//! The component renderers, one module per \`.vue\` file.

// The modules pass rustc's default warnings and clippy's default lints, with one exception:
// \`dead_code\`. Every component gets the whole of its API (\`render\`, \`html\`, \`island\`, their
${ctx.builders ? "// `into_` forms, `NAME`, a constructor and a setter per optional prop) and an app calls only what\n// it needs." : "// `into_` forms and `NAME`) and an app calls only what it needs."}
#![allow(dead_code)]

ferrovue::__compat!(${GENERATED_VERSION});

${comps.map((c) => `pub mod ${c.module};`).join("\n")}${modules.map((m) => `\npub mod ${m.replace(/\.rs$/, "")};`).join("")}
${fixture}
${renderParams()
  .filter((p) => p.testSupport !== undefined && comps.some((c) => c.takes.has(p.name)))
  .map((p) => `${p.testSupport}\n\n`)
  .join("")}/// Render one component from its props as JSON, for the conformance suite.
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

export function typesSource(): string {
  const home = blankComponent("types", "types", "types", ctx.typeStructs);
  const written = [...ctx.typeStructs.values()].filter((st) => typeWritten(st.name));
  const files = [...new Set([...written.map((st) => ctx.typeFiles.get(st.name)!), ...[...ctx.typeConsts.values()].map((c) => c.file)])].toSorted();
  const structs = written
    .map((st) => structSource(st, home, `/// \`${st.name}\` in \`${ctx.typeFiles.get(st.name)}\`.\n`))
    .join("\n");
  const consts = [...ctx.typeConsts.values()].map((c) => `${c.text}\n`).join("");
  return `${header(files.join(", "), "the type files")}
//! The types components import from shared \`.ts\` files, written once so that components passing
//! them to one another agree on them.

${/Cow</.test(structs) ? "use std::borrow::Cow;\n\n" : ""}${structs}${consts}`;
}
