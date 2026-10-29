import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenError, GenErrors } from "../src/errors.ts";
import { generate } from "../src/compiler.ts";
import { like } from "./code.ts";

const roots: string[] = [];

function project(files: Record<string, string>): string {
  const made = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(made);
  const dir = join(made, "components");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return made;
}

function sfc(script: string, template: string): string {
  return `<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>\n`;
}

interface Case {
  files?: Record<string, string>;
  config?: Record<string, unknown>;
}

function render(script: string, template: string, { files = {}, config = {} }: Case = {}): string {
  const out = generate(project({ "X.vue": sfc(script, template), ...files }), { components: "components", out: "out", ...config }).get("x.rs")!;
  return /pub fn try_render[\s\S]*?\n}\n/.exec(out)![0];
}

function refusals(script: string, template: string, { files = {}, config = {} }: Case = {}): string[] {
  try {
    generate(project({ "X.vue": sfc(script, template), ...files }), { components: "components", out: "out", ...config });
  } catch (e) {
    const each = (one: unknown) => (one instanceof GenError ? `${one.code} ${one.what}${one.help === null ? "" : ` | ${one.help}`}` : String(one));
    if (e instanceof GenErrors) return e.errors.map(each);
    if (e instanceof GenError) return [each(e)];
    throw e;
  }
  throw new Error("compiled without an error");
}

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

const helper = (params: string[], returns = "string") => ({ helpers: { module: "./helpers", functions: { h: { rust: "crate::h", params, returns } } } });
const COMPUTE = "compute the value in Rust and pass it as a prop";

describe("names the server cannot evaluate", () => {
  const cases: [string, string, string, string, Case?][] = [
    [
      "a name imported from a module of the project that is no constant",
      "import { x } from './lib';",
      "<p>{{ x }}</p>",
      `FV0601 \`x\` is imported from \`./lib\`, a module the server does not run | export it from \`./lib\` as a constant the compiler evaluates (\`export const x = …\`), or ${COMPUTE}`,
      { files: { "lib.ts": "export let x = 1;" } },
    ],
    [
      "a call of a function imported from a module, with no helper module",
      "import { x } from './lib';",
      "<p>{{ x(1) }}</p>",
      `FV0601 \`x()\` calls a function imported from \`./lib\`, a module the server does not run | put \`x\` in the module \`helpers.module\` names with a Rust twin under \`helpers.functions\` in ferrovue.config.json, or ${COMPUTE}`,
      { files: { "lib.ts": "export let x = (n: number) => n;" } },
    ],
    [
      "a call of a function imported from a module, naming the helper module",
      "import { x } from './lib';",
      "<p>{{ x(1) }}</p>",
      `FV0601 \`x()\` calls a function imported from \`./lib\`, a module the server does not run | put \`x\` in \`./helpers\` with a Rust twin under \`helpers.functions\` in ferrovue.config.json, or ${COMPUTE}`,
      { files: { "lib.ts": "export let x = (n: number) => n;" }, config: helper(["int"]) },
    ],
    ["a name nothing declares", "", "<p>{{ nope }}</p>", "FV0601 `nope` is not available when rendering on the server"],
    [
      "a call of a name nothing declares",
      "",
      "<p>{{ nope(1) }}</p>",
      `FV0601 \`nope()\` is not available when rendering on the server | a template calls JavaScript's built-ins and the helpers with Rust twins under \`helpers.functions\` in ferrovue.config.json; ${COMPUTE}`,
    ],
    [
      "a function named without a call",
      "function f() { return 1; }",
      '<p v-for="g in [1]">{{ f }}{{ g }}</p>',
      "FV0613 `f` is set up in a way the server cannot evaluate: it is a function, which the template and a `computed` may call, and only an event handler may name without calling it | call it, as `f(…)`, which the server translates, or name it only in an event handler",
    ],
    [
      "a function of a `.ts` file named without a call",
      "import { f } from './lib';",
      "<p>{{ f }}</p>",
      "FV0613 `f` is set up in a way the server cannot evaluate: it is a function imported from components/lib.ts, which the template and a `computed` may call, and only an event handler may name without calling it | call it, as `f(…)`, which the server translates, or name it only in an event handler",
      { files: { "lib.ts": "export function f() { return 1; }" } },
    ],
    ["a binding with no value", "let x: number;", "<p>{{ x }}</p>", `FV0613 \`x\` is set up in a way the server cannot evaluate: it has no initial value | ${COMPUTE}, or read it only from an event handler`],
    [
      "a call of a binding with no value",
      "let x: () => number;",
      "<p>{{ x() }}</p>",
      `FV0613 \`x\` is set up in a way the server cannot evaluate: it has no initial value | put \`x\` in the module \`helpers.module\` names with a Rust twin under \`helpers.functions\` in ferrovue.config.json, or ${COMPUTE}`,
    ],
    [
      "a call of a binding with no value, naming the helper module",
      "let x: () => number;",
      "<p>{{ x() }}</p>",
      `FV0613 \`x\` is set up in a way the server cannot evaluate: it has no initial value | put \`x\` in \`./helpers\` with a Rust twin under \`helpers.functions\` in ferrovue.config.json, or ${COMPUTE}`,
      { config: helper(["int"]) },
    ],
    [
      "a name destructured from a value the server does not have",
      "const { a } = useX();",
      "<p>{{ a }}</p>",
      `FV0613 \`a\` is set up in a way the server cannot evaluate: it is destructured from a value the server does not have | ${COMPUTE}, or read it only from an event handler`,
    ],
    [
      "a call of a name destructured from a value the server does not have",
      "const { a } = useX();",
      "<p>{{ a() }}</p>",
      `FV0613 \`a\` is set up in a way the server cannot evaluate: it is destructured from a value the server does not have | put \`a\` in the module \`helpers.module\` names with a Rust twin under \`helpers.functions\` in ferrovue.config.json, or ${COMPUTE}`,
    ],
    ["a refused binding the template reads", "const x = /a/;", "<p>{{ x }}</p>", "FV0710 a regular expression in setup, which the server does not run (the template reads it as `x` at components/X.vue:4:17)"],
    [
      "a refused binding a `computed` reads",
      "import { computed } from 'vue';\nconst x = /a/;\nconst c = computed(() => x);",
      "<p>{{ c }}</p>",
      "FV0710 a regular expression in setup, which the server does not run (a `computed` reads it as `x` at components/X.vue:4:26) (the template reads it as `c` at components/X.vue:6:17)",
    ],
    [
      "a refused binding a function reads",
      "const x = /a/;\nfunction f() { return x; }",
      "<p>{{ f() }}</p>",
      "FV0710 a regular expression in setup, which the server does not run (a function reads it as `x` at components/X.vue:3:23) (in `f()`, called at components/X.vue:5:17)",
    ],
    [
      "a refused binding setup reads",
      "const x = /a/;\nconst y = x;",
      "<p>{{ y }}</p>",
      "FV0710 a regular expression in setup, which the server does not run (setup reads it as `x` at components/X.vue:3:11) (the template reads it as `y` at components/X.vue:5:17)",
    ],
    ["a regular expression in a `computed`", "import { computed } from 'vue';\nconst c = computed(() => /a/.exec('a'));", "<p>{{ c }}</p>", "FV0710 a regular expression in a `computed`, which the server does not run (the template reads it as `c` at components/X.vue:5:17)"],
    ["a regular expression in a function", "function f() { return /a/.exec('a'); }", "<p>{{ f() }}</p>", "FV0710 a regular expression in a function, which the server does not run (in `f()`, called at components/X.vue:4:17)"],
    ["a regular expression in a template", "", "<p>{{ /a/.exec('a') }}</p>", "FV0710 a regular expression in a template, which the server does not run"],
    ["a class in a `computed`", "import { computed } from 'vue';\nconst c = computed(() => class {});", "<p>{{ c }}</p>", "FV0625 a class is not supported in a `computed` (the template reads it as `c` at components/X.vue:5:17)"],
    ["a class in a function", "function f() { return class {}; }", "<p>{{ f() }}</p>", "FV0625 a class is not supported in a function (in `f()`, called at components/X.vue:4:17)"],
    ["a class in setup", "const c = class {};", "<p>{{ c }}</p>", "FV0625 a class is not supported in setup (the template reads it as `c` at components/X.vue:4:17)"],
  ];

  for (const [what, script, template, message, more] of cases) {
    it(`refuses ${what}`, () => {
      expect(refusals(script, template, more)).toEqual([message]);
    });
  }
});

describe("values handed to a function or a prop", () => {
  const h = "import { h } from './helpers';\n";
  const writes: [string, string, string, string[], string][] = [
    ["an integer to an integer", "n: number", "h(n)", ["int"], "crate::h(props.n)"],
    ["an integer to a float", "n: number", "h(n)", ["float"], "crate::h(props.n as f64)"],
    ["an integer to an optional float", "n: number", "h(n)", ["float?"], "crate::h(Some(props.n as f64))"],
    ["an integer literal to an optional float", "n: number", "h(2)", ["float?"], "crate::h(Some(2.0f64))"],
    ["a string to an optional string", "s: string", "h(s)", ["string?"], "crate::h(Some(&*props.s))"],
    ["an optional string to an optional string", "s?: string", "h(s)", ["string?"], "crate::h(props.s.as_deref())"],
    ["`undefined` to an optional string", "s?: string", "h(undefined)", ["string?"], "crate::h(None)"],
    ["an optional integer to an optional integer", "n?: number", "h(n)", ["int?"], "crate::h(props.n)"],
  ];

  for (const [what, props, call, params, code] of writes) {
    it(`hands ${what}`, () => {
      expect(render(`${h}defineProps<{ ${props} }>();`, `<p>{{ ${call} }}</p>`, { config: helper(params) })).toMatch(like(`fv::core::escape_into(out, ${code});`));
    });
  }

  const refused: [string, string, string, string[], string][] = [
    ["`null` to an optional string", "s?: string", "h(null)", ["string?"], "FV0606 a value that may be `null` where the function takes an optional string, which Vue would hand it as it is: write `?? undefined` after it"],
    ["an optional integer to an optional float", "n?: number", "h(n)", ["float?"], 'FV0607 a {"k":"opt","of":{"k":"int"}} where {"k":"opt","of":{"k":"float"}} is expected'],
    ["a string to an integer", "s: string", "h(s)", ["int"], 'FV0607 a {"k":"str"} where {"k":"int"} is expected'],
    ["a float to an integer", "f: number", "h(f / 2)", ["int"], 'FV0607 a {"k":"float"} where {"k":"int"} is expected'],
    ["a float to an optional integer", "f: number", "h(f / 2)", ["int?"], 'FV0607 a {"k":"float"} where {"k":"opt","of":{"k":"int"}} is expected'],
    ["a boolean to an optional float", "b: boolean", "h(b)", ["float?"], 'FV0607 a {"k":"bool"} where {"k":"opt","of":{"k":"float"}} is expected'],
    ["an optional string to a string", "s?: string", "h(s)", ["string"], "FV0606 a value that may be `undefined` where the function takes a string, which Vue would hand it as it is: narrow it with `v-if` first"],
    ["a nullable string to a string", "s: string | null", "h(s)", ["string"], "FV0606 a value that may be `null` where the function takes a string, which Vue would hand it as it is: narrow it with `v-if` first"],
    ["a nullable string to an optional string", "s: string | null", "h(s)", ["string?"], "FV0606 a value that may be `null` where the function takes an optional string, which Vue would hand it as it is: write `?? undefined` after it"],
    ["a string to a float", "s: string", "h(s)", ["float"], 'FV0607 a {"k":"str"} where {"k":"float"} is expected'],
    ["a list of integers to an optional integer", "s: string", "h([1, 2])", ["int?"], 'FV0607 a {"k":"list","of":{"k":"int"}} where {"k":"opt","of":{"k":"int"}} is expected'],
  ];

  for (const [what, props, call, params, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(refusals(`${h}defineProps<{ ${props} }>();`, `<p>{{ ${call} }}</p>`, { config: helper(params) })).toEqual([message]);
    });
  }

  it("refuses a value that may be `null` or `undefined` where a function takes a string", () => {
    expect(refusals(`${h}defineProps<{ k: "a" | "b" | "c" }>();\nconst T = { a: null, b: "B" };`, "<p>{{ h(T[k]) }}</p>", { config: helper(["string"]) })).toEqual([
      "FV0606 a value that may be `null` or `undefined` where the function takes a string, which Vue would hand it as it is: narrow it with `v-if` first",
    ]);
  });

  it("refuses a value that may be `undefined` where a child's prop takes `null`", () => {
    const child = { files: { "Y.vue": sfc("defineProps<{ v: string | null }>();", "<p>{{ v }}</p>") } };
    expect(refusals("import Y from './Y.vue';\ndefineProps<{ u?: string }>();", '<Y :v="u" />', child)).toEqual([
      "FV0606 a value that may be `undefined` where the prop takes a string or `null`, which Vue would hand it as it is: write `?? null` after it",
    ]);
  });
});

describe("the types a refusal names", () => {
  const field: [string, string, string][] = [
    ["v: string | null", "v.x", "FV0604 `.x` of a string or `null`, which may be absent: narrow it with `v-if` first, or read it with `?.x`"],
    ["v?: number", "v.x", "FV0604 `.x` of an optional number, which may be absent: narrow it with `v-if` first, or read it with `?.x`"],
    ["v: number", "v.x", "FV0604 `.x` of a number, which has no field `x`"],
    ["v: number", "(v / 2).x", "FV0604 `.x` of a number, which has no field `x`"],
    ["v: Date", "v.x", "FV0604 `.x` of a `Date`, which has no field `x`"],
    ["v: Record<string, string>", "v.x", "FV0604 `.x` of a record, which has no field `x`"],
    ["v: string[]", "v.x", "FV0604 `.x` of a list, which has no field `x`"],
    ["v: boolean", "v.x", "FV0604 `.x` of a boolean, which has no field `x`"],
    ["v: Record<string, string>", "Object.entries(v)[0].x", "FV0604 `.x` of an optional `[key, value]` pair, which may be absent: narrow it with `v-if` first, or read it with `?.x`"],
    ["v: Record<string, string>", "Object.entries(v).map((e) => e.x).join()", "FV0604 `.x` of a `[key, value]` pair, which has no field `x`"],
    ["v: string", "undefined.x", "FV0604 `.x` of `undefined`, which may be absent: narrow it with `v-if` first, or read it with `?.x`"],
    ["v: string", "null.x", "FV0604 `.x` of `null`, which may be absent: narrow it with `v-if` first, or read it with `?.x`"],
  ];

  for (const [props, read, message] of field) {
    it(`names the type of \`${read}\` where \`${props}\``, () => {
      expect(refusals(`defineProps<{ ${props} }>();`, `<p>{{ ${read} }}</p>`)).toEqual([message]);
    });
  }

  it("names a struct with no such field", () => {
    expect(refusals("interface Item { a: string }\ndefineProps<{ item: Item }>();", "<p>{{ item.b }}</p>")).toEqual(["FV0605 `Item` has no field `b`"]);
  });
});

describe("slots read in a template", () => {
  it("tests whether a slot is given, through `$slots` and `useSlots()`", () => {
    const given = "if fv_slots.default.is_some() {";
    expect(render("", '<p v-if="$slots.default">a</p><slot />')).toMatch(like(given));
    expect(render("import { useSlots } from 'vue';\nconst sl = useSlots();", '<p v-if="sl.default">a</p><slot />')).toMatch(like(given));
    expect(render("import { useSlots, computed } from 'vue';\nconst sl = useSlots();\nconst c = computed(() => !!sl.default);", '<p v-if="c">a</p><slot />')).toMatch(like("let s_c = fv_slots.default.is_some();"));
    expect(render("import { useSlots } from 'vue';\nconst sl = useSlots();", '<p v-for="sl in [1]">{{ sl }}</p><slot />')).toMatch(like("fv::core::push_int(out, sl);"));
  });

  it("refuses a slot the template does not render", () => {
    expect(refusals("", "<p>{{ $slots.x }}</p>")).toEqual(["FV0907 `$slots.x` names a slot this template does not render"]);
    expect(refusals("import { useSlots } from 'vue';\nconst sl = useSlots();", '<p v-if="sl.other">a</p><slot />')).toEqual(["FV0907 `sl.other` names a slot this template does not render"]);
  });
});

describe("fields of a struct", () => {
  it("reads an enum field, optional, with a default and without", () => {
    expect(render('interface Item { k: "a" | "b" }\ndefineProps<{ item: Item }>();', "<p>{{ item.k }}</p>")).toMatch(like("fv::core::escape_into(out, fv::props::Union::as_str(props.item.k));"));
    expect(render('interface Item { k?: "a" | "b" }\ndefineProps<{ item: Item }>();', "<p>{{ item.k }}</p>")).toMatch(like("if let Some(v) = props.item.k.map(fv::props::Union::as_str) {"));
    expect(render('withDefaults(defineProps<{ k?: "a" | "b" }>(), { k: "b" });', "<p>{{ k }}</p>")).toMatch(like("fv::core::escape_into(out, fv::props::Union::as_str(props.k.unwrap_or(XK::B)));"));
  });

  it("reads each kind of optional prop", () => {
    const out = render("defineProps<{ d?: Date; s?: string; n?: number; b?: boolean; l?: string[] }>();", "<p>{{ d?.getTime() }} {{ s }} {{ n }} {{ b }} {{ l?.length }}</p>");
    expect(out).toMatch(like("if let Some(v) = props.d.as_ref().map(fv::date::js_time_of) {"));
    expect(out).toMatch(like("if let Some(v) = props.s.as_deref() {"));
    expect(out).toMatch(like("if let Some(v) = props.n {"));
    expect(out).toMatch(like('out.push_str(if props.b.unwrap_or(false) { "true" } else { "false" });'));
    expect(out).toMatch(like("if let Some(v) = props.l.as_ref().map(|fv_o2| fv_o2.len() as i64) {"));
  });
});

describe("types stated with `as` and `satisfies`", () => {
  const card = "interface Card { label: string }\n";
  const c = (body: string, pre = "") => `import { computed } from "vue";\n${card}${pre}const props = defineProps<{ s: string; n: number; on: boolean }>();\nconst c = computed(() => ${body});`;

  it("keeps a value whose stated type it has", () => {
    expect(render(c("props.s as const"), "<p>{{ c }}</p>")).toMatch(like("let s_c = &*props.s;"));
    expect(render(c("props.n as number"), "<p>{{ c }}</p>")).toMatch(like("let s_c = props.n;"));
    expect(render(c("props.s as string | undefined"), "<p>{{ c }}</p>")).toMatch(like("let s_c = &*props.s;"));
    expect(render(c("props.n as Float", 'import type { Float } from "ferrovue/types";\n'), "<p>{{ c }}</p>")).toMatch(like("let s_c = props.n;"));
  });

  it("builds an object literal and a list of them as the struct stated", () => {
    const one = 'let s_c = Card { label: std::borrow::Cow::<str>::Borrowed("x") };';
    expect(render(c("({ label: 'x' } as Card)"), "<p>{{ c.label }}</p>")).toMatch(like(one));
    expect(render(c("({ label: 'x' } as Card | undefined)"), "<p>{{ c?.label }}</p>")).toMatch(like(one));
    expect(render(c("(({ label: 'x' }) as Card)"), "<p>{{ c.label }}</p>")).toMatch(like(one));
    const list = 'let s_c = Vec::from([Card { label: std::borrow::Cow::<str>::Borrowed("x") }]);';
    expect(render(c("[{ label: 'x' }] as Card[]"), '<p v-for="x in c">{{ x.label }}</p>')).toMatch(like(list));
    expect(render(c("([{ label: 'x' }]) as Card[]"), '<p v-for="x in c">{{ x.label }}</p>')).toMatch(like(list));
  });

  it("types an empty array literal by the list stated", () => {
    expect(render(c("[] as Card[]"), '<p v-for="x in c">{{ x.label }}</p>')).toMatch(like("let s_c = <&[Card<'_>]>::default();"));
    expect(render(c("[] as Card[] | undefined"), '<p v-for="x in c ?? []">{{ x.label }}</p>')).toMatch(like("let s_c = <&[Card<'_>]>::default();"));
    expect(render(c("[] as string[]"), '<p v-for="x in c">{{ x }}</p>')).toMatch(like("let s_c = <&[std::borrow::Cow<str>]>::default();"));
    expect(render(c('["a"] as string[]'), '<p v-for="x in c">{{ x }}</p>')).toMatch(like('let s_c = &["a"];'));
  });

  const refused: [string, string, string, string][] = [
    ["`as const` with type arguments", "props.s as const<string>", "<p>{{ c }}</p>", "FV0315 unsupported prop type `const`: declare it as an interface in the component, or import it from a `.ts` file (the template reads it as `c` at components/X.vue:7:17)"],
    ["`as` a string of a number", "props.n as string", "<p>{{ c }}</p>", "FV0628 `as` states a string of a number, which the server keeps as it is: write the value with the type it has (the template reads it as `c` at components/X.vue:7:17)"],
    ["`satisfies` a string of a number", "props.n satisfies string", "<p>{{ c }}</p>", "FV0628 `satisfies` states a string of a number, which the server keeps as it is: write the value with the type it has (the template reads it as `c` at components/X.vue:7:17)"],
    ["an object literal stated as a `Record`", "({ a: 'x' } as Record<string, string>)", "<p>{{ c.a }}</p>", "FV0634 an object literal given where a `Record` is taken, which the server reads from Rust: pass the dictionary as a prop (the template reads it as `c` at components/X.vue:7:17)"],
    ["an object literal stated as a string", "({ a: 'x' } as string)", "<p>{{ c }}</p>", "FV0628 `as` states a string of an object literal (the template reads it as `c` at components/X.vue:7:17)"],
    ["an object literal that `satisfies` a string", "({ a: 'x' } satisfies string)", "<p>{{ c }}</p>", "FV0628 `satisfies` states a string of an object literal (the template reads it as `c` at components/X.vue:7:17)"],
    ["an empty array literal stated as a string", "[] as string", "<p>{{ c }}</p>", "FV0628 `as` gives an empty array literal a string, which it is not (the template reads it as `c` at components/X.vue:7:17)"],
    ["an empty array literal that `satisfies` a string", "[] satisfies string", "<p>{{ c }}</p>", "FV0628 `satisfies` gives an empty array literal a string, which it is not (the template reads it as `c` at components/X.vue:7:17)"],
    ["a list of numbers stated as a list of structs", "[1] as Card[]", '<p v-for="x in c">{{ x }}</p>', "FV0635 an array literal of `Card` objects holds a number (the template reads it as `c` at components/X.vue:7:26)"],
    ["`as` a list of a string", "props.s as string[]", "<p>{{ c }}</p>", "FV0628 `as` states a list of a string, which the server keeps as it is: write the value with the type it has (the template reads it as `c` at components/X.vue:7:17)"],
    ["a type nothing declares", '"a" as Nope', "<p>{{ c }}</p>", "FV0315 unsupported prop type `Nope`: declare it as an interface in the component, or import it from a `.ts` file (the template reads it as `c` at components/X.vue:7:17)"],
    ["an empty list of a type nothing declares", "[] as Nope[]", '<p v-for="x in c">{{ x }}</p>', "FV0315 unsupported prop type `Nope`: declare it as an interface in the component, or import it from a `.ts` file (the template reads it as `c` at components/X.vue:7:26)"],
    [
      "a list of object literals stated as a list of strings",
      "[{ label: 'x' }] as string[]",
      '<p v-for="x in c">{{ x }}</p>',
      "FV0634 an object literal in a `computed` whose type is not known, which the server builds as the Rust struct of an interface: annotate the `computed`, as `computed<Card>(() => …)` or `computed((): Card => …)` (the template reads it as `c` at components/X.vue:7:26)",
    ],
  ];

  for (const [what, body, template, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(refusals(c(body), template)).toEqual([message]);
    });
  }

  it("refuses a list of object literals where a list of other values is taken", () => {
    const unknown = (where: string) => `FV0634 an object literal in ${where} whose type is not known, which the server builds as the Rust struct of an interface`;
    expect(refusals('import { computed } from "vue";\nconst c = computed((): string[] => [{ label: "x" }]);', '<p v-for="x in c">{{ x }}</p>')[0]).toMatch(like(unknown("a `computed`")));
    expect(refusals('import { computed } from "vue";\nconst props = defineProps<{ on: boolean }>();\nconst c = computed((): number[] => [props.on ? { a: 1 } : { a: 2 }]);', '<p v-for="x in c">{{ x }}</p>')[0]).toMatch(like(unknown("a `computed`")));
    expect(refusals("function f(): string[] { return [{ a: 1 }]; }", '<p v-for="x in f()">{{ x }}</p>')[0]).toMatch(like(unknown("a function")));
    const child = { files: { "Y.vue": sfc("defineProps<{ v: string[] }>();", '<p v-for="x in v">{{ x }}</p>') } };
    expect(refusals('import Y from "./Y.vue";', '<Y :v="[{ a: 1 }]" />', child)[0]).toMatch(like(unknown("the template")));
  });

  it("types the object literals a return type states, in branches and nested lists", () => {
    const tern = 'Vec::from([if props.on { Card { label: std::borrow::Cow::<str>::Borrowed("a") } } else { Card { label: std::borrow::Cow::<str>::Borrowed("b") } }])';
    expect(render(`import { computed } from "vue";\n${card}const props = defineProps<{ on: boolean }>();\nconst c = computed((): Card[] => [props.on ? { label: "a" } : { label: "b" }]);`, '<p v-for="x in c">{{ x.label }}</p>')).toMatch(like(`let s_c = ${tern};`));
    expect(render(`import { computed } from "vue";\n${card}const c = computed((): Card[] => [({ label: "a" })]);`, '<p v-for="x in c">{{ x.label }}</p>')).toMatch(like('let s_c = Vec::from([Card { label: std::borrow::Cow::<str>::Borrowed("a") }]);'));
    expect(render(`import { computed } from "vue";\n${card}const props = defineProps<{ ws: string[] }>();\nconst c = computed((): Card[] => props.ws.map((w) => ({ label: w })));`, '<p v-for="x in c">{{ x.label }}</p>')).toMatch(like(
      "let s_c = props.ws.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).map(|fv_s1| Card { label: std::borrow::Cow::<str>::Owned(str::to_owned(&*fv_s1)) }).collect::<Vec<_>>();",
    ));
    expect(render(`import { computed } from "vue";\n${card}const props = defineProps<{ c?: Card }>();\nconst c = computed((): Card => props.c ?? { label: "a" });`, "<p>{{ c.label }}</p>")).toMatch(like(
      'let s_c = props.c.as_ref().cloned().unwrap_or(Card { label: std::borrow::Cow::<str>::Borrowed("a") });',
    ));
    expect(render(`import { computed } from "vue";\n${card}const c = computed((): Card[] => []);`, '<p v-for="x in c">{{ x.label }}</p>')).toMatch(like("let s_c = <&[Card<'_>]>::default();"));
  });
});

describe("`&&` after a value that may be absent", () => {
  it("gives the right side where the left is present and always truthy", () => {
    expect(render("interface C { a: string }\ndefineProps<{ c?: C }>();", "<p>{{ c && c.a }}</p>")).toMatch(like("if let Some(v) = props.c.as_ref().map(|n1| &*n1.a) {"));
    expect(render("interface C { a: string }\ndefineProps<{ c: C | null }>();", "<p>{{ c && c.a }}</p>")).toMatch(like("if let Some(v) = props.c.as_ref().map(|n1| &*n1.a) {"));
    expect(render('defineProps<{ k?: "a" | "b" }>();', "<p>{{ k && 'x' }}</p>")).toMatch(like('if let Some(v) = props.k.map(|n1| "x") {'));
    expect(render("defineProps<{ l?: string[] }>();", "<p>{{ l && 'x' }}</p>")).toMatch(like('if let Some(v) = props.l.as_ref().map(|n1| "x") {'));
    expect(render("defineProps<{ d?: Date }>();", "<p>{{ d && 'x' }}</p>")).toMatch(like('if let Some(v) = props.d.as_ref().map(fv::date::js_time_of).map(|n1| "x") {'));
    expect(render('defineProps<{ k: "a" | "b" }>();\nconst T = { a: { x: "1" } };', "<p>{{ T[k] && T[k].x }}</p>")).toMatch(like('if let Some(v) = matches!(props.k, XK::A).then_some(()).map(|n1| "1") {'));
  });

  const falsy = (is: string) =>
    `FV0614 \`&&\` gives its left side where that is falsy, and this one, ${is}, may be falsy where it is present (\`""\`, \`0\`, \`false\`), which the value on the right cannot stand for | test it with \`!= null\` for a boolean, or write \`?:\` with the value each side gives`;
  const refused: [string, string, string][] = [
    ['k?: "" | "b"', "k && 'x'", falsy("an optional string")],
    ["k?: 0 | 1", "k && 'x'", falsy("an optional number")],
    ["s?: string", "s && 'x'", falsy("an optional string")],
  ];

  for (const [props, read, message] of refused) {
    it(`refuses \`${read}\` where \`${props}\``, () => {
      expect(refusals(`defineProps<{ ${props} }>();`, `<p>{{ ${read} }}</p>`)).toEqual([message]);
    });
  }
});

describe("items read by `[…]`", () => {
  it("reads a list's item by an integer index", () => {
    const out = render("defineProps<{ l: string[]; i: number }>();", "<p>{{ l[0] }}|{{ l[2] }}|{{ l[-1] }}|{{ l[i] }}|{{ l.filter((x) => !!x)[0] }}</p>");
    expect(out).toMatch(like("if let Some(v) = props.l.first().map(|v| &**v) {"));
    expect(out).toMatch(like("if let Some(v) = props.l.get(2).map(|v| &**v) {"));
    expect(out).toMatch(like("if let Some(v) = props.l.get(usize::try_from(-1i64).unwrap_or(usize::MAX)).map(|v| &**v) {"));
    expect(out).toMatch(like("if let Some(v) = props.l.get(usize::try_from(props.i).unwrap_or(usize::MAX)).map(|v| &**v) {"));
    expect(out).toMatch(like(".filter(|fv_s1| !fv_s1.is_empty()).nth(usize::try_from(0i64).unwrap_or(usize::MAX)).as_deref() {"));
  });

  it("reads a string's character by an integer index, holding it where the string is computed", () => {
    expect(render("defineProps<{ s: string; i: number }>();", "<p>{{ s[i] }}</p>")).toMatch(like("if let Some(v) = Some(fv::strings::js_char_at(&props.s, props.i as f64)).filter(|c| !c.is_empty()) {"));
    expect(render("defineProps<{ s: string; i: number }>();", "<p>{{ (s + 'x')[i] }}</p>")).toMatch(like(
      'if let Some(v) = Some(fv::strings::js_char_at(&format!("{}x", props.s), props.i as f64)).filter(|c| !c.is_empty()).map(|v| std::borrow::Cow::<str>::Owned(v.to_owned())).as_deref() {',
    ));
    expect(render("defineProps<{ s: string; i: number }>();", "<p>{{ s.toUpperCase()[i] ?? '-' }}</p>")).toMatch(like(
      'fv::core::escape_into(out, &Some(fv::strings::js_char_at(&props.s.to_uppercase(), props.i as f64)).filter(|c| !c.is_empty()).map(|v| std::borrow::Cow::<str>::Owned(v.to_owned())).unwrap_or(std::borrow::Cow::<str>::Borrowed("-")));',
    ));
  });

  it("reads the parts of a `[key, value]` pair by a literal index", () => {
    expect(render("defineProps<{ r: Record<string, number> }>();", '<p v-for="e in Object.entries(r).map((p) => p[1])">{{ e }}</p>')).toMatch(like("for e in props.r.iter().map(|fv_a1| *fv_a1.1) {"));
  });

  const index = "`[…]` reads a list's item by an integer index";
  const refused: [string, string, string][] = [
    ["l: string[]; f: number", "l[f / 2]", `FV0824 ${index}, a \`number\` that is present, and this index is a \`Float\`, which may hold a fraction or be \`NaN\`: \`.at()\` takes any number`],
    ["l: string[]; f: number", "l[Math.sqrt(f)]", `FV0824 ${index}, a \`number\` that is present, and this index is a \`Float\`, which may hold a fraction or be \`NaN\`: \`.at()\` takes any number`],
    ["l: string[]; s: string", "l[s]", `FV0824 ${index}, a \`number\` that is present, and this index is a string: \`.at()\` takes any number`],
    ["s: string; f: number", "s[f / 2]", "FV0612 `[…]` reads a string's character by an integer index, a `number` that is present, and this index is a `Float`, which may hold a fraction or be `NaN`: `.at()` and `.charAt()` take any number"],
    ["s: string; t: string", "s[t]", "FV0612 `[…]` reads a string's character by an integer index, a `number` that is present, and this index is a string: `.at()` and `.charAt()` take any number"],
    ["b: boolean", "b[0]", "FV0612 computed member access of a boolean: `[…]` reads an item of a list, by an integer index"],
    ["r: Record<string, string>", "r['a']", "FV0612 computed member access of a record: `[…]` reads an item of a list, by an integer index"],
  ];
  for (const getter of ["getUTCDay", "getTime", "valueOf"]) {
    refused.push([
      "l: string[]; d: Date",
      `l[d.${getter}()]`,
      `FV0824 ${index}, and \`.${getter}()\` of a date is a \`Float\`: it is \`NaN\` for an invalid date, where \`[…]\` reads \`undefined\` | \`.at(…)\` reads the item for any number, the first one for \`NaN\`; or pick the item in Rust and pass it as a prop`,
    ]);
  }
  for (const part of ["-1", "0.5", "i"]) {
    refused.push(["r: Record<string, number>; i: number", `Object.entries(r).map((p) => p[${part}]).join()`, "FV0612 `[…]` reads a part of a `[key, value]` pair by a literal index: `pair[0]` is its key and `pair[1]` its value"]);
  }

  for (const [props, read, message] of refused) {
    it(`refuses \`${read}\` where \`${props}\``, () => {
      expect(refusals(`defineProps<{ ${props} }>();`, `<p>{{ ${read} }}</p>`)).toEqual([message]);
    });
  }

  it("reads a field of an object by a literal key, and refuses a key of another kind", () => {
    expect(render("interface C { a: string }\ndefineProps<{ c: C; k: string }>();", "<p>{{ c['a'] }}</p>")).toMatch(like("fv::core::escape_into(out, &props.c.a);"));
    expect(refusals("interface C { a: string }\ndefineProps<{ c: C; k: string }>();", "<p>{{ c[k] }}</p>")).toEqual(["FV0612 computed member access of an object: `[…]` reads an item of a list, by an integer index"]);
  });
});

describe("optional chains", () => {
  const read = (props: string, chain: string) => render(`defineProps<{ ${props} }>();`, `<p>{{ ${chain} }}</p>`);
  const c = "interface D { b: string }\ninterface C { a: string; o?: string; d: D }\n";
  const struct = (chain: string, optional = true) => render(`${c}defineProps<{ c${optional ? "?" : ""}: C }>();`, `<p>{{ ${chain} }}</p>`);

  it("maps the rest of the chain over a value that may be absent", () => {
    expect(struct("c?.a.toUpperCase()")).toMatch(like("if let Some(v) = props.c.as_ref().map(|fv_o1| std::borrow::Cow::<str>::Owned(fv_o1.a.to_uppercase())).as_deref() {"));
    expect(struct("c?.a?.length")).toMatch(like("if let Some(v) = props.c.as_ref().map(|fv_o1| &*fv_o1.a).map(fv::strings::js_length) {"));
    expect(struct("c?.a", false)).toMatch(like("fv::core::escape_into(out, &props.c.a);"));
    expect(struct("c?.o")).toMatch(like("if let Some(v) = props.c.as_ref().and_then(|fv_o1| fv_o1.o.as_deref()) {"));
    expect(struct("c?.d.b")).toMatch(like("if let Some(v) = props.c.as_ref().map(|fv_o1| &*fv_o1.d.b) {"));
    expect(read("s?: string", "s?.toString()")).toMatch(like("if let Some(v) = props.s.as_deref() {"));
    expect(read("s?: string", "s?.trim()")).toMatch(like("if let Some(v) = props.s.as_deref().map(fv::strings::js_trim) {"));
    expect(read("s: string", "undefined?.a")).toMatch(like('out.push_str("<p></p>");'));
    expect(read("s: string", "null?.a")).toMatch(like('out.push_str("<p></p>");'));
  });

  it("holds what the chain computes", () => {
    expect(read("l?: string[]", "l?.[0]?.toUpperCase()")).toMatch(like(
      "if let Some(v) = props.l.as_ref().and_then(|fv_o1| fv_o1.first().map(|v| &**v)).map(|fv_o2| std::borrow::Cow::<str>::Owned(fv_o2.to_uppercase())).as_deref() {",
    ));
    expect(read("s?: string", "s?.toUpperCase().at(0)")).toMatch(like(
      "if let Some(v) = props.s.as_deref().and_then(|fv_o1| fv::strings::js_at(&fv_o1.to_uppercase(), 0.0f64).map(|v| std::borrow::Cow::<str>::Owned(v.to_owned()))).as_deref() {",
    ));
    expect(read("s?: string", "s?.toUpperCase()")).toMatch(like("if let Some(v) = props.s.as_deref().map(|fv_o1| std::borrow::Cow::<str>::Owned(fv_o1.to_uppercase())).as_deref() {"));
    expect(read("l?: string[]", "l?.join('-').toUpperCase()")).toMatch(like(
      'if let Some(v) = props.l.as_ref().map(|fv_o1| std::borrow::Cow::<str>::Owned(fv_o1.iter().map(|v| &**v).collect::<Vec<_>>().join("-").to_uppercase())).as_deref() {',
    ));
    expect(read("s?: string", "s?.toUpperCase()?.trim()")).toMatch(like(
      "if let Some(v) = props.s.as_deref().map(|fv_o1| std::borrow::Cow::<str>::Owned(fv_o1.to_uppercase())).as_deref().map(|fv_o2| std::borrow::Cow::<str>::Owned(fv::strings::js_trim(fv_o2).to_owned())).as_deref() {",
    ));
    expect(read("l?: string[]", "l?.[0]?.at(0)")).toMatch(like("if let Some(v) = props.l.as_ref().and_then(|fv_o1| fv_o1.first().map(|v| &**v)).and_then(|fv_o2| fv::strings::js_at(fv_o2, 0.0f64)) {"));
    expect(read("s?: string", "s?.toUpperCase()?.at(0)")).toMatch(like(
      "if let Some(v) = props.s.as_deref().map(|fv_o1| std::borrow::Cow::<str>::Owned(fv_o1.to_uppercase())).as_deref().and_then(|fv_o2| fv::strings::js_at(fv_o2, 0.0f64).map(|v| std::borrow::Cow::<str>::Owned(v.to_owned()))).as_deref() {",
    ));
    expect(render("defineProps<{ l?: string[] }>();", '<p v-for="x in l?.filter((y) => !!y) ?? []">{{ x }}</p>')).toMatch(like(
      "for x_ref in props.l.as_ref().map(|fv_o1| fv_o1.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).filter(|fv_s2| !fv_s2.is_empty()).map(|v| std::borrow::Cow::<str>::Owned(v.into_owned())).collect::<Vec<_>>()).as_deref().unwrap_or(&[]).iter() {",
    ));
  });
});

describe("a `?:` shown as text whose branches differ in type", () => {
  it("writes each branch as JavaScript writes it, in text, attributes and template literals", () => {
    const out = render("defineProps<{ on: boolean; n: number; s: string; m?: number }>();", "<p>{{ on ? n : s }}|{{ on ? (n) : s }}|{{ (on ? s : n) }}|{{ on ? m : s }}</p>");
    const n = "std::borrow::Cow::<str>::Owned(format!(\"{}\", fv::core::Js(props.n)))";
    const s = "std::borrow::Cow::<str>::Borrowed(&*props.s)";
    expect(out).toMatch(like(`fv::core::escape_into(out, &(if props.on { ${n} } else { ${s} }));\n    out.push('|');\n    fv::core::escape_into(out, &(if props.on { ${n} } else { ${s} }));`));
    expect(out).toMatch(like(`fv::core::escape_into(out, &(if props.on { ${s} } else { ${n} }));`));
    expect(out).toMatch(like(`if let Some(v) = (if props.on { props.m.map(|n1| std::borrow::Cow::<str>::Owned(format!("{}", fv::core::Js(n1)))) } else { Some(${s}) }).as_deref() {`));
    expect(render("defineProps<{ on: boolean; off: boolean; n: number; s: string }>();", "<p>{{ on ? (off ? n : s) : s }}</p>")).toMatch(like(`fv::core::escape_into(out, &(if props.on { if props.off { ${n} } else { ${s} } } else { ${s} }));`));
    expect(render("defineProps<{ on: boolean; n: number; s: string; m?: number }>();", '<p :id="on ? m : s"></p>')).toMatch(like(`if let Some(v) = (if props.on { props.m.map(|n1| std::borrow::Cow::<str>::Owned(format!("{}", fv::core::Js(n1)))) } else { Some(${s}) }).as_deref() {`));
    expect(
      render(
        "defineProps<{ on: boolean; n: number; s: string; b: boolean; l: string[]; m?: number }>();",
        "<p>{{ `${on ? n : s}|${on ? b : s}|${on ? m : s}|${on ? null : s}|${on ? undefined : s}|${on ? l : s}|${on ? 1.5 : s}` }}</p>",
      ),
    ).toMatch(like(
      `fv::core::escape_into(out, &format!("{}|{}|{}|{}|{}|{}|{}", (if props.on { ${n} } else { ${s} }), (if props.on { if props.b { "true" } else { "false" } } else { &props.s }), (if props.on { std::borrow::Cow::<str>::Owned(format!("{}", fv::strings::JsOr(props.m.map(fv::core::Js), "undefined"))) } else { ${s} }), (if props.on { None } else { Some(&*props.s) }).unwrap_or("null"), (if props.on { None } else { Some(&*props.s) }).unwrap_or("undefined"), (if props.on { std::borrow::Cow::<str>::Owned(props.l.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).collect::<Vec<_>>().join(",")) } else { ${s} }), (if props.on { std::borrow::Cow::<str>::Owned(format!("{}", fv::core::Js(1.5f64))) } else { ${s} })));`,
    ));
  });

  it("refuses a `?:` of a list and a string in text, and one that is no branch of what is shown", () => {
    expect(refusals("defineProps<{ on: boolean; l: string[]; s: string }>();", "<p>{{ on ? l : s }}</p>")).toEqual(["FV0623 the two branches of `?:` differ in type"]);
    expect(refusals("defineProps<{ on: boolean; n: number; s: string }>();", "<p>{{ [on ? n : s] }}</p>")).toEqual(["FV0623 the two branches of `?:` differ in type"]);
    expect(refusals("defineProps<{ o?: string; on: boolean }>();", "<p>{{ on ? o.length : 'none' }}</p>")).toEqual(["FV0604 `.length` of an optional string, which may be absent: narrow it with `v-if` first, or read it with `?.length`"]);
  });
});

describe("`.length`", () => {
  const length = (props: string, read: string) => render(`defineProps<{ ${props} }>();`, `<p>{{ ${read} }}</p>`);

  it("counts a record, a list, what a list method computes and a string", () => {
    expect(length("r: Record<string, number>", "Object.entries(r).length")).toMatch(like("fv::core::push_int(out, props.r.len() as i64);"));
    expect(length("r: Record<string, number>", "Object.keys(r).length")).toMatch(like("fv::core::push_int(out, props.r.keys().count() as i64);"));
    expect(length("r: Record<string, number>", "Object.keys(r).map((x) => x).length")).toMatch(like("fv::core::push_int(out, props.r.keys().map(std::borrow::Cow::<str>::Borrowed).count() as i64);"));
    expect(length("r: Record<string, number>", "Object.entries(r).map((e) => e.length).join()")).toMatch(like("props.r.iter().map(|_| 2i64)"));
    expect(length("l: string[]", "[...l].length")).toMatch(like("fv::core::push_int(out, props.l.len() as i64);"));
    expect(length("l: string[]", "l.map((x) => x + '!').length")).toMatch(like("fv::core::push_int(out, props.l.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).count() as i64);"));
    expect(length("l: string[]", "l.filter((x) => !!x).length")).toMatch(like("fv::core::push_int(out, props.l.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).filter(|fv_s1| !fv_s1.is_empty()).count() as i64);"));
    expect(length("l: string[]", "l.slice(1).length")).toMatch(like("fv::core::push_int(out, fv::strings::js_slice_items(props.l.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)), 1.0f64, None).count() as i64);"));
    expect(length("l: string[]", "l.slice(1).map((x) => x).length")).toMatch(like("fv::core::push_int(out, fv::strings::js_slice_items(props.l.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)), 1.0f64, None).count() as i64);"));
    expect(length("s: string", "s.length")).toMatch(like("fv::core::push_int(out, fv::strings::js_length(&props.s));"));
    expect(length("s: string", "[].length")).toMatch(like('out.push_str("<p>0</p>");'));
  });

  it("counts an empty array literal, and one handed to a parameter whose items have no type, as 0", () => {
    expect(render("const props = defineProps<{ xs: string[] }>();", "<p>{{ [].length + xs.length }}</p>")).toMatch(like("fv::core::push_number(out, 0.0 + props.xs.len() as i64 as f64);"));
    const out = render("function f(xs: unknown[]) { return xs.length; }", "<p>{{ f([]) }}</p>");
    expect(out).toMatch(like('out.push_str("<p>0</p>");'));
    expect(out).not.toMatch(/= &\[\];/);
    expect(render("const props = defineProps<{ b: boolean }>();", "<p>{{ b ? [].length : 1 }}</p>")).toMatch(like("fv::core::push_int(out, if props.b { 0i64 } else { 1i64 });"));
    expect(render("const props = defineProps<{ xs: string[] }>();", "<p>{{ xs[[].length] }}</p>")).toMatch(like("if let Some(v) = props.xs.first().map(|v| &**v) {"));
  });

  it("refuses the length of a number, of a list read by `[…]`, and of entries other than a record's", () => {
    expect(refusals("defineProps<{ n: number }>();", "<p>{{ n.length }}</p>")).toEqual(["FV0604 `.length` of a number, which has no field `length`"]);
    expect(refusals("defineProps<{ l: string[] }>();", "<p>{{ l['length'] }}</p>")).toEqual([
      "FV0824 `[…]` reads a list's item by an integer index, a `number` that is present, and this index is a string: `.at()` takes any number",
    ]);
    expect(refusals("defineProps<{ l: string[] }>();", "<p>{{ Object.entries(l).length }}</p>")).toEqual(["FV0814 `Object.entries()` takes a `Record<string, T>` prop, and this is a list"]);
    expect(refusals("defineProps<{ r: Record<string, number> }>();", "<p>{{ Object.entries(r, 1).length }}</p>")).toEqual(["FV0814 `Object.entries()` takes a `Record<string, T>` prop"]);
  });
});

describe("binary operators", () => {
  it("joins strings and adds numbers with `+`", () => {
    const out = render("defineProps<{ s: string; n: number; f: number }>();", "<p>{{ s + n }}|{{ n + s }}|{{ n + 1 }}|{{ n + f / 2 }}|{{ 's' + 't' }}</p>");
    expect(out).toMatch(like('fv::core::escape_into(out, &format!("{}{}", props.s, fv::core::Js(props.n)));'));
    expect(out).toMatch(like('fv::core::escape_into(out, &format!("{}{}", fv::core::Js(props.n), props.s));'));
    expect(out).toMatch(like("fv::core::push_number(out, props.n as f64 + 1.0);"));
    expect(out).toMatch(like("fv::core::push_number(out, props.n as f64 + props.f as f64 / 2.0);"));
    expect(out).toMatch(like('out.push_str("|st</p>");'));
  });

  it("orders strings", () => {
    const out = render("defineProps<{ s: string; t: string }>();", "<p>{{ s < t }}|{{ s >= t }}|{{ s > t }}|{{ s <= t }}</p>");
    for (const is of ["lt", "ge", "gt", "le"]) expect(out).toMatch(like(`out.push_str(if fv::strings::js_cmp(&props.s, &props.t).is_${is}() { "true" } else { "false" });`));
  });

  it("keeps integers integral through `+`, `-`, `*` and `%` by a nonzero integer literal", () => {
    const out = render("defineProps<{ l: string[]; a: number; b: number }>();", "<p>{{ l[a % 3] }}|{{ l[a - b] }}|{{ l[a * b] }}|{{ l[a + b] }}</p>");
    expect(out).toMatch(like("props.l.get(usize::try_from(fv_refusals.keep(fv::render::try_int(props.a as f64 % 3.0), 4, 19)).unwrap_or(usize::MAX))"));
    expect(out).toMatch(like("props.l.get(usize::try_from(fv_refusals.keep(fv::render::try_int(props.a as f64 - props.b as f64), 4, 34)).unwrap_or(usize::MAX))"));
    expect(out).toMatch(like("props.l.get(usize::try_from(fv_refusals.keep(fv::render::try_int(props.a as f64 * props.b as f64), 4, 49)).unwrap_or(usize::MAX))"));
    expect(out).toMatch(like("props.l.get(usize::try_from(fv_refusals.keep(fv::render::try_int(props.a as f64 + props.b as f64), 4, 64)).unwrap_or(usize::MAX))"));
    for (const e of ["a % 0", "a % b", "a % 2.5", "a / b", "a % -2", "a / 2", "NaN"]) {
      expect(refusals("defineProps<{ l: string[]; a: number; b: number }>();", `<p>{{ l[${e}] }}</p>`)).toEqual([
        "FV0824 `[…]` reads a list's item by an integer index, a `number` that is present, and this index is a `Float`, which may hold a fraction or be `NaN`: `.at()` takes any number",
      ]);
    }
  });

  const refused: [string, string, string][] = [
    ["s: string; b: boolean", "s + b", "FV0608 `+` joins a string to a string or a number, or adds two numbers"],
    ["n: number; b: boolean", "n + b", "FV0608 `+` joins a string to a string or a number, or adds two numbers"],
    ["s: string; o?: string", "s + o", "FV0608 `+` joins a string to a string or a number, or adds two numbers"],
    ["s: string; n: number", "s < n", "FV0609 `<` is supported between two numbers, two strings or two dates that are present: the other is a string"],
    ["o?: number; n: number", "o < n", "FV0609 `<` is supported between two numbers, two strings or two dates that are present: narrow an optional one with `v-if` first"],
    ["o?: number; n: number", "n < o", "FV0609 `<` is supported between two numbers, two strings or two dates that are present: narrow an optional one with `v-if` first"],
    ["s: string; n: number", "s - n", "FV0609 `-` is supported between two numbers that are present: the other is a string"],
    ["s: string; n: number", "n - s", "FV0609 `-` is supported between two numbers that are present: the other is a string"],
    ["o?: number; n: number", "n - o", "FV0609 `-` is supported between two numbers that are present: narrow an optional one with `v-if` first"],
    ["b: boolean; n: number", "b < n", "FV0609 `<` is supported between two numbers, two strings or two dates that are present: the other is a boolean"],
    ["r: Record<string, string>", "'a' in r", "FV0631 `in` tests whether an object has a key, which the server does not translate: for a record, write `Object.keys(r).includes(key)`"],
    ["r: Record<string, string>", "r instanceof Object", "FV0631 `instanceof` tests an object's prototype, which the server's typed values do not carry: each value's type is known when compiling"],
    ["n: number", "n | 0", "FV0632 `|` works on the 32-bit integers JavaScript converts its operands to, which the server does not translate: compute it in Rust and pass it as a prop"],
  ];

  for (const [props, read, message] of refused) {
    it(`refuses \`${read}\` where \`${props}\``, () => {
      expect(refusals(`defineProps<{ ${props} }>();`, `<p>{{ ${read} }}</p>`)).toEqual([message]);
    });
  }
});

describe("array literals", () => {
  const loop = (props: string, list: string) => render(`defineProps<{ ${props} }>();`, `<i v-for="x in ${list}">{{ x }}</i>`);

  it("writes a list of one type", () => {
    expect(loop("s: string", "[s, 'a']")).toMatch(like('for x_ref in [&*props.s, "a"].iter() {'));
    expect(loop("b: boolean", "[b, true]")).toMatch(like("for x_ref in [props.b, true].iter() {"));
    expect(loop("n: number", "[n, 2]")).toMatch(like("for x_ref in [props.n, 2i64].iter() {"));
    expect(loop("n: number", "[n / 2, 1.5]")).toMatch(like("for x_ref in [props.n as f64 / 2.0, 1.5f64].iter() {"));
    expect(loop("n: number", "[n, 1.5]")).toMatch(like("for x_ref in [props.n as f64, 1.5f64].iter() {"));
    expect(loop("s: string[]", "s.map(() => -1).flatMap((b) => [b, 10 * 0, 0.5])")).toMatch(like("[fv_b as f64, 0.0f64, 0.5f64]"));
    expect(loop("s: string[]", "s.map(() => -1)")).toMatch(like(".map(|_| -1i64)"));
    expect(loop("l: string[]", "[...l, 'a']")).toMatch(like('for x_cow in props.l.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).chain([std::borrow::Cow::<str>::Borrowed("a")]) {'));
  });

  const one = "FV0611 an array literal holds strings, numbers or booleans, all of one type";
  const refused: [string, string, string][] = [
    ["s: string; n: number", "[s, n]", one],
    ["s: string; b: boolean", "[b, s]", one],
    ["s?: string", "[s]", one],
    ["l: string[]", "[l]", one],
    ["s: string", "[s, , s]", "FV0610 an array literal holds plain values, without holes"],
  ];

  for (const [props, list, message] of refused) {
    it(`refuses \`${list}\` where \`${props}\``, () => {
      expect(refusals(`defineProps<{ ${props} }>();`, `<i v-for="x in ${list}">{{ x }}</i>`)).toEqual([message]);
    });
  }
});

describe("names and members", () => {
  it("reads the constants of `Math` and `Number`, `NaN` and `Infinity`", () => {
    expect(render("", "<p>{{ NaN }}|{{ Infinity }}|{{ -Infinity }}|{{ Number.NaN }}|{{ Math.PI }}|{{ Number.MAX_SAFE_INTEGER }}|{{ Number.EPSILON }}</p>")).toMatch(like(
      'out.push_str("<p>NaN|Infinity|-Infinity|NaN|3.141592653589793|9007199254740991|2.220446049250313e-16</p>");',
    ));
    expect(render("defineProps<{ n: number }>();", "<p>{{ Math.abs(n) }}|{{ Number.isInteger(n) }}</p>")).toMatch(like("fv::core::push_number(out, (props.n as f64).abs());"));
  });

  it("reads a ref's `.value` and the props object", () => {
    expect(render("import { ref, computed } from 'vue';\nconst r = ref(1);\nconst c = computed(() => r.value + 1);", "<p>{{ c }}</p>")).toMatch(like("let s_c = s_r as f64 + 1.0;"));
    expect(render("import { ref, computed } from 'vue';\nconst r = ref('ab');\nconst c = computed(() => r.length);", "<p>{{ c }}</p>")).toMatch(like('let s_c = fv::strings::js_length("ab");'));
    expect(render("import { computed } from 'vue';\nconst props = defineProps<{ n: number }>();\nconst c = computed(() => props.n);", "<p>{{ c }}|{{ props.n }}</p>")).toMatch(like("let s_c = props.n;"));
  });

  const refused: [string, string, string][] = [
    ["", "Intl", "FV1805 `Intl` formats by locale with `Intl`, whose output differs between Node, Chromium, Firefox and Safari: format the value in Rust and pass a string, or translate it with `$t` (see the `dates_and_prices` guide)"],
    ["", "Math", "FV0633 `Math` is not supported: of `Math`, the server translates `Math.max`, `min`, `abs`, `round`, `floor`, `ceil`, `trunc`, `sqrt`, `sign` and `pow`, and its constants"],
    ["", "Math.TAU", "FV0633 `Math.TAU` is not supported: of `Math`, the server translates `Math.max`, `min`, `abs`, `round`, `floor`, `ceil`, `trunc`, `sqrt`, `sign` and `pow`, and its constants"],
    ["", "Number.PI", "FV0633 `Number.PI` is not supported: of `Number`, the server translates `Number(x)`, `Number.isNaN`, `isFinite`, `isInteger` and `isSafeInteger`, and its constants"],
    ["", "$attrs.x", "FV0415 `$attrs` is bound whole, with `v-bind=\"$attrs\"`; a value read from it has no type: declare it as a prop"],
  ];

  for (const [script, read, message] of refused) {
    it(`refuses \`${read}\``, () => {
      expect(refusals(script, `<p>{{ ${read} }}</p>`)).toEqual([message]);
    });
  }

  it("reads a name a `v-for` binds over a built-in", () => {
    expect(refusals("", '<p v-for="Math in [1]">{{ Math.PI }}</p>')).toEqual(["FV0604 `.PI` of a number, which has no field `PI`"]);
  });

  it("refuses `[\"value\"]` of a ref", () => {
    expect(refusals("import { ref, computed } from 'vue';\nconst r = ref(1);\nconst c = computed(() => r['value'] + 1);", "<p>{{ c }}</p>")).toEqual([
      "FV0612 computed member access of a number: `[…]` reads an item of a list, by an integer index (the template reads it as `c` at components/X.vue:6:17)",
    ]);
  });
});

describe("`&&` and `||` that narrow their left side", () => {
  it("reads the right side where the left side narrows it", () => {
    expect(render("defineProps<{ s?: string }>();", '<p v-if="!s || s.length > 2">a</p>')).toMatch(like(
      "if if let Some(n2) = props.s.as_deref().filter(|v| !v.is_empty()) { fv::strings::js_length(n2) as f64 > 2.0 } else { true } {",
    ));
    expect(render("defineProps<{ s?: string }>();", '<p v-if="s != null && s.length > 2">a</p>')).toMatch(like("if let Some(n1) = props.s.as_deref() && fv::strings::js_length(n1) as f64 > 2.0 {"));
  });

  it("refuses a right side that is no boolean", () => {
    const help = "write a comparison for a boolean, or `?:` with the value each side gives";
    expect(refusals("defineProps<{ s?: string }>();", "<p>{{ !s || s.length }}</p>")).toEqual([`FV0614 \`||\` is supported between booleans only, and its right side is a number | ${help}`]);
    expect(refusals("defineProps<{ s?: string }>();", "<p>{{ s != null && s.length }}</p>")).toEqual([`FV0614 \`&&\` is supported between booleans only, and its right side is a number | ${help}`]);
  });

  it("refuses a side that may be absent, saying how to test it", () => {
    const help = "test it with `!= null` for a boolean, or write `?:` with the value each side gives";
    expect(refusals("defineProps<{ b: boolean; n?: number }>();", "<p>{{ b && n }}</p>")).toEqual([`FV0614 \`&&\` is supported between booleans only, and its right side is an optional number | ${help}`]);
    expect(refusals("defineProps<{ b: boolean }>();", "<p>{{ undefined && b }}</p>")).toEqual([`FV0614 \`&&\` is supported between booleans only, and its left side is \`undefined\` | ${help}`]);
  });
});

describe("expressions checked a second time", () => {
  const card = "interface Card { label: string }\n";

  it("names a value that may be `null` or `undefined`, and a value of a kind it has no name for", () => {
    expect(refusals('defineProps<{ k: "a" | "b" | "c" }>();\nconst T = { a: null, b: "B" };', "<p>{{ T[k].x }}</p>")).toEqual([
      "FV0604 `.x` of a string, `null` or `undefined`, which may be absent: narrow it with `v-if` first, or read it with `?.x`",
    ]);
    expect(refusals('import type { InlineHtml } from "ferrovue/types";\ndefineProps<{ h?: InlineHtml }>();', "<p>{{ h && 'x' }}</p>")).toEqual([
      "FV0614 `&&` gives its left side where that is falsy, and this one, an optional value of another kind, may be falsy where it is present (`\"\"`, `0`, `false`), which the value on the right cannot stand for | test it with `!= null` for a boolean, or write `?:` with the value each side gives",
    ]);
    expect(refusals('import type { InlineHtml } from "ferrovue/types";\ndefineProps<{ h: InlineHtml }>();', "<p>{{ h && 'x' }}</p>")).toEqual([
      "FV0614 `&&` is supported between booleans only, and its left side is a value of another kind | write a comparison for a boolean, or `?:` with the value each side gives",
    ]);
  });

  it("chooses between a list prop's default and another list as slices", () => {
    expect(render("withDefaults(defineProps<{ l?: string[]; on: boolean; m: string[] }>(), { l: () => [] });", '<i v-for="x in on ? l : m">{{ x }}</i>')).toMatch(like(
      "for x_ref in (if props.on { props.l.as_deref().unwrap_or(&[]) } else { &props.m[..] }).iter() {",
    ));
  });

  it("refuses an integer where a function takes an optional string", () => {
    expect(refusals("import { h } from './helpers';\ndefineProps<{ n: number }>();", "<p>{{ h(n) }}</p>", { config: helper(["string?"]) })).toEqual(['FV0607 a {"k":"int"} where {"k":"opt","of":{"k":"str"}} is expected']);
  });

  it("types the object literals a function's return type states through `let` assigned again and loops", () => {
    expect(render(`${card}defineProps<{ on: boolean }>();\nfunction f(): Card { let c = "a"; c = "b"; return { label: c }; }`, "<p>{{ f().label }}</p>")).toMatch(like(
      'fv::core::escape_into(out, &((Card { label: std::borrow::Cow::<str>::Borrowed("b") }).label));',
    ));
    expect(render(`${card}const props = defineProps<{ xs: string[] }>();\nfunction f(): Card { let c = ""; for (const x of props.xs) { c = c + x; } return { label: c }; }`, "<p>{{ f().label }}</p>")).toMatch(
      /fv::core::escape_into\(out, &\(\(\{ let mut \w+: String = String::new\(\); for \w+ in props\.xs\.iter\(\)[^]*Card \{ label: std::borrow::Cow::<str>::Owned\(str::to_owned\(&\*\w+\)\) \} \}\)\.label\)\);/,
    );
  });

  it("types a `?:` of an object literal and a struct in a list, and refuses `&&` of an object literal", () => {
    const list = (items: string) => render(`import { computed } from "vue";\n${card}const props = defineProps<{ on: boolean; c: Card }>();\nconst c = computed((): Card[] => [${items}]);`, '<p v-for="x in c">{{ x.label }}</p>');
    expect(list('props.on ? { label: "a" } : props.c')).toMatch(like('let s_c = Vec::from([if props.on { Card { label: std::borrow::Cow::<str>::Borrowed("a") } } else { props.c.clone() }]);'));
    expect(list('props.on ? props.c : { label: "a" }')).toMatch(like('let s_c = Vec::from([if props.on { props.c.clone() } else { Card { label: std::borrow::Cow::<str>::Borrowed("a") } }]);'));
    expect(refusals(`import { computed } from "vue";\n${card}const props = defineProps<{ on: boolean }>();\nconst c = computed((): Card | false => props.on && { label: "a" });`, "<p>{{ c }}</p>")).toEqual([
      "FV0634 an object literal in a `computed` whose type is not known, which the server builds as the Rust struct of an interface: annotate the `computed`, as `computed<Card>(() => …)` or `computed((): Card => …)` (the template reads it as `c` at components/X.vue:7:17)",
    ]);
  });

  it("reads a type stated in a `.ts` file where the file declares it", () => {
    expect(render('import { one } from "./lib";', "<p>{{ one().label }}</p>", { files: { "lib.ts": 'export interface Card { label: string }\nexport function one(): Card { return { label: "a" } as Card; }\n' } })).toMatch(like(
      'fv::core::escape_into(out, &((super::types::Card { label: std::borrow::Cow::<str>::Borrowed("a") }).label));',
    ));
  });

  it("refuses a return type nothing declares, and values a stated type does not hold", () => {
    const nope = (at: string) => `FV0315 unsupported prop type \`Nope\`: declare it as an interface in the component, or import it from a \`.ts\` file (the template reads it as \`c\` at components/X.vue:${at})`;
    expect(refusals('import { computed } from "vue";\nconst c = computed((): Nope => ({ a: 1 }));', "<p>{{ c }}</p>")).toEqual([nope("5:17")]);
    expect(refusals('import { computed } from "vue";\nconst c = computed((): Nope[] => [{ a: 1 }]);', '<p v-for="x in c">{{ x }}</p>')).toEqual([nope("5:26")]);
    const unknown = (at: string) =>
      `FV0634 an object literal in a \`computed\` whose type is not known, which the server builds as the Rust struct of an interface: annotate the \`computed\`, as \`computed<Card>(() => …)\` or \`computed((): Card => …)\` (the template reads it as \`c\` at components/X.vue:${at})`;
    expect(refusals('import { computed } from "vue";\nconst c = computed((): string => ({ a: 1 }));', "<p>{{ c }}</p>")).toEqual([unknown("5:17")]);
    expect(refusals(`import { computed } from "vue";\n${card}const c = computed(() => [{ label: "x" }] as Card);`, "<p>{{ c }}</p>")).toEqual([unknown("6:17")]);
    expect(refusals('import { computed } from "vue";\nconst c = computed((): string => []);', "<p>{{ c }}</p>")).toEqual(["FV0401 `{{ }}` of a list: only strings, numbers and booleans can be interpolated"]);
    const states = (what: string) => `FV0628 \`as\` states ${what}, which the server keeps as it is: write the value with the type it has (the template reads it as \`c\` at components/X.vue:6:17)`;
    expect(refusals('import { computed } from "vue";\nconst props = defineProps<{ s: string; n: number }>();\nconst c = computed(() => props.s as number);', "<p>{{ c }}</p>")).toEqual([states("a number of a string")]);
    expect(refusals('import { computed } from "vue";\nconst props = defineProps<{ s: string; n: number }>();\nconst c = computed(() => props.n as string | undefined);', "<p>{{ c }}</p>")).toEqual([states("an optional string of a number")]);
  });

  it("gives `&&` after a nullable value `null` where the value is absent", () => {
    expect(refusals("interface C { a: string }\ndefineProps<{ c: C | null }>();", "<p>{{ (c && c.a) === undefined }}</p>")).toEqual(["FV0627 `=== undefined` of a value that is `T | null`, never `undefined`: compare with `null`"]);
  });

  it("refuses a `?:` shown as text whose branch reads a value its test narrows", () => {
    expect(refusals("defineProps<{ o?: string }>();", "<p>{{ o ? o.length : 'none' }}</p>")).toEqual(["FV0623 the two branches of `?:` differ in type"]);
  });

  it("refuses the bitwise operators and arithmetic of strings", () => {
    for (const op of ["^", "<<", ">>"]) {
      expect(refusals("defineProps<{ n: number }>();", `<p>{{ n ${op} 1 }}</p>`)).toEqual([
        `FV0632 \`${op}\` works on the 32-bit integers JavaScript converts its operands to, which the server does not translate: compute it in Rust and pass it as a prop`,
      ]);
    }
    expect(refusals("defineProps<{ s: string; t: string }>();", "<p>{{ s - t }}</p>")).toEqual(["FV0609 `-` is supported between two numbers that are present: the other is a string"]);
    expect(refusals("defineProps<{ s: string; n: number }>();", "<p>{{ n < s }}</p>")).toEqual(["FV0609 `<` is supported between two numbers, two strings or two dates that are present: the other is a string"]);
  });

  it("reads constants of `Math` and `Number` alone", () => {
    expect(refusals("", "<p>{{ JSON.NaN }}</p>")).toEqual(["FV0633 `JSON.NaN` is not supported: of `JSON`, the server translates `JSON.stringify(x)`"]);
  });
});

describe("values built from object literals in place", () => {
  const rich =
    'import type { Float } from "ferrovue/types";\ninterface Sub { a: number }\ninterface Rich { s: string; i: number; f: Float; b: boolean; sub: Sub; l: string[]; os?: string; oi?: number; ob?: boolean; ofl?: Float; osub?: Sub; ol?: string[] }\nconst props = defineProps<{ on: boolean; t: string }>();\nfunction rich(): Rich { return { s: props.t, i: 1, f: 1.5, b: true, sub: { a: 2 }, l: ["x"], os: "o", oi: 3, ob: false, ofl: 2.5, osub: { a: 4 }, ol: ["y"] }; }\n';

  it("reads each kind of field of one", () => {
    const read = (field: string) => render(rich, `<p>{{ rich().${field} }}</p>`);
    expect(read("s")).toMatch(/fv::core::escape_into\(out, &\(\(Rich \{ .* \}\)\.s\)\);/);
    expect(read("i")).toMatch(/fv::core::push_int\(out, \(Rich \{ .* \}\)\.i\);/);
    expect(read("f")).toMatch(/fv::core::push_number\(out, \(Rich \{ .* \}\)\.f\);/);
    expect(read("b")).toMatch(/out\.push_str\(if \(Rich \{ .* \}\)\.b \{ "true" \} else \{ "false" \}\);/);
    expect(read("sub.a")).toMatch(/fv::core::push_int\(out, \(\(Rich \{ .* \}\)\.sub\)\.a\);/);
    expect(read("l.length")).toMatch(/fv::core::push_int\(out, \(\(Rich \{ .* \}\)\.l\)\.len\(\) as i64\);/);
    expect(read("os")).toMatch(/if let Some\(v\) = \(\(Rich \{ .* \}\)\.os\)\.as_deref\(\) \{/);
    expect(read("oi")).toMatch(/if let Some\(v\) = \(\(Rich \{ .* \}\)\.oi\) \{/);
    expect(read("ob")).toMatch(/if let Some\(v\) = \(\(Rich \{ .* \}\)\.ob\) \{/);
    expect(read("ofl")).toMatch(/if let Some\(v\) = \(\(Rich \{ .* \}\)\.ofl\) \{/);
  });

  it("builds a list of a union's members as a list of its enum, and reads it", () => {
    const script = 'type Tone = "calm" | "loud";\ninterface Mix { tones: Tone[] }\nconst props = defineProps<{ t: Tone }>();\nfunction mix(): Mix { return { tones: [props.t, "loud"] }; }';
    expect(render(script, '<p>{{ mix().tones.join(",") }}</p>')).toMatch(like(
      'fv::core::escape_into(out, &((Mix { tones: vec![props.t, Tone::Loud] }).tones).iter().map(|v| std::borrow::Cow::<str>::Borrowed(fv::props::Union::as_str(*v))).collect::<Vec<_>>().join(","));',
    ));
  });

  it("refuses an optional object or list field of one, and a field it lacks", () => {
    const held = (what: string) => `FV0636 \`.${what}, of a value built from object literals in place, which the server holds only while the expression that builds it runs: give it a \`computed\` of its own and read that`;
    expect(refusals(rich, "<p>{{ rich().osub?.a }}</p>")).toEqual([held("osub`, an optional object")]);
    expect(refusals(rich, "<p>{{ rich().ol?.length }}</p>")).toEqual([held("ol`, an optional list")]);
    expect(refusals(rich, "<p>{{ rich().zz }}</p>")).toEqual(["FV0605 `Rich` has no field `zz`"]);
  });

  const card = 'interface Card { label: string }\nconst props = defineProps<{ on: boolean; cs: Card[]; c: Card; oc?: Card }>();\nfunction cards(): Card[] { return [{ label: "a" }]; }\nfunction one(): Card { return { label: "b" }; }\nfunction maybe(): Card | undefined { return props.on ? { label: "c" } : undefined; }\n';
  const built = (label: string) => `Card { label: std::borrow::Cow::<str>::Borrowed("${label}") }`;

  it("chooses between one and another value of its type, which it copies", () => {
    const loop = (list: string) => render(card, `<p v-for="x in ${list}">{{ x.label }}</p>`);
    expect(loop("on ? cards() : cs")).toMatch(like(`for x_ref in (if props.on { Vec::from([${built("a")}]) } else { props.cs.iter().cloned().collect::<Vec<_>>() }).iter() {`));
    expect(loop("on ? cards() : []")).toMatch(like(`for x_ref in (if props.on { Vec::from([${built("a")}]) } else { Vec::new() }).iter() {`));
    expect(loop("on ? [] : cards()")).toMatch(like(`for x_ref in (if props.on { Vec::new() } else { Vec::from([${built("a")}]) }).iter() {`));
    expect(render(card, "<p>{{ (on ? one() : c).label }}</p>")).toMatch(like(`fv::core::escape_into(out, &((if props.on { ${built("b")} } else { props.c.clone() }).label));`));
    const out = render(card, "<p>{{ (maybe() ?? c).label }}|{{ (oc ?? one()).label }}</p>");
    expect(out).toMatch(like(`fv::core::escape_into(out, &((if props.on { Some(${built("c")}) } else { None }).unwrap_or(props.c.clone()).label));`));
    expect(out).toMatch(like(`fv::core::escape_into(out, &(props.oc.as_ref().cloned().unwrap_or(${built("b")}).label));`));
  });

  it("refuses `?.` of one, a list of them or `undefined`, and one or a string", () => {
    const chained = "FV0636 `?.` of a value built from object literals in place, which the server holds only while the expression that builds it runs: give it a `computed` of its own and read that";
    expect(refusals(card, "<p>{{ (on ? one() : oc)?.label }}</p>")).toEqual([chained]);
    expect(refusals(card, "<p>{{ (on ? one() : undefined)?.label }}</p>")).toEqual([chained]);
    expect(refusals(card, "<p>{{ (on ? maybe() : c)?.label }}</p>")).toEqual([chained]);
    expect(refusals(card, '<p v-for="x in (on ? cards() : undefined) ?? []">{{ x.label }}</p>')).toEqual([
      "FV0636 `?:` between a list built from object literals and `undefined` or `null`, which the server does not hold as an optional list: type the value as the list, `Row[]`, with `[]` for none",
    ]);
    expect(refusals(card, "<p>{{ on ? one() : 's' }}</p>")).toEqual(["FV0623 the two branches of `?:` differ in type"]);
  });
});

describe("`===` of a constant that is `null`", () => {
  it("tests a nullable value against it", () => {
    const out = render('import { NONE } from "./c";\ndefineProps<{ n: string | null }>();', "<p>{{ n === NONE }}|{{ n !== NONE }}|{{ NONE === n }}</p>", { files: { "c.ts": "export const NONE = null;" } });
    expect(out).toMatch(like('out.push_str(if props.n.as_deref().is_none() { "true" } else { "false" });\n    out.push(\'|\');\n    out.push_str(if props.n.as_deref().is_some() { "true" } else { "false" });\n    out.push(\'|\');\n    out.push_str(if props.n.as_deref().is_none() { "true" } else { "false" });'));
    expect(refusals('import { NONE } from "./c";\ndefineProps<{ s?: string }>();', "<p>{{ s === NONE }}</p>", { files: { "c.ts": "export const NONE = null;" } })).toEqual([
      "FV0627 `=== null` of a value that is optional, which is `undefined` when absent, never `null`: compare with `undefined`",
    ]);
  });
});

describe("`||`, `??` and `?:` of strings, numbers and booleans", () => {
  const P = "const props = defineProps<{ s?: string; t: string; n?: number; m: number; b?: boolean; c: boolean; e?: \"a\" | \"b\"; on: boolean; ns?: number[] }>();\n";
  const cases: [string, string][] = [
    ["b || c", "out.push_str(if props.b.unwrap_or(false) || props.c { \"true\" } else { \"false\" });"],
    ["t || 'x'", "fv::core::escape_into(out, { let a = &*props.t; if !a.is_empty() { a } else { \"x\" } });"],
    ["m || 1", "fv::core::push_int(out, { let a = props.m; if a != 0 { a } else { 1i64 } });"],
    ["t || undefined", "if let Some(v) = Some(&*props.t).filter(|v| !v.is_empty()) {"],
    ["s || t", "fv::core::escape_into(out, props.s.as_deref().filter(|v| !v.is_empty()).unwrap_or(&props.t));"],
    ["s || 'x'", "fv::core::escape_into(out, props.s.as_deref().filter(|v| !v.is_empty()).unwrap_or(\"x\"));"],
    ["n || m", "fv::core::push_int(out, props.n.filter(|v| *v != 0).unwrap_or(props.m));"],
    ["n || 0", "fv::core::push_int(out, props.n.filter(|v| *v != 0).unwrap_or(0i64));"],
    ["e || 'b'", "fv::core::escape_into(out, if let Some(n1) = props.e { fv::props::Union::as_str(n1) } else { \"b\" });"],
    ["(b || c) === true", "out.push_str(if props.b.unwrap_or(false) || props.c { \"true\" } else { \"false\" });"],
    ["(ns ?? [1]).length", "fv::core::push_int(out, (if let Some(n1) = props.ns.as_ref() { n1.to_vec() } else { [1i64].to_vec() }).len() as i64);"],
    ["e ?? 'z'", "fv::core::escape_into(out, props.e.map(fv::props::Union::as_str).unwrap_or(\"z\"));"],
    ["s ?? t", "fv::core::escape_into(out, props.s.as_deref().unwrap_or(&*props.t));"],
    ["s ?? 'x'", "fv::core::escape_into(out, props.s.as_deref().unwrap_or(\"x\"));"],
    ["s ?? (on ? 'a' : 'b')", "fv::core::escape_into(out, props.s.as_deref().unwrap_or(if props.on { \"a\" } else { \"b\" }));"],
    ["(t + 'a') || 'b'", "fv::core::escape_into(out, &{ let a = std::borrow::Cow::<str>::Owned(format!(\"{}a\", props.t)); if !a.is_empty() { a } else { std::borrow::Cow::<str>::Borrowed(\"b\") } });"],
    ["on ? t : s", "if let Some(v) = if props.on { Some(&*props.t) } else { props.s.as_deref() } {"],
    ["on ? s : t", "if let Some(v) = if props.on { props.s.as_deref() } else { Some(&*props.t) } {"],
    ["on ? s : undefined", "if let Some(v) = if props.on { props.s.as_deref() } else { None } {"],
    ["on ? undefined : s", "if let Some(v) = if props.on { None } else { props.s.as_deref() } {"],
  ];

  for (const [read, code] of cases.filter(([, c]) => !/^FV\d{4} /.test(c))) {
    it(`writes \`${read}\``, () => {
      expect(render(P, `<p>{{ ${read} }}</p>`)).toMatch(like(`    ${code}`));
    });
  }

  for (const [read, message] of cases.filter(([, c]) => /^FV\d{4} /.test(c))) {
    it(`refuses \`${read}\``, () => {
      expect(refusals(P, `<p>{{ ${read} }}</p>`)).toEqual([message]);
    });
  }
});

describe("names that setup and bodies bind", () => {
  it("names a function a body declares by the name it is written with where it is read as a value", () => {
    expect(refusals("function f() { const g = () => 1; const h = g; return 2; }", "<p>{{ f() }}</p>")).toEqual([
      "FV0613 `g` is set up in a way the server cannot evaluate: it is a function declared in a body, which that body may call, and not use as a value (in `f()`, called at components/X.vue:4:17) | call it, as `g(…)`, which the server translates, or name it only in an event handler",
    ]);
  });

  it("refuses a name nothing declares that a function reads", () => {
    expect(refusals("function f() { return nope; }", "<p>{{ f() }}</p>")).toEqual(["FV0601 `nope` is not available when rendering on the server (in `f()`, called at components/X.vue:4:17)"]);
  });

  it("refuses a binding setup could not compute for a type imported from a component that is not compiled, where the template reads it", () => {
    const script = 'import type { Item } from "./Nope.vue";\nimport { computed } from "vue";\nconst props = defineProps<{ s: string }>();\nconst c = computed(() => ({ a: props.s } as Item).a);';
    expect(refusals(script, "<p>{{ c }}</p>")).toEqual([
      "FV0512 `Item` is imported from Nope.vue, which is not among the components compiled (the template reads it as `c` at components/X.vue:7:17) | move Nope.vue into the components directory, or declare `Item` in a `.ts` file and import it from there",
    ]);
  });

  it("reads a `computed` named `$attrs` that setup declares", () => {
    expect(render('import { computed } from "vue";\nconst $attrs = computed(() => "x");', "<p>{{ $attrs }}</p>")).toMatch(like('out.push_str("<p>x</p>");'));
  });

  it("reads a field of a `computed` named `$slots` as a field", () => {
    expect(refusals('import { computed } from "vue";\nconst $slots = computed(() => "x");', "<p>{{ $slots.a }}</p>")).toEqual(["FV0604 `.a` of a string, which has no field `a`"]);
  });

  it("reads a field named like a `useSlots()` binding of a `v-for` item as a field", () => {
    const script = 'import { useSlots } from "vue";\ninterface S { default: string }\ninterface I { slots: S }\ndefineProps<{ l: I[] }>();\nconst slots = useSlots();';
    expect(render(script, '<p v-for="y in l">{{ y.slots.default }}</p><slot />')).toMatch(like("fv::core::escape_into(out, &fv_y.slots.default);"));
  });

  it("refuses a `useSlots()` binding read whole where a prop has its name", () => {
    expect(refusals('import { useSlots } from "vue";\ndefineProps<{ slots: string }>();\nconst slots = useSlots();', "<p>{{ slots }}</p>")).toEqual(["FV0601 `slots` is not available when rendering on the server"]);
  });

  it("reads the CSS module setup binds to `$style` where the template names `$style`", () => {
    const x = '<script setup lang="ts">\nimport { useCssModule } from "vue";\nconst $style = useCssModule("other");\n</script>\n<template><p :class="$style.b">x</p></template>\n<style module>\n.a { color: red; }\n</style>\n<style module="other">\n.b { color: blue; }\n</style>\n';
    expect(render("", "", { files: { "X.vue": x }, config: { cssModules: { generateScopedName: "[local]_x" } } })).toMatch(like('fv::attrs::class_into(out, false, &["b_x"]);'));
  });

  it("refuses `[…]` of a CSS module by a name", () => {
    const x = '<script setup lang="ts">\ndefineProps<{ k: string }>();\n</script>\n<template><p :class="$style[k]">x</p></template>\n<style module>\n.a { color: red; }\n</style>\n';
    expect(refusals("", "", { files: { "X.vue": x }, config: { cssModules: { generateScopedName: "[local]_x" } } })).toEqual([
      "FV0612 computed member access of the CSS module `$style`: `[…]` reads an item of a list, by an integer index",
    ]);
  });

  it("refuses `[…]` of the route by a key that is no string literal", () => {
    expect(refusals("defineProps<{ k: string }>();", "<p>{{ $route[k] }}</p>", { files: { "routes.json": '["/"]' }, config: { routes: "components/routes.json" } })).toEqual([
      "FV0612 computed member access of the route: `[…]` reads an item of a list, by an integer index",
    ]);
  });
});

describe("types written in other files", () => {
  const nope = 'import type { Props as YP } from "./Nope.vue";\ndefineProps<{ y: YP }>();';
  const y = { files: { "Y.vue": sfc("defineProps<{ a: string }>();", "<p>{{ a }}</p>") } };

  it("refuses `Props` imported from a component that is not compiled", () => {
    expect(refusals(nope, "<p>{{ y.a }}</p>")).toContain(
      "FV0512 `Props` is imported from Nope.vue, which is not among the components compiled | move Nope.vue into the components directory, or declare `Props` in a `.ts` file and import it from there",
    );
  });

  it("describes a child's `Props` as an object", () => {
    expect(refusals('import type { Props as YP } from "./Y.vue";\ndefineProps<{ y: YP }>();', "<p>{{ y < 1 }}</p>", y)).toEqual([
      "FV0609 `<` is supported between two numbers, two strings or two dates that are present: the other is an object",
    ]);
  });

  it("refuses a field of a type a component imports from a child that does not declare it", () => {
    expect(refusals('import type { Item } from "./Y.vue";\ndefineProps<{ y: Item }>();', "<p>{{ y.a }}</p>", y)).toEqual(["FV0605 `Item` has no field `a`"]);
  });

  it("builds an object literal, and the items of a `.map()`, as the interface of the `.ts` file whose function takes them", () => {
    const lib = { files: { "lib.ts": "export interface Item { a: string }\nexport function f(p: Item) { return p.a; }\nexport function g(ps: Item[]) { return ps.length; }\n" } };
    expect(render('import { f } from "./lib";', '<p>{{ f({ a: "x" }) }}</p>', lib)).toMatch(like('let fv_p = super::types::Item { a: std::borrow::Cow::<str>::Borrowed("x") };'));
    expect(render('import { g } from "./lib";\nconst xs = ["x", "y"];', "<p>{{ g(xs.map((x) => ({ a: x }))) }}</p>", lib)).toMatch(like(".map(|fv_x| super::types::Item { a: std::borrow::Cow::<str>::Owned(str::to_owned(&*fv_x)) })"));
  });
});

describe("array literals handed to a typed parameter", () => {
  const f = (param: string) => `defineProps<{ on: boolean }>();\nfunction f(xs: ${param}) { return xs.length; }`;

  it("keeps a list of strings, plain and chosen by `?:`, where the parameter takes strings or `null`", () => {
    expect(render(f("(string | null)[]"), '<p>{{ f(["a"]) }}</p>')).toMatch(like('fv::core::push_int(out, { let fv_xs = &["a"]; fv_xs.len() as i64 });'));
    expect(render(f("(string | null)[]"), '<p>{{ f([on ? "a" : "b"]) }}</p>')).toMatch(like('fv::core::push_int(out, { let fv_xs = &[if props.on { "a" } else { "b" }]; fv_xs.len() as i64 });'));
  });

  it("refuses a hole in an array literal handed to a typed parameter", () => {
    expect(refusals(f("string[]"), '<p>{{ f(["a", , "b"]) }}</p>')).toEqual(["FV0610 an array literal holds plain values, without holes"]);
  });

  it("hands `[]` to a parameter whose type it does not read", () => {
    expect(render("function f(xs: Nope[]) { return 3; }", "<p>{{ f([]) }}</p>")).toMatch(like('out.push_str("<p>3</p>");'));
  });
});

describe("values that may be absent, read and shown", () => {
  it("refuses `&&` after a value that may be `null` or `undefined`", () => {
    expect(refusals('defineProps<{ k: "a" | "b" | "c" }>();\nconst T = { a: "A", b: null };', '<p>{{ T[k] && "x" }}</p>')).toEqual([
      'FV0614 `&&` gives its left side where that is falsy, and this one, a string, `null` or `undefined`, may be falsy where it is present (`""`, `0`, `false`), which the value on the right cannot stand for | test it with `!= null` for a boolean, or write `?:` with the value each side gives',
    ]);
  });

  it("reads a number from an item an optional chain picks from a computed list", () => {
    expect(render("defineProps<{ s: string }>();", '<p>{{ s.split(",")[1]?.codePointAt(0) }}</p>')).toMatch(like(".as_deref().and_then(|fv_value| fv::strings::js_code_point_at(fv_value, 0.0f64)) {"));
  });

  it("borrows a record an optional chain reads", () => {
    expect(render("interface C { r: Record<string, string> }\ndefineProps<{ c?: C }>();", '<p v-if="c?.r">a</p>')).toMatch(like("if props.c.as_ref().map(|fv_c| &fv_c.r).is_some() {"));
  });

  it("writes `null` and `undefined` in a template literal's `?:` whose branches differ in type", () => {
    const out = render("defineProps<{ on: boolean; off: boolean; n: number; s: string }>();", "<p>{{ `${on ? (off ? null : n) : s}|${on ? (off ? undefined : n) : s}` }}</p>");
    const n = 'std::borrow::Cow::<str>::Owned(format!("{}", fv::core::Js(props.n)))';
    expect(out).toMatch(like(
      `fv::core::escape_into(out, &format!("{}|{}", (if props.on { if props.off { std::borrow::Cow::<str>::Borrowed("null") } else { ${n} } } else { std::borrow::Cow::<str>::Borrowed(&*props.s) }), (if props.on { if props.off { std::borrow::Cow::<str>::Borrowed("undefined") } else { ${n} } } else { std::borrow::Cow::<str>::Borrowed(&*props.s) })));`,
    ));
  });

  it("places the refusal of a list in a template literal's `?:` at the list", () => {
    const made = project({ "X.vue": sfc("defineProps<{ on: boolean; ds: Date[]; s: string }>();", "<p>{{ `${on ? ds : s}` }}</p>") });
    expect(() => generate(made, { components: "components", out: "out" })).toThrow(expect.objectContaining({ code: "FV0708", at: { file: "components/X.vue", line: 4, column: 25 } }));
  });
});

describe("indexes and strings that may hold half a character", () => {
  const l = "const props = defineProps<{ l: string[]; n: number; s: string }>();\n";
  const float = "FV0824 `[…]` reads a list's item by an integer index, a `number` that is present, and this index is a `Float`, which may hold a fraction or be `NaN`: `.at()` takes any number";

  it("refuses an index a function call makes a `Float`", () => {
    expect(refusals(l, "<p>{{ l[Number(s)] }}</p>")).toEqual([float]);
  });

  for (const name of ["xgetUTCDate", "xgetTime", "getTimex", "xvalueOf", "valueOfx"]) {
    it(`refuses an index \`${name}()\` makes a \`Float\` as any \`Float\``, () => {
      expect(refusals(`${l}function ${name}() { return props.n / 2; }`, `<p>{{ l[${name}()] }}</p>`)).toEqual([float]);
    });
  }

  it("refuses a string index `getTime()` gives as a string", () => {
    expect(refusals(`${l}function getTime() { return "a"; }`, "<p>{{ l[getTime()] }}</p>")).toEqual([
      "FV0824 `[…]` reads a list's item by an integer index, a `number` that is present, and this index is a string: `.at()` takes any number",
    ]);
  });

  it("refuses `encodeURIComponent()` of a character read by `[…]`", () => {
    expect(refusals(l, '<p>{{ encodeURIComponent(s[0] ?? "") }}</p>')).toEqual([
      'FV0706 `encodeURIComponent()` with a string that may hold half of a surrogate pair (cut by `slice`, `substring`, `at`, `charAt`, `split("")` and the like): JavaScript keeps the half, which can match, order or join with another where ferrovue holds U+FFFD; it throws a `URIError` on a half',
    ]);
  });

  it("joins a character that may be half of a pair to U+FFFD with `+`", () => {
    expect(render(l, "<p>{{ s.charAt(0) + '�' }}</p>")).toMatch(like('fv::core::escape_into(out, &format!("{}�", fv::strings::js_char_at(&props.s, 0.0f64)));'));
  });
});

describe("names holding `$`", () => {
  const rustOnly = (out: string) => out.replace(/"(?:[^"\\]|\\.)*"/g, "");
  const flat = (out: string) => out.split("\n").map((l) => l.trim()).join("\n");
  const whole = (script: string, template: string) => generate(project({ "X.vue": sfc(script, template) }), { components: "components", out: "out" }).get("x.rs")!;

  it("declares a `computed` whose name holds `$` as a Rust local without the `$`", () => {
    const out = render('import { computed } from "vue";\nconst props = defineProps<{ s: string }>();\nconst $x = computed(() => props.s + "!");', '<p :title="$x">{{ $x }}</p>');
    expect(rustOnly(out)).not.toContain("$");
    expect(flat(out)).toContain(['let s_x = format!("{}!", props.s);', 'out.push_str("<p");', "if s_x.is_empty() {"].join("\n"));
  });

  it("gives a setup name holding `$` the next free suffix where another name takes its Rust name", () => {
    const out = render('import { computed } from "vue";\nconst props = defineProps<{ s: string }>();\nconst $label = computed(() => props.s + "!");\nconst label = computed(() => props.s + "?");\nconst label$ = computed(() => props.s + "#");', "<p>{{ $label }}{{ label }}{{ label$ }}</p>");
    expect(flat(out)).toContain(['let s_label_2 = format!("{}!", props.s);', 'let s_label = format!("{}?", props.s);', 'let s_label_3 = format!("{}#", props.s);'].join("\n"));
  });

  it("writes a prop and fields whose names hold `$` as Rust fields renamed to their JSON keys", () => {
    const out = whole("interface Meta { $tag: string; tag: string; a$b: number; $type: string }\ndefineProps<{ price$: number; meta: Meta }>();", "<p>{{ price$ }}|{{ meta.$tag }}|{{ meta.tag }}|{{ meta.a$b }}|{{ meta.$type }}</p>");
    expect(rustOnly(out.replace(/#\[serde\(rename = "[^"]*"\)\]/g, ""))).not.toContain("$");
    expect(out).toContain('    #[serde(rename = "$tag")]\n    pub tag_2: Cow<\'a, str>,\n    #[serde(rename = "tag")]\n    pub tag: Cow<\'a, str>,\n    #[serde(rename = "a$b")]\n    pub a_b: i64,\n    #[serde(rename = "$type")]\n    pub r#type: Cow<\'a, str>,');
    expect(out).toContain('    #[serde(rename = "price$")]\n    pub price: i64,');
    expect(flat(out)).toContain(["fv::core::push_int(out, props.price);", "out.push('|');", "fv::core::escape_into(out, &props.meta.tag_2);", "out.push('|');", "fv::core::escape_into(out, &props.meta.tag);", "out.push('|');", "fv::core::push_int(out, props.meta.a_b);", "out.push('|');", "fv::core::escape_into(out, &props.meta.r#type);"].join("\n"));
  });

  it("writes a field `$slots` of a list's items as a Rust field", () => {
    const out = render("interface S { a: string }\ninterface I { $slots: S }\ndefineProps<{ l: I[] }>();", '<p v-for="y in l">{{ y.$slots.a }}</p>');
    expect(rustOnly(out)).not.toContain("$");
    expect(out).toMatch(like("fv::core::escape_into(out, &fv_y.slots.a);"));
  });

  it("names the locals of parameters, `const`s and `v-for` items holding `$` without the `$`", () => {
    const out = render("interface R { $tag: string }\nconst props = defineProps<{ s: string; rows: R[] }>();\nfunction shout($v: string): string { const $w = $v.toUpperCase() + props.s; return $w; }", '<p>{{ shout(s) }}</p><i v-for="($t, $i) in rows">{{ $t.$tag }}{{ $i }}</i>');
    expect(rustOnly(out)).not.toContain("$");
    expect(flat(out)).toContain(["for (fv_i, fv_t_ref) in props.rows.iter().enumerate() {", "let fv_t = fv_t_ref;", "let fv_i = fv_i as i64;"].join("\n"));
  });

  it("names slot props holding `$` without the `$`", () => {
    const out = whole("const props = defineProps<{ s: string; v: string }>();", '<slot name="x" :$v="s" :v="v" />');
    expect(out).toContain("pub struct XSlotProps<'v> {\n    pub v_2: &'v str,\n    pub v: &'v str,\n}");
    expect(out).toMatch(like("fv::render::scoped_slot_into(out, fv_slots.x, &XSlotProps { v_2: &props.s, v: &props.v }, None);"));
  });
});

describe("strings of a union chosen by `??` and `?:` for a child's union prop", () => {
  const few = { files: { "F.vue": sfc('defineProps<{ f?: "calm" | "" }>();', "<b>{{ f }}</b>") } };
  const script = 'import F from "./F.vue";\ntype Tone = "calm" | "loud" | "quiet";\ndefineProps<{ pick?: Tone; other: Tone; on: boolean }>();';
  const outside =
    'FV0515 the prop is one of "calm" | "", the members of `FF`, and the value given may be "loud" or "quiet": narrow it to the members, by `===` or `!==` with a literal, by its truth or by `||`, in `?:`, `&&` or `v-if`, or pass a value typed as the union';

  it.each([
    ["an optional member falling back to a literal by `??`", `<F :f="pick ?? ''" />`],
    ["a member and a literal chosen by `?:`", `<F :f="on ? other : 'calm'" />`],
    ["a literal and a member chosen by `?:`", `<F :f="on ? 'calm' : other" />`],
    ["a member and `undefined` chosen by `?:`", `<F :f="on ? other : undefined" />`],
  ])("refuses %s that may be a member outside the prop's union", (_, template) => {
    expect(refusals(script, template, few)).toEqual([outside]);
  });

  it("matches a `||` of a union's enum and a literal over the enum's variants for a child's union prop", () => {
    const child = { files: { "T.vue": sfc('defineProps<{ t: "calm" | "loud" | "quiet" }>();', "<b>{{ t }}</b>") } };
    expect(render('import T from "./T.vue";\ndefineProps<{ c: "calm" | "loud" | "quiet" | "" }>();', `<T :t="c || 'calm'" />`, child)).toMatch(like(
      "super::t::try_render(out, &super::t::Props { t: match props.c { XC::Calm | XC::Empty => super::t::TT::Calm, XC::Loud => super::t::TT::Loud, XC::Quiet => super::t::TT::Quiet } })?;",
    ));
  });

  it("matches `??` and `?:` of two values of a union's enum over their variants for a child's union prop", () => {
    const child = { files: { "T.vue": sfc('defineProps<{ t?: "calm" | "loud" | "quiet" }>();', "<b>{{ t }}</b>") } };
    const out = render(`import T from "./T.vue";\n${script.split("\n").slice(1).join("\n")}`, `<T :t="pick ?? other" /><T :t="on ? pick : undefined" />`, child);
    expect(out).not.toContain("_ => super::t::TT::");
    expect(out).toMatch(like("t: Some(props.pick.map(|v| match v { Tone::Calm => super::t::TT::Calm, Tone::Loud => super::t::TT::Loud, Tone::Quiet => super::t::TT::Quiet }).unwrap_or(match props.other {"));
    expect(out).toMatch(like("t: if props.on { props.pick.map(|v| match v { Tone::Calm => super::t::TT::Calm, Tone::Loud => super::t::TT::Loud, Tone::Quiet => super::t::TT::Quiet }) } else { None }"));
  });

  it("reads a `?:` whose test is known when compiling as the type of both branches, where a member of a union and a string are compared with a literal outside the union", () => {
    const out = render('defineProps<{ t: "a&b" | "md"; s: string }>();', `<p>{{ (Number.isNaN(1.5) ? s : t) !== '-' }}|{{ (Number.isNaN(1) ? 'x' : t) === 'x' }}</p>`);
    expect(out).toMatch(like('out.push_str(if fv::props::Union::as_str(props.t) != "-" { "true" } else { "false" });'));
    expect(out).toMatch(like('out.push_str(if fv::props::Union::as_str(props.t) == "x" { "true" } else { "false" });'));
  });

  it("holds a `computed` annotated as a union as its enum, so a child's union prop takes it with no `_` arm", () => {
    const child = { files: { "T.vue": sfc('defineProps<{ t: "calm" | "loud" | "quiet" }>();', "<b>{{ t }}</b>") } };
    const out = render(
      'import { computed } from "vue";\nimport T from "./T.vue";\ntype Tone = "calm" | "loud" | "quiet";\nconst props = defineProps<{ on: boolean; n: number; tone: Tone }>();\nconst a = computed((): Tone => (props.on ? "loud" : "calm"));\nconst b = computed((): Tone => { if (props.n > 2) return "quiet"; return props.on ? "calm" : "loud"; });\nconst c = computed<Tone>(() => (props.on ? "calm" : props.tone));',
      '<T :t="a" /><T :t="b" /><T :t="c" />{{ a }}',
      child,
    );
    expect(out).not.toContain("_ =>");
    expect(out).toMatch(like("let s_a = if props.on { Tone::Loud } else { Tone::Calm };"));
    expect(out).toMatch(like("let s_b = if props.n as f64 > 2.0 { Tone::Quiet } else { if props.on { Tone::Calm } else { Tone::Loud } };"));
    expect(out).toMatch(like("let s_c = if props.on { Tone::Calm } else { props.tone };"));
    expect(out).toMatch(like("t: match s_a { Tone::Calm => super::t::TT::Calm, Tone::Loud => super::t::TT::Loud, Tone::Quiet => super::t::TT::Quiet }"));
    expect(out).toMatch(like("fv::core::escape_into(out, fv::props::Union::as_str(s_a));"));
  });

  it("hands a child's list of a union a `.map()`, a `.filter()` and an array literal of its values as lists of enums", () => {
    const files = {
      "T.vue": sfc('defineProps<{ ts: ("calm" | "loud" | "quiet")[] }>();', "<b>{{ ts.join() }}</b>"),
      "tones.ts": 'export type Tone = "calm" | "loud" | "quiet";\nexport interface Row { name: string; tone: Tone }\nexport interface Card { tones: Tone[] }\n',
      "C.vue": sfc('import type { Card } from "./tones";\ndefineProps<{ card: Card }>();', "<b>{{ card.tones.join() }}</b>"),
    };
    const out = render(
      'import { computed } from "vue";\nimport T from "./T.vue";\nimport C from "./C.vue";\nimport type { Row, Tone } from "./tones";\nconst props = defineProps<{ rows: Row[]; tones: Tone[]; tone: Tone }>();\nconst loud = computed(() => props.tones.filter((t) => t !== "calm"));',
      `<T :ts="rows.map((r) => r.tone)" /><T :ts="tones.map((t) => t)" /><T :ts="loud" /><T :ts="[tone, 'calm']" /><C :card="{ tones: [tone, 'quiet'] }" />`,
      { files },
    );
    expect(out).not.toContain("_ =>");
    expect(out).toMatch(like("ts: props.rows.iter().map(|fv_r| fv_r.tone).map(|v| match v { super::types::Tone::Calm => super::t::TTs::Calm, super::types::Tone::Loud => super::t::TTs::Loud, super::types::Tone::Quiet => super::t::TTs::Quiet }).collect()"));
    expect(out).toMatch(like("let s_loud = props.tones.iter().copied().filter(|fv_t| *fv_t != super::types::Tone::Calm).collect::<Vec<_>>();"));
    expect(out).toMatch(like("card: super::types::Card { tones: vec![props.tone, super::types::Tone::Quiet] }"));
  });

  it("reads an optional `ref` of a union through `match`es over `Some` of each variant and `None`", () => {
    const child = { files: { "T.vue": sfc('defineProps<{ t: "calm" | "loud" }>();', "<b>{{ t }}</b>") } };
    const out = render(
      'import { ref } from "vue";\nimport T from "./T.vue";\ntype Tone = "calm" | "loud";\nconst props = defineProps<{ start?: Tone }>();\nconst m = ref<Tone | "" | undefined>(props.start);',
      `<T :t="m || 'loud'" /><T :t="m ? m : 'calm'" /><T v-if="m" :t="m" /><i v-if="m === ''">e</i><T v-else-if="m !== undefined" :t="m" />`,
      child,
    );
    expect(out).not.toContain("_ =>");
    expect(out).toMatch(like("t: match s_m { Some(XM::Calm) => super::t::TT::Calm, Some(XM::Loud) | Some(XM::Empty) | None => super::t::TT::Loud }"));
    expect(out).toMatch(like("t: match s_m { Some(XM::Calm) | Some(XM::Empty) | None => super::t::TT::Calm, Some(XM::Loud) => super::t::TT::Loud }"));
    expect(out).toMatch(like("if let Some(n1) = match s_m { Some(XM::Calm) => Some(super::t::TT::Calm), Some(XM::Loud) => Some(super::t::TT::Loud), Some(XM::Empty) | None => None } {"));
    expect(out.match(/Some\(XM::Empty\) \| None => None/g)).toHaveLength(2);
  });

  it("hands a function's `string` parameter a value of a union's enum as its string, which compares with any literal", () => {
    const out = render(
      'import { computed } from "vue";\nconst props = defineProps<{ on: boolean }>();\nconst t = computed((): "sm" | "md" => (props.on ? "sm" : "md"));\nfunction odd(s: string): boolean { return s === "ß"; }',
      "<p>{{ odd(t) }}</p>",
    );
    expect(out).toMatch(like('let n1 = fv::props::Union::as_str(s_t);'));
    expect(out).toMatch(like('n1 == "ß"'));
  });

  it("reads a table by a key built with `||` or `?:` through one `match` over the enum the key is made from", () => {
    const child = { files: { "T.vue": sfc('defineProps<{ t: "calm" | "loud" | "quiet" }>();', "<b>{{ t }}</b>") } };
    const out = render(
      'import { ref } from "vue";\nimport T from "./T.vue";\ntype Tone = "calm" | "loud" | "quiet";\nconst props = defineProps<{ start?: Tone; on: boolean }>();\nconst tone = ref<Tone | "">(props.start ?? "");\nconst NEXT: Record<Tone, Tone> = { calm: "loud", loud: "quiet", quiet: "calm" };\nconst PAD = { calm: "p-1", loud: "p-2", quiet: "p-3" } as const;',
      `<T :t="NEXT[tone || 'calm']" /><T :t="NEXT[on ? 'loud' : 'quiet']" />{{ PAD[tone || 'loud'] }}`,
      child,
    );
    expect(out).not.toContain("_ =>");
    expect(out).toMatch(like("t: match s_tone { XTone::Calm | XTone::Empty => super::t::TT::Loud, XTone::Loud => super::t::TT::Quiet, XTone::Quiet => super::t::TT::Calm }"));
    expect(out).toMatch(like("t: if props.on { super::t::TT::Quiet } else { super::t::TT::Calm }"));
    expect(out).toMatch(like('fv::core::escape_into(out, match s_tone { XTone::Calm => "p-1", XTone::Loud | XTone::Empty => "p-2", XTone::Quiet => "p-3" });'));
  });

  it("reads the left side of `??` on its right with the type its declaration gives", () => {
    const out = render('defineProps<{ o?: "" | "a" }>();\nconst T = { "": "E" };', '<p>{{ o ?? (o !== undefined ? T[o] : "z") }}</p>');
    expect(out).toMatch(like('props.o.map(fv::props::Union::as_str).or(if let Some(fv_o) = props.o { match fv_o { XO::Empty => Some("E"), XO::A => None } } else { Some("z") })'));
  });
});

describe("values of a union converted to a child's union through `?:`, `||` and `??`", () => {
  const files = {
    "tones.ts": 'export type Tone = "calm" | "loud" | "quiet";\nexport interface Card { tone: Tone }\nexport interface Pair { loud: Tone; quiet: Tone }\nexport const SHADE: Record<"loud" | "quiet" | "", Tone> = { loud: "quiet", quiet: "calm", "": "loud" };\n',
    "T.vue": sfc('import type { Tone } from "./tones";\ndefineProps<{ t?: Tone }>();', "<b>{{ t }}</b>"),
    "C.vue": sfc('import type { Card } from "./tones";\ndefineProps<{ card: Card }>();', "<b>{{ card.tone }}</b>"),
  };
  const script = [
    'import { computed, ref } from "vue";',
    'import T from "./T.vue";',
    'import C from "./C.vue";',
    'import { type Tone, type Pair, SHADE } from "./tones";',
    'const props = defineProps<{ start?: Tone; pick: Tone; pair: Pair; on: boolean; word: string; wide: Tone | "hot"; n: number }>();',
    'const tone = ref<Tone | "">(props.start ?? "");',
    'const lit = computed(() => (props.on ? "calm" : undefined));',
    'const two = computed(() => (props.on ? "calm" : "loud"));',
  ].join("\n");
  const shown = (template: string) => render(script, template, { files });
  const refused = (template: string) => refusals(script, template, { files });

  const TONE = "super::types::Tone";
  const parsed = (subject: string) => like(`t: Some(match ${subject}.parse::<${TONE}>() { Ok(fv_u) => fv_u, Err(fv_e) => {`);
  const outside = (given: string) => `FV0515 the prop is one of "calm" | "loud" | "quiet", the members of \`Tone\`, and the value given ${given}`;

  it("binds the child's member in the test of the `v-if` a render opens with, where the branch reads it before its last line", () => {
    const out = render('import T from "./T.vue";\nimport type { Tone } from "./tones";\ndefineProps<{ pick: Tone }>();', `<template v-if="pick !== 'calm'"><T :t="pick" /><i>x</i></template>`, { files });
    expect(out).toMatch(like(`if let Some(fv_pick) = match props.pick { ${TONE}::Calm => None, ${TONE}::Loud => Some(${TONE}::Loud), ${TONE}::Quiet => Some(${TONE}::Quiet) } {`));
    expect(out).toMatch(like("super::t::try_render(out, &super::t::Props { t: Some(fv_pick) })?;"));
  });

  it("converts a `?:` inside a branch another `?:` narrows, through the table read its own `match` gives", () => {
    const out = shown(`<C :card="tone !== 'calm' ? { tone: tone === 'loud' ? 'calm' : SHADE[tone] } : { tone: 'calm' }" />`);
    expect(out).toMatch(like(`tone: if s_tone == XTone::Loud { ${TONE}::Calm } else { match s_tone { XTone::Quiet => ${TONE}::Calm, XTone::Empty | XTone::Calm | XTone::Loud => ${TONE}::Loud } }`));
  });

  it("parses a `?:` whose branch reads a field by a key narrowed to members the struct has", () => {
    const out = shown(`<C :card="pick !== 'calm' ? { tone: pick === 'loud' ? 'calm' : pair[pick] } : { tone: 'calm' }" />`);
    expect(out).toMatch(like(`tone: match (if props.pick == ${TONE}::Loud { "calm" } else { fv::props::Union::as_str(props.pair.quiet) }).parse::<${TONE}>()`));
  });

  it("reads a field by a key a `?:` narrows, giving the members it leaves out the arm of the first it keeps", () => {
    const out = shown(`<b>{{ pick !== 'calm' ? pair[pick] : 'none' }}</b>`);
    expect(out).toMatch(like(`match props.pick { ${TONE}::Calm | ${TONE}::Loud => fv::props::Union::as_str(props.pair.loud), ${TONE}::Quiet => fv::props::Union::as_str(props.pair.quiet) }`));
  });

  it.each([
    ["a `?:` of literals", `start ?? (on ? 'calm' : 'loud')`, `props.start.map(fv::props::Union::as_str).unwrap_or(if props.on { "calm" } else { "loud" })`],
    ["an optional string of literals and a literal", `lit ?? 'loud'`, `s_lit.unwrap_or("loud")`],
    ["a string of literals", `start ?? two`, `props.start.map(fv::props::Union::as_str).unwrap_or(s_two)`],
  ])("parses `??` of an optional union and %s, which holds no enum", (_, value, subject) => {
    expect(shown(`<T :t="${value}" />`)).toMatch(parsed(subject));
  });

  it("parses a `?:` of a string of literals, which holds no enum, and a literal", () => {
    expect(shown(`<T :t="on ? two : 'calm'" />`)).toMatch(parsed(`(if props.on { s_two } else { "calm" })`));
  });

  it("parses the right side of `&&` after a union with no falsy member, for each of its variants", () => {
    expect(shown(`<T :t="pick && two" />`)).toMatch(like(`t: Some(match props.pick { ${TONE}::Calm | ${TONE}::Loud | ${TONE}::Quiet => match s_two.parse::<${TONE}>()`));
  });

  it("compares a literal on the left of `===` with a value of a union by its variant", () => {
    expect(shown(`<i v-if="'calm' === tone">c</i>`)).toMatch(like("if s_tone == XTone::Calm {"));
  });

  it.each([
    [`tone === 'calm' ? word : 'loud'`, "is a string that may be any other: pass one of them, or a value typed as the union"],
    [`start ?? 'zzz'`, 'may be "zzz": narrow it'],
    [`start ?? wide`, 'may be "hot": narrow it'],
  ])("refuses %s for a child's union prop", (value, given) => {
    expect(refused(`<T :t="${value}" />`)).toEqual([expect.stringContaining(outside(given))]);
  });

  it("reports each refused statement after a conversion that translates a branch for each variant", () => {
    expect(refused(`<T :t="tone || undefined" /><p>{{ n.toFixed(200) }}</p><p>{{ n.toFixed(300) }}</p>`)).toEqual([expect.stringMatching(/^FV0705 /), expect.stringMatching(/^FV0705 /)]);
  });
});

describe("names of the template read in `<script setup>`", () => {
  it("refuses `$slots`, which `<script setup>` does not define", () => {
    expect(refusals('import { computed } from "vue";\nconst has = computed(() => ($slots.side ? 1 : 0));', '<i>{{ has }}<slot name="side" /></i>')).toEqual([expect.stringMatching(/^FV0601 `\$slots` is not available when rendering on the server/)]);
  });

  it.fails("refuses a member of a `ref` other than `.value`, which Vue reads as `undefined`", () => {
    expect(refusals('import { computed, ref } from "vue";\ninterface Item { a: string }\nconst r = ref<Item>({ a: "x" });\nconst c = computed(() => r.a);', "<p>{{ c }}</p>")).toHaveLength(1);
  });
});
