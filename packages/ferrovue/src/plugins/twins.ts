import { type Component, type Field, type N, type Scope, type Ty, blankComponent, camelize, fail, GenError, snake } from "../model.ts";
import { CONFIG_FILE, type TwinSpec, tyOfName } from "../context.ts";
import { coerce, expr } from "../expr.ts";
import { bare, strArg } from "../parens.ts";
import { header } from "../rust.ts";
import { callWith, fieldInit, renderChild, type TwinCall } from "../children.ts";
import { type Plugin, runOf, scopeOf } from "../plugin.ts";

interface Twin {
  spec: TwinSpec;
  comp: Component;
}

type TwinsRun = Map<string, Twin>;

function hyphenate(name: string): string {
  return name.replace(/\B([A-Z])/g, "-$1").toLowerCase();
}

function readTwins(specs: Record<string, TwinSpec>): TwinsRun {
  const twins: TwinsRun = new Map();
  for (const [name, spec] of Object.entries(specs)) {
    const where = `\`twins.${name}\` in ${CONFIG_FILE}`;
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new GenError(`${where}: a twin is named as its component is, in PascalCase`);
    if (typeof spec?.rust !== "string" || !/^[A-Za-z_]\w*(::[A-Za-z_]\w*)+$/.test(spec.rust)) {
      throw new GenError(`${where} needs \`rust\`, the path of the function that renders it, as \`crate::ui::v_btn\``);
    }
    const comp = blankComponent(name, "twins", CONFIG_FILE);
    for (const [js, type] of Object.entries(spec.props ?? {})) {
      if (!/^[A-Za-z_$][\w$]*$/.test(js)) throw new GenError(`${where}: the prop \`${js}\` is named in camelCase`);
      comp.props.fields.push({ js, rust: snake(js), ty: tyOfName(type) });
    }
    for (const slot of spec.slots ?? []) {
      if (!/^[A-Za-z_][\w-]*$/.test(slot)) throw new GenError(`${where}: the slot \`${slot}\` is not a plain name`);
      comp.slotNames.push(slot);
    }
    comp.inherits = true;
    comp.attrNames = new Set(["class", "style"]);
    twins.set(name, { spec, comp });
  }
  return twins;
}

function twinNamed(name: string): Twin | undefined {
  const twins = runOf(twinsPlugin);
  return twins.get(name) ?? twins.get(camelize(name).replace(/^\w/, (c) => c.toUpperCase()));
}

function init(s: Scope, f: Field, node: N | undefined, n: N, owner: string): string {
  if (!node) {
    if (f.ty.k === "opt") return `${f.rust}: None`;
    if (f.ty.k === "bool") return `${f.rust}: false`;
    return fail(s.comp, `${owner} requires \`${f.js}\``, n);
  }
  if (f.ty.k === "bool" && node.type === "StringLiteral" && (node.value === "" || node.value === hyphenate(f.js))) return `${f.rust}: true`;
  const code = bare(coerce(s.comp, expr(s, node), f.ty, node));
  return fieldInit(f.rust, f.ty.k === "str" ? strArg(code) : code);
}

function callOf(twin: Twin): TwinCall {
  const name = twin.comp.name;
  return {
    comp: twin.comp,
    init: (s, f, node, n) => init(s, f, node, n, name),
    call(s, e, inits, slots, attrs) {
      const props = `&super::twins::${name}Props { ${inits.join(", ")} }`.replace("{  }", "{}");
      callWith(s, e, twin.comp, "super::twins", `${twin.spec.rust}(out, ${props}`, `super::twins::${name}Slots`, `, ${attrs}`, slots, true);
    },
  };
}

function rustTy(ty: Ty): string {
  switch (ty.k) {
    case "str":
      return "&'a str";
    case "int":
      return "i64";
    case "float":
      return "f64";
    case "bool":
      return "bool";
    case "opt":
      return `Option<${rustTy(ty.of)}>`;
    default:
      throw new GenError(`no Rust type for a twin's prop of type ${JSON.stringify(ty)}`);
  }
}

function twinSource({ spec, comp }: Twin): string {
  const name = comp.name;
  const life = comp.props.fields.some((f) => rustTy(f.ty).includes("'a")) ? "<'a>" : "";
  const fields = comp.props.fields.map((f) => `    pub ${f.rust}: ${rustTy(f.ty)},\n`).join("");
  const props = `/// The props a template gives \`<${name}>\`.
#[derive(Debug, Clone, Copy)]
pub struct ${name}Props${life} {
${fields}}
`;
  const slots = comp.slotNames.length
    ? `
/// What a template puts in \`<${name}>\`'s slots.
#[derive(Clone, Copy, Default)]
pub struct ${name}Slots<'s> {
${comp.slotNames.map((slot) => `    /// \`#${slot}\`\n    pub ${snake(slot)}: Option<fv::Slot<'s>>,\n`).join("")}}
`
    : "";
  const params = ["&mut String", `&${name}Props${life ? "<'_>" : ""}`, ...(comp.slotNames.length ? [`${name}Slots<'_>`] : []), "&fv::Attrs<'_>"];
  return `${props}${slots}
/// How generated code calls \`${spec.rust}\`, which renders \`<${name}>\`: into the buffer, with
/// the props, ${comp.slotNames.length ? "the slots, " : ""}and the attributes and scope ids its root takes.
pub type ${name}Render = fn(${params.join(", ")});

const _: ${name}Render = ${spec.rust};
`;
}

export const twinsPlugin: Plugin<TwinsRun, Map<string, Twin>> = {
  name: "twins",
  configure: (config) => readTwins(config.twins ?? {}),
  analyse(read) {
    for (const r of read) {
      if (runOf(twinsPlugin).has(r.comp.name)) throw new GenError(`\`twins.${r.comp.name}\` in ${CONFIG_FILE} names ${r.comp.file}, which ferrovue compiles: a twin renders a component it does not`);
    }
  },
  scope: () => new Map(),
  scriptImport(s, st) {
    for (const sp of st.specifiers) {
      const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : sp.type === "ImportDefaultSpecifier" ? sp.local.name : null;
      const twin = name === null ? undefined : runOf(twinsPlugin).get(name);
      if (twin) scopeOf(twinsPlugin, s).set(sp.local.name, twin);
    }
    return false;
  },
  resolveComponent(s, local, name) {
    const twin = twinNamed(name);
    if (twin) scopeOf(twinsPlugin, s).set(local, twin);
    return twin !== undefined;
  },
  component(s, e, n) {
    const target = n.arguments[0];
    const local: string | undefined =
      target.type === "Identifier" ? target.name : target.type === "MemberExpression" && target.object.name === "$setup" ? (target.computed ? target.property.value : target.property.name) : undefined;
    if (local === undefined) return false;
    const file = s.children.get(local);
    const twin = scopeOf(twinsPlugin, s).get(local) ?? (file !== undefined && !s.components.has(file) ? runOf(twinsPlugin).get(file) : undefined);
    if (!twin) return false;
    renderChild(s, e, n, callOf(twin));
    return true;
  },
  modules() {
    const twins = [...runOf(twinsPlugin).values()];
    if (!twins.length) return [];
    return [
      [
        "twins.rs",
        `${header(CONFIG_FILE, "`twins` in it")}
//! The props and slots of the components rendered by Rust functions of the project's, its twins,
//! and the signature each function is held to. ferrovue does not check that a twin writes what Vue
//! writes: render the parents that use it with Vue in the project's own fixtures to prove it.

use ferrovue as fv;

${twins.map(twinSource).join("\n")}`,
      ],
    ];
  },
};
