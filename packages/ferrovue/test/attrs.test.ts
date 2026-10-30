import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenError } from "../src/errors.ts";
import { generate } from "../src/compiler.ts";

const roots: string[] = [];

const compile = (project: string, config: Record<string, unknown> = {}) => generate(project, { components: "components", out: "out", ...config });

function island(source: string, others: Record<string, string> = {}): string {
  const made = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(made);
  const dir = join(made, "components");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "X.vue"), source);
  for (const [name, text] of Object.entries(others)) writeFileSync(join(dir, `${name}.vue`), text);
  return made;
}

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

function refusal(project: string, config: Record<string, unknown> = {}): GenError {
  try {
    compile(project, config);
  } catch (e) {
    if (e instanceof GenError) return e;
    throw e;
  }
  throw new Error("compiled without an error");
}

const component = (props: string, template: string, script = "") => `<script setup lang="ts">
${script}defineProps<{ ${props} }>();
</script>
<template>${template}</template>`;

const passing = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><Child data-x="1" /></template>`;

const scopedPassing = `${passing}
<style scoped>div { color: red }</style>`;

const focus = "const vFocus = { getSSRProps: () => ({}) };\n";

describe("text", () => {
  it("writes nothing for `null` and `undefined`", () => {
    expect(compile(island(component("label: string", "<div><p>{{ null }}|{{ undefined }}</p></div>"))).get("x.rs")).toContain(`out.push_str("<div><p>|</p></div>");`);
  });
});

describe("attribute values", () => {
  it("writes a joined value piece by piece, and tests it for emptiness without building it", () => {
    const out = compile(
      island(component("rank: number; score: Float; sub: string; tail: string; on: boolean; m?: number", '<li :aria-label="\'rank \' + rank" :title="sub + tail" :data-a="`${on}${sub}`" :data-m="`${m}`"><a :title="score + \' points\'">x</a></li>', 'import type { Float } from "ferrovue/types";\n')),
    ).get("x.rs")!;
    expect(out).not.toContain("format!");
    expect(out).toContain(`out.push_str("<li aria-label=\\"rank ");\n    fv::core::push_int(out, props.rank);\n    out.push('"');\n    if props.sub.is_empty() && props.tail.is_empty() {`);
    expect(out).toContain(`fv::core::escape_into(out, &props.sub);\n        fv::core::escape_into(out, &props.tail);`);
    expect(out).toContain(`out.push_str(" data-a=\\"");\n    out.push_str(if props.on { "true" } else { "false" });\n    fv::core::escape_into(out, &props.sub);`);
    expect(out).toContain(`{ use std::fmt::Write as _; let _ = write!(out, "{}", fv::strings::JsOr(props.m.map(fv::core::Js), "undefined")); }`);
    expect(out).toContain(`fv::core::push_number(out, props.score);\n    out.push_str(" points\\">x</a></li>");`);
  });

  it("asks for a string, a number or a boolean where a record is bound to an attribute", () => {
    const e = refusal(island(component("tags: { [key: string]: string }", `<div><p :title="tags">x</p></div>`)));
    expect(e.code).toBe("FV0403");
    expect(e.message).toMatch(/`title` is bound to .*; bind a string, a number or a boolean/);
  });

  it("refuses `:hidden` bound to a `?:` of a string and a number, whose branches it treats differently", () => {
    expect(refusal(island(component("on: boolean", `<div><p :hidden="on ? 'a' : 1">x</p></div>`))).code).toBe("FV0623");
    expect(compile(island(component("on: boolean", `<div><p :title="on ? 'a' : 1">x</p></div>`))).get("x.rs")).toContain("fv::core::Js(1i64)");
  });

  it("refuses an attribute that may fall through bound to a list, with its code", () => {
    const parent = `<script setup lang="ts">
import Child from "./Child.vue";
defineProps<{ xs?: string[] }>();
</script>
<template><div><Child :data-x="xs" /></div></template>`;
    const e = refusal(island(parent, { Child: component("label?: string", "<div>x</div>") }));
    expect(e.code).toBe("FV0412");
    expect(e.message).toContain("an attribute that may fall through is a string, a number or a boolean");
  });

  it("passes `null` and `undefined` on to a child as attributes Vue leaves out", () => {
    const parent = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><div><Child :data-n="null" :data-u="undefined" /></div></template>`;
    expect(compile(island(parent, { Child: component("label?: string", "<div>x</div>") })).get("x.rs")).toContain(
      `&fv::attrs::Attrs::new(&[("data-n", fv::attrs::Attr::Undefined), ("data-u", fv::attrs::Attr::Undefined)], "")`,
    );
  });

  it("refuses `className` passed to a child, which Vue renders by its own rule", () => {
    const parent = `<script setup lang="ts">
import Child from "./Child.vue";
defineProps<{ x: string }>();
</script>
<template><div><Child :className="x" /></div></template>`;
    const e = refusal(island(parent, { Child: component("label?: string", "<div>x</div>") }));
    expect(e.code).toBe("FV0409");
    expect(e.message).toContain("`className` renders by its own rule in Vue; bind `class`");
  });
});

describe("attribute objects", () => {
  const refused = (template: string, props = "label: string; k: string"): GenError => refusal(island(component(props, template)));

  it("refuses an object bound with `v-bind` that is not an object literal", () => {
    for (const template of [`<div><p v-bind="obj">x</p></div>`, `<div><p v-bind="Object({ title: label })">x</p></div>`]) {
      const e = refused(template);
      expect(e.code).toBe("FV0407");
      expect(e.message).toContain("attributes must be an object literal");
    }
  });

  it("refuses `$attrs` wrapped in a call, which is not an object literal", () => {
    const child = component("label?: string", `<div><p v-bind="Object($attrs)">x</p></div>`);
    expect(refusal(island(passing, { Child: child })).code).toBe("FV0407");
  });

  it("refuses a computed key or a spread in an attribute object, alone or merged", () => {
    for (const template of [`<div><p v-bind="{ [k]: label }">x</p></div>`, `<div><p v-bind="{ ...{ a: label } }">x</p></div>`, `<div><p :title="label" v-bind="{ [k]: 1 }">x</p></div>`]) {
      const e = refused(template);
      expect(e.code).toBe("FV0408");
      expect(e.message).toContain("attribute objects hold plain keys");
    }
  });

  it("refuses a computed key or a spread merged into the attributes of a `<RouterLink>`", () => {
    for (const bound of ["{ [k]: 1 }", "{ ...{ a: k } }"]) {
      const project = island(component("k: string", `<nav><RouterLink to="/" class="tab" v-bind="${bound}">go</RouterLink></nav>`));
      writeFileSync(join(project, "routes.json"), '["/"]');
      expect(refusal(project, { routes: "routes.json" }).code).toBe("FV0408");
    }
  });

  it("refuses `_mergeProps` of an object that is not a literal", () => {
    const e = refused(`<div><p :title="label" v-bind="obj">x</p></div>`);
    expect(e.code).toBe("FV0410");
    expect(e.message).toContain("`_mergeProps` of object literals is supported");
  });

  it("refuses `className` in an attribute object", () => {
    const e = refused(`<div><p v-bind="{ className: label }">x</p></div>`);
    expect(e.code).toBe("FV0409");
    expect(e.message).toContain("`className` renders by its own rule in Vue; bind `class`");
  });

  it("refuses a class merged after one that is not a literal, which Vue may write once", () => {
    const e = refused(`<div><p :class="label" v-bind="{ class: 'b' }">x</p></div>`);
    expect(e.code).toBe("FV0411");
    expect(e.message).toContain("a class merged with a string that may equal the class before it");
  });

  it("locates a refusal of a merged attribute away from the binding it replaces", () => {
    const e = refused(`<div><p :title="label"\n  v-bind="{ title: xs }">x</p></div>`, "label: string; xs: string[]");
    expect(e.code).toBe("FV0403");
    expect(e.at).not.toEqual({ file: "components/X.vue", line: 4, column: 20 });
  });
});

describe("attributes that fall through", () => {
  it("leaves out the keys Vue's server renderer skips, and passes the rest on with their names", () => {
    const child = component(
      "label?: string",
      `<div :title="label ?? ''" :key="1" @click="() => {}" v-bind="{ 'a.': 'x', 'a^': 'y', '^b': 'z', '.c': 'w', '': 'e', onx: 'o', 'data-icon-name': 'i', innerHTML: 'h', textContent: 't', ref_for: true, ref_key: 'k', key: 'k', ref: 'r' }">x</div>`,
    );
    const out = compile(island(passing, { Child: child })).get("child.rs")!;
    expect(out).toContain(`out.push_str(" a.=\\"x\\" a^=\\"y\\" b=\\"z\\" onx=\\"o\\" data-icon-name=\\"i\\"");`);
    expect(out).toContain(
      `fv::attrs::attrs_into(out, &[&[("title", fv::attrs::Attr::str(props.label.as_deref().unwrap_or("")))], &[("a.", fv::attrs::Attr::str("x")), ("a^", fv::attrs::Attr::str("y")), ("^b", fv::attrs::Attr::str("z")), ("onx", fv::attrs::Attr::str("o")), ("data-icon-name", fv::attrs::Attr::str("i"))], fv_attrs.list()], 2, "");`,
    );
  });

  it("passes the values of each type on as the attribute Vue would render", () => {
    const child = component(
      "i?: number; f?: Float; b: boolean | null",
      `<div :a="null" :u="undefined" :n="NONE" :i="i" :f="f" :b="b">x</div>`,
      `import type { Float } from "ferrovue/types";\nconst NONE = null;\n`,
    );
    const parent = passing.replace(`<Child data-x="1" />`, `<Child data-x="1" :b="null" />`);
    expect(compile(island(parent, { Child: child })).get("child.rs")).toContain(
      `fv::attrs::attrs_into(out, &[&[("a", fv::attrs::Attr::Undefined), ("u", fv::attrs::Attr::Undefined), ("n", fv::attrs::Attr::Undefined), ("i", props.i.map_or(fv::attrs::Attr::Undefined, fv::attrs::Attr::Int)), ("f", props.f.map_or(fv::attrs::Attr::Undefined, fv::attrs::Attr::Float)), ("b", props.b.map_or(fv::attrs::Attr::Undefined, fv::attrs::Attr::Bool))], fv_attrs.list()], 1, "");`,
    );
  });

  it("hands the scope ids to a root that holds only the attributes passed", () => {
    const out = compile(island(scopedPassing, { Child: component("label?: string", "<div>x</div>") })).get("child.rs")!;
    expect(out).toContain("out.push_str(fv_attrs.ids());");
    expect(out).toContain("fv::attrs::passed_attrs_into(out, fv_attrs.list(), fv_attrs.ids());");
  });

  it("leaves a client directive out of the attributes, where `_attrs` comes first or after the root's own", () => {
    const config = { clientDirectives: ["focus"] };
    const first = compile(island(scopedPassing, { Child: component("label?: string", `<div v-focus>x</div>`, focus) }), config).get("child.rs")!;
    expect(first).toContain("out.push_str(fv_attrs.ids());");
    expect(first).toContain("fv::attrs::attrs_into(out, &[fv_attrs.list()], 0, fv_attrs.ids());");
    const after = compile(island(scopedPassing, { Child: component("label?: string", `<div v-focus :title="label ?? ''">x</div>`, focus) }), config).get("child.rs")!;
    expect(after).toContain(`fv::attrs::attrs_into(out, &[&[("title", fv::attrs::Attr::str(props.label.as_deref().unwrap_or("")))], fv_attrs.list()], 1, fv_attrs.ids());`);
  });

  const handedIds = (inner: string): GenError => {
    const wrapper = `<script setup lang="ts">
import Inner from "./Inner.vue";
</script>
<template><Inner /></template>`;
    const parent = `<script setup lang="ts">
import W from "./W.vue";
</script>
<template><div><W data-x="1" /></div></template>
<style scoped>div { color: red }</style>`;
    return refusal(island(parent, { W: wrapper, Inner: inner }));
  };

  it("refuses `$attrs` in the root of a component that may be handed scope ids, with its code", () => {
    const e = handedIds(`<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>
<template><p><b v-bind="$attrs">x</b></p></template>`);
    expect(e.code).toBe("FV0406");
    expect(e.message).toContain("`$attrs` in Inner");
  });

  it("refuses `$attrs` wrapped in a call there as an object that is not a literal", () => {
    const e = handedIds(`<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>
<template><p><b v-bind="Object($attrs)">x</b></p></template>`);
    expect(e.code).toBe("FV0407");
  });

});

describe("custom directives", () => {
  it("accepts a directive resolved by name that the configuration lists, and names it where it does not", () => {
    const x = component("label: string", `<div><p v-focus>x</p></div>`);
    expect(compile(island(x), { clientDirectives: ["focus"] }).get("x.rs")).toContain(`out.push_str("<div><p>x</p></div>");`);
    const e = refusal(island(x));
    expect(e.code).toBe("FV0405");
    expect(e.message).toContain(
      "custom directive `v-focus` may add attributes on the server; if it has no `getSSRProps`, list `focus` in `clientDirectives` in ferrovue.config.json",
    );
  });

  it("names a directive of several words in kebab case", () => {
    const x = component("label: string", `<div><p v-foo-bar>x</p></div>`, "const vFooBar = { getSSRProps: () => ({}) };\n");
    expect(compile(island(x), { clientDirectives: ["foo-bar"] }).get("x.rs")).toContain(`out.push_str("<div><p>x</p></div>");`);
  });
});
