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

function compiled(script: string, template: string, files: Record<string, string> = {}): Map<string, string> {
  return generate(project({ "X.vue": sfc(script, template), ...files }), { components: "components", out: "out" });
}

function render(script: string, template: string, files: Record<string, string> = {}): string {
  const out = compiled(script, template, files).get("x.rs")!;
  return /pub fn try_render[\s\S]*?\n}\n/.exec(out)![0];
}

function rows(script: string, template: string, files: Record<string, string> = {}): string[] {
  return compiled(script, template, files)
    .get("types.rs")!
    .split("\n")
    .filter((line) => /^pub const|^ {4}[A-Z]\w* \{/.test(line));
}

function refusals(script: string, template: string, files: Record<string, string> = {}): string[] {
  try {
    compiled(script, template, files);
  } catch (e) {
    if (e instanceof GenErrors) return e.errors.map((one) => (one instanceof GenError ? `${one.code} ${one.what}` : String(one)));
    if (e instanceof GenError) return [`${e.code} ${e.what}`];
    throw e;
  }
  throw new Error("compiled without an error");
}

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

const EVALUATES =
  "a constant the compiler evaluates is a literal, `+`, `-`, `*`, `/`, `%`, `**` or a template literal of such values, a list or an object of them, or another such constant of the same file";

const imported = (names: string, ts: string, template: string): string[] => refusals(`import { ${names} } from "./c";`, template, { "c.ts": ts });

describe("constants a `.ts` file declares", () => {
  const reads = (name: string, at = "4:17") => `(the template reads it as \`${name}\` at components/X.vue:${at})`;

  const refused: [string, string, string, string, string][] = [
    ["a constant that refers to itself", "A", "export const A = B;\nconst B = A;", "<p>{{ A }}</p>", `FV0201 a constant that refers to itself ${reads("A")}`],
    ["an enum member without a value after a string member", "E", 'export enum E { A = "a", B }', "<p>{{ E.B }}</p>", `FV0202 enum member \`B\` follows a string member, so it needs a value ${reads("E")}`],
    ["an enum member that is a boolean", "E", "export enum E { A = true }", "<p>{{ E.A }}</p>", `FV0203 an enum member's value is a string or a number literal ${reads("E")}`],
    ["an enum member that is `null`", "E", "export enum E { A = null }", "<p>{{ E.A }}</p>", `FV0203 an enum member's value is a string or a number literal ${reads("E")}`],
    ["an enum member that is a list", "E", "export enum E { A = [1] }", "<p>{{ E.A }}</p>", `FV0203 an enum member's value is a string or a number literal ${reads("E")}`],
    ["a unary minus of a string", "A", 'export const A = -"x";', "<p>{{ A }}</p>", `FV0207 unary \`-\` in a constant takes a number ${reads("A")}`],
    ["a unary plus of a string", "A", 'export const A = +"x";', "<p>{{ A }}</p>", `FV0207 unary \`+\` in a constant takes a number ${reads("A")}`],
    ["a negation", "A", "export const A = !1;", "<p>{{ A }}</p>", `FV0207 ${EVALUATES} ${reads("A")}`],
    ["a comparison", "A", "export const A = 1 < 2;", "<p>{{ A }}</p>", `FV0207 ${EVALUATES} ${reads("A")}`],
    ["a field read by a key it computes", "B", "const O = { a: 1 };\nconst k = 'a';\nexport const B = O[k];", "<p>{{ B }}</p>", `FV0207 ${EVALUATES} ${reads("B")}`],
    ["a field a constant object lacks", "B", "const O = { a: 1 };\nexport const B = O.zz;", "<p>{{ B }}</p>", `FV0204 \`O\` has no field \`zz\` ${reads("B")}`],
    ["a field of a list", "B", "const O = [1];\nexport const B = O.length;", "<p>{{ B }}</p>", `FV0207 ${EVALUATES} ${reads("B")}`],
    ["a list with a hole", "L", "export const L = [1, , 2];", '<p v-for="x in L">{{ x }}</p>', `FV0205 a constant list holds plain values ${reads("L", "4:26")}`],
    ["a list with a spread", "L", "const M = [1];\nexport const L = [...M];", '<p v-for="x in L">{{ x }}</p>', `FV0205 a constant list holds plain values ${reads("L", "4:26")}`],
    ["a `Map` of two arguments", "M", "export const M = new Map([[1, 2]], 3);", "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\` is built from one array literal of \`[key, value]\` pairs ${reads("M")}`],
    ["a `Map` of a named list", "M", "const X = [[1, 2]];\nexport const M = new Map(X);", "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\` is built from an array literal of \`[key, value]\` pairs, written out ${reads("M")}`],
    ["a `Map` entry of one item", "M", "export const M = new Map([[1]]);", "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\`'s entry is a \`[key, value]\` pair, written out ${reads("M")}`],
    ["a `Map` entry of three items", "M", "export const M = new Map([[1, 2, 3]]);", "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\`'s entry is a \`[key, value]\` pair, written out ${reads("M")}`],
    ["a `Map` entry with a hole", "M", "export const M = new Map([[, 2]]);", "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\`'s entry is a \`[key, value]\` pair, written out ${reads("M")}`],
    ["a `Map` entry with a spread", "M", "const P = [1, 2];\nexport const M = new Map([[...P, 2]]);", "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\`'s entry is a \`[key, value]\` pair, written out ${reads("M")}`],
    ["a `Map` entry that is no pair", "M", "export const M = new Map([1]);", "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\`'s entry is a \`[key, value]\` pair, written out ${reads("M")}`],
    ["a `Map` of a list with a hole", "M", "export const M = new Map([, [1, 2]]);", "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\`'s entry is a \`[key, value]\` pair, written out ${reads("M")}`],
    ["a `Map` keyed by a fraction", "M", 'export const M = new Map([[1.5, "a"]]);', "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\`'s key is a string or an integer ${reads("M")}`],
    ["a `Map` keyed by a boolean", "M", 'export const M = new Map([[true, "a"]]);', "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\`'s key is a string or an integer ${reads("M")}`],
    ["a `Map` keyed by an unsafe integer", "M", 'export const M = new Map([[9007199254740993, "a"]]);', "<p>{{ M.get(1) }}</p>", `FV0207 a constant \`Map\`'s key is a string or an integer ${reads("M")}`],
    ["a `Map` the file declares", "M", "const Map = 1;\nexport const M = new Map([[1, 2]]);", "<p>{{ M }}</p>", `FV0207 ${EVALUATES} ${reads("M")}`],
    ["a `Map` read from a namespace", "M", "export const M = new globalThis.Map([[1, 2]]);", "<p>{{ M }}</p>", `FV0207 ${EVALUATES} ${reads("M")}`],
    ["a `Set`", "M", "export const M = new Set([1]);", "<p>{{ M }}</p>", `FV0207 ${EVALUATES} ${reads("M")}`],
    ["an object with a method", "O", "export const O = { f() { return 1; } };", "<p>{{ O.f }}</p>", `FV0206 a constant object holds plain keys and values ${reads("O")}`],
    ["an object with a spread", "O", "const P = { a: 1 };\nexport const O = { ...P };", "<p>{{ O.a }}</p>", `FV0206 a constant object holds plain keys and values ${reads("O")}`],
    ["a string less a number", "A", 'export const A = "a" - 1;', "<p>{{ A }}</p>", `FV0207 \`-\` in a constant takes two numbers, and these are string and number ${reads("A")}`],
    ["`null` plus a number", "A", "export const A = null + 1;", "<p>{{ A }}</p>", `FV0207 \`+\` in a constant joins strings or adds numbers, and these are null and number ${reads("A")}`],
    ["a number plus a boolean", "A", "export const A = 1 + true;", "<p>{{ A }}</p>", `FV0207 \`+\` in a constant joins strings or adds numbers, and these are number and boolean ${reads("A")}`],
    ["a number times `null`", "A", "export const A = 2 * null;", "<p>{{ A }}</p>", `FV0207 \`*\` in a constant takes two numbers, and these are number and null ${reads("A")}`],
    ["a boolean times a number", "A", "export const A = true * 2;", "<p>{{ A }}</p>", `FV0207 \`*\` in a constant takes two numbers, and these are boolean and number ${reads("A")}`],
    ["a list plus a number", "A", "export const A = [1] + 1;", "<p>{{ A }}</p>", `FV0207 arithmetic and template literals in a constant take strings, numbers, booleans and \`null\`, and this is a list or an object ${reads("A")}`],
    ["a list in a template literal", "A", "const N = [2];\nexport const A = `a${N}`;", "<p>{{ A }}</p>", `FV0207 arithmetic and template literals in a constant take strings, numbers, booleans and \`null\`, and this is a list or an object ${reads("A")}`],
    ["a power with a fraction", "A", "export const A = 2 ** 0.5;", "<p>{{ A }}</p>", `FV0720 \`**\` of 2 and 0.5, which is not an integer to a whole power from 0 with a result within ±2⁵³: engines round such powers in their own ways ${reads("A")}`],
    ["a computed key that is a boolean", "O", "export const O = { [true]: 1 };", "<p>{{ O.true }}</p>", `FV0206 a constant object's computed key is a string or a number the compiler evaluates, as an enum member ${reads("O")}`],
    ["a computed key that is a list", "O", "export const O = { [[1]]: 1 };", "<p>{{ O[1] }}</p>", `FV0206 a constant object's computed key is a string or a number the compiler evaluates, as an enum member ${reads("O")}`],
    ["an empty object read whole", "O", "export const O = {};", "<p>{{ O }}</p>", "FV0208 `O` is an object, read one field at a time: `O.x`"],
    ["an object read whole", "O", "export const O = { k: 1 };", "<p>{{ O }}</p>", "FV0208 `O` is an object, read one field at a time: `O.k`"],
  ];

  for (const [what, names, ts, template, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(imported(names, ts, template)).toEqual([message]);
    });
  }

  it("evaluates literals, arithmetic, template literals, enums and fields of the same file", () => {
    const out = render(
      'import { A, B, C, D, E, F, G, H, I, J, K, L, N, P, Q } from "./c";',
      "<p>{{ A }} {{ B }} {{ C }} {{ D }} {{ E }} {{ F }} {{ G }} {{ H }} {{ I }} {{ J }} {{ K }} {{ L }} {{ N }} {{ P }} {{ Q }}</p>",
      {
        "c.ts": [
          "export const A = -2;",
          "export const B = +3;",
          "export const C = 7 - 2 + 7 * 2;",
          "export const D = 7 / 2;",
          "export const E = 7 % 2 + 2 ** 3;",
          'export const F = 1 + "a";',
          'export const G = "a" + 1;',
          'const NUM = 2;\nexport const H = `a${NUM}b${"c"}${null}`;',
          "export const I = ((1)!);",
          "export const J = (2 satisfies number) as number;",
          'enum Step { One = 3, Two, Name = "n" }',
          "export const K = Step.Two;",
          "export const L = Step[4];",
          "export const N = Step[3];",
          'const O = { a: 1, 2: "two", ["c" + "d"]: "cd", [1 + 2]: "three" };',
          'export const P = `${O["a"]}${O[2]}${O.cd}`;',
          "export const Q = O[3];",
        ].join("\n"),
      },
    );
    expect(out).toMatch(like('out.push_str("<p>-2 3 19 3.5 9 1a a1 a2bcnull 1 2 4 Two One 1twocd three</p>");'));
  });

  it("reads only the `const` declarations a file has, with a value", () => {
    const unavailable = ["FV0601 `A` is imported from `./c`, a module the server does not run"];
    expect(imported("A", "export let A = 1;", "<p>{{ A }}</p>")).toEqual(unavailable);
    expect(imported("A", "export declare const A: number;", "<p>{{ A }}</p>")).toEqual(unavailable);
  });

  it("reads an enum's members by a quoted name, and has no reverse mapping for a string member", () => {
    expect(render('import { E } from "./c";', "<p>{{ E.Q }} {{ E['Q'] }} {{ E.R }}</p>", { "c.ts": 'export enum E { "Q" = 5, R }' })).toMatch(like('out.push_str("<p>5 5 6</p>");'));
    expect(compiled('import { E } from "./c";\ndefineProps<{ e: E }>();', "<p>{{ e }}</p>", { "c.ts": 'export enum E { "Q" = "q", R = "r" }' }).get("types.rs")).toMatch(/pub enum E \{[^}]*\bQ,[^}]*\bR,/);
    expect(imported("E", 'export enum E { Name = "n" }', "<p>{{ E.n }}</p>")).toEqual(["FV0204 `E` has no field `n`"]);
  });

  it("names the list a `Map` holds by its key", () => {
    expect(compiled('defineProps<{ k: "a" }>();\nconst M = new Map([["a", [{ x: 1 }]]]);', '<p v-for="r in M.get(k)">{{ r.x }}</p>').get("types.rs")).toMatch(like("pub const M_A: &[MAItem] = &[\n    MAItem { x: 1 },\n];"));
  });

  it("names a constant list's struct and Rust name after the path to it", () => {
    const out = compiled('import { theme } from "./c";', '<p v-for="r in theme.darkMode">{{ r.a }}</p><p v-for="r in theme.kw.type">{{ r.a }}</p><p v-for="r in theme.HTTP_URLS">{{ r.a }}</p><p v-for="r in theme.rowX">{{ r.a }}</p><p v-for="r in theme.Rows">{{ r.a }}</p>', {
      "c.ts": "export const theme = { darkMode: [{ a: 1 }], kw: { type: [{ a: 2 }] }, HTTP_URLS: [{ a: 3 }], rowX: [{ a: 4 }], Rows: [{ a: 5 }] };",
    }).get("types.rs")!;
    expect(out).toMatch(like("/// `theme.darkMode` in `components/c.ts`.\npub const THEME_DARK_MODE: &[ThemeDarkModeItem] = &[\n    ThemeDarkModeItem { a: 1 },\n];"));
    expect(out).toMatch(like("pub const THEME_KW_TYPE: &[ThemeKwTypeItem] = &[\n    ThemeKwTypeItem { a: 2 },\n];"));
    expect(out).toMatch(like("pub const THEME_HTTP_URLS: &[ThemeHttpUrlsItem] = &[\n    ThemeHttpUrlsItem { a: 3 },\n];"));
    expect(out).toMatch(like("pub const THEME_ROW_X: &[ThemeRowxItem] = &[\n    ThemeRowxItem { a: 4 },\n];"));
    expect(out).toMatch(like("pub const THEME_ROWS: &[ThemeRowsItem] = &[\n    ThemeRowsItem { a: 5 },\n];"));
  });

  it("evaluates a constant once however often it is read", () => {
    const out = render('import { ROWS } from "./c";\nimport Y from "./Y.vue";', '<p v-for="r in ROWS">{{ r.a }}</p><p v-for="r in ROWS">{{ r.a }}</p><Y />', {
      "c.ts": "export const ROWS = [{ a: 1 }];",
      "Y.vue": sfc('import { ROWS } from "./c";', '<p v-for="r in ROWS">{{ r.a }}</p>'),
    });
    expect(out.match(/super::types::ROWS\.iter\(\)/g)).toHaveLength(2);
  });
});

describe("constant lists", () => {
  const loop = '<p v-for="r in L">{{ r.a }}</p>';
  const list = (ts: string, template = loop) => rows('import { L } from "./c";', template, { "c.ts": ts });

  it("takes the struct of the type a list is stated as, by `as`, `satisfies` or an annotation", () => {
    const want = ["pub const L: &[Row] = &[", "    Row { a: 1 },"];
    expect(list("interface Row { a: number }\nexport const L = [{ a: 1 }] as Row[];")).toEqual(want);
    expect(list("interface Row { a: number }\nexport const L = [{ a: 1 }] satisfies Array<Row>;")).toEqual(want);
    expect(list("interface Row { a: number }\nexport const L: readonly Row[] = [{ a: 1 }];")).toEqual(want);
    expect(list("interface Row { a: number }\nexport const L: ReadonlyArray<Row> = [{ a: 1 }];")).toEqual(want);
    expect(list("interface Row { a: number }\nexport const L = ([{ a: 1 }] as const) as Row[];")).toEqual(want);
    expect(list("interface Row { a: number }\nexport const L = ([{ a: 1 }] satisfies Row[]) as const;")).toEqual(want);
  });

  it("builds a struct of its own for a list stated as a type that is no list of a declared struct", () => {
    const own = ["pub const L: &[LItem] = &[", "    LItem { a: 1 },"];
    expect(list("interface Row { a: number }\nexport const L: Set<Row> = [{ a: 1 }];")).toEqual(own);
    expect(list("interface Row { a: number }\nexport const L: Array<NS.Row> = [{ a: 1 }];")).toEqual(own);
    expect(list("interface Row { a: number }\nexport const L: Array = [{ a: 1 }];")).toEqual(own);
    expect(list("interface Row { a: number }\nexport const L: Other[] = [{ a: 1 }];")).toEqual(own);
  });

  it("writes each kind of field a stated struct has", () => {
    expect(
      list(
        'import type { Float } from "ferrovue/types";\ninterface Row { a: number; s: string; f: Float; b: boolean; o?: string; n: string | null; e?: string | null; k: "x" | "y"; g?: Float; h: number | null }\nexport const L: Row[] = [{ a: 1, s: "s", f: 2.5, b: true, n: null, k: "y", h: 3 }, { a: 2, s: "t", f: 3, b: false, o: "o", n: "n", e: null, k: "x", g: 1, h: null }, { a: -4, s: "", f: -0.5, b: true, n: "", e: "e", k: "x", g: 2.5, h: -1 }];',
      ),
    ).toEqual([
      "pub const L: &[Row<'static>] = &[",
      '    Row { a: 1, s: Cow::Borrowed("s"), f: 2.5f64, b: true, o: None, n: None, k: RowK::Y, g: None, h: Some(3) },',
      '    Row { a: 2, s: Cow::Borrowed("t"), f: 3.0f64, b: false, o: Some(Cow::Borrowed("o")), n: Some(Cow::Borrowed("n")), k: RowK::X, g: Some(1.0f64), h: None },',
      '    Row { a: -4, s: Cow::Borrowed(""), f: -0.5f64, b: true, o: None, n: Some(Cow::Borrowed("")), k: RowK::X, g: Some(2.5f64), h: Some(-1) },',
    ]);
  });

  it("writes an enum's members and values in a list of a struct with a field of the enum", () => {
    expect(list('export enum Tone { A = "a", B = "b" }\ninterface Row { a: number; k: Tone }\nexport const L: Row[] = [{ a: 1, k: Tone.B }, { a: 2, k: "a" }];')).toEqual([
      "pub const L: &[Row] = &[",
      "    Row { a: 1, k: Tone::B },",
      "    Row { a: 2, k: Tone::A },",
    ]);
  });

  it("types the fields of a list's own struct from its values", () => {
    expect(list('export const L = [{ a: 1, b: null, s: "x" }, { a: 2.5, b: "x", s: "y" }];')).toEqual([
      "pub const L: &[LItem<'static>] = &[",
      '    LItem { a: 1.0f64, b: None, s: Cow::Borrowed("x") },',
      '    LItem { a: 2.5f64, b: Some(Cow::Borrowed("x")), s: Cow::Borrowed("y") },',
    ]);
    expect(list('export const L = [{ a: 1, b: "x" }, { a: 2 }];')).toEqual(["pub const L: &[LItem<'static>] = &[", '    LItem { a: 1, b: Some(Cow::Borrowed("x")) },', "    LItem { a: 2, b: None },"]);
    expect(list("export const L = [{ a: true }, { a: false }];")).toEqual(["pub const L: &[LItem] = &[", "    LItem { a: true },", "    LItem { a: false },"]);
    expect(list("export const L = [{ a: 1, myField: 2, type: 3 }];")).toEqual(["pub const L: &[LItem] = &[", "    LItem { a: 1, my_field: 2, r#type: 3 },"]);
  });

  it("writes a list of numbers as floats where one is a fraction", () => {
    expect(render('import { L, M } from "./c";', '<p v-for="r in L">{{ r }}</p><p v-for="r in M">{{ r }}</p>', { "c.ts": "export const L = [1, 2.5];\nexport const M = [1, 2];" })).toMatch(like(
      "for r_ref in [1.0f64, 2.5f64].iter() {",
    ));
    expect(render('import { M } from "./c";', '<p v-for="r in M">{{ r }}</p>', { "c.ts": "export const M = [1, 2];" })).toMatch(like("for r_ref in [1i64, 2i64].iter() {"));
  });

  const refused: [string, string, string, string][] = [
    ["a stated struct's field it lacks", "interface Row { a: number; b: string }\nexport const L: Row[] = [{ a: 1 }];", loop, "FV0213 this object needs `b`"],
    ["a stated struct's nullable field it lacks", "interface Row { a: number; b: string | null }\nexport const L: Row[] = [{ a: 1 }];", loop, "FV0213 this object needs `b`"],
    ["`null` for a field that is no nullable", "interface Row { a: number; b: string }\nexport const L: Row[] = [{ a: 1, b: null }];", loop, "FV0214 `b` in a constant list's object is not `null`"],
    ["`null` for an optional field", "interface Row { a: number; b?: string }\nexport const L: Row[] = [{ a: 1, b: null }];", loop, "FV0214 `b` in a constant list's object is not `null`"],
    ["a number for a string field", "interface Row { a: number; b: string }\nexport const L: Row[] = [{ a: 1, b: 2 }];", loop, "FV0215 `b` in a constant list's object is a string"],
    ["a number for a boolean field", "interface Row { a: number; b: boolean }\nexport const L: Row[] = [{ a: 1, b: 2 }];", loop, "FV0215 `b` in a constant list's object is a boolean"],
    ["a string for a number field", 'interface Row { a: number }\nexport const L: Row[] = [{ a: "1" }];', loop, "FV0215 `a` in a constant list's object is a number"],
    ["a fraction for an integer field", "interface Row { a: number }\nexport const L: Row[] = [{ a: 1.5 }];", loop, "FV0215 `a` in a constant list's object is a number"],
    ["an object for a number field", "interface Row { a: number }\nexport const L: Row[] = [{ a: { x: 1 } }];", loop, "FV0215 `a` in a constant list's object is a number"],
    ["a string for a list field", 'interface Row { a: number; b: string[] }\nexport const L: Row[] = [{ a: 1, b: "x" }];', loop, "FV0215 `b` in a constant list's object is a string, a number or a boolean"],
    ["a key the stated struct lacks", "interface Row { a: number }\nexport const L: Row[] = [{ a: 1, z: 2 }];", loop, "FV0204 `Row` has no field `z`"],
    ["`null` in a list of strings", 'export const L = ["a", null];', '<p v-for="r in L">{{ r }}</p>', "FV0209 a constant list of strings, numbers or booleans holds no `null`"],
    ["a list of strings and numbers", 'export const L = ["a", 1];', '<p v-for="r in L">{{ r }}</p>', "FV0210 a constant list holds strings, numbers or booleans, all of one type"],
    ["a list of numbers and strings", 'export const L = [1, "a"];', '<p v-for="r in L">{{ r }}</p>', "FV0210 a constant list holds strings, numbers or booleans, all of one type"],
    ["a list of booleans and strings", 'export const L = [true, "a"];', '<p v-for="r in L">{{ r }}</p>', "FV0210 a constant list holds strings, numbers or booleans, all of one type"],
    ["a list of numbers and objects", "export const L = [1, { a: 1 }];", '<p v-for="r in L">{{ r }}</p>', "FV0211 a constant list holds plain values of one kind, or objects"],
    ["a list of objects and numbers", "export const L = [{ a: 1 }, 1];", '<p v-for="r in L">{{ r }}</p>', "FV0211 a constant list holds plain values of one kind, or objects"],
    ["a list of lists", "export const L = [[1], [2]];", '<p v-for="r in L">{{ r }}</p>', "FV0211 a constant list holds plain values of one kind, or objects"],
    ["an object's field that is a list", "export const L = [{ a: [1] }];", loop, "FV0216 `a` in a constant list's objects is a string, a number or a boolean"],
    ["an object's later field that is an object", "export const L = [{ a: 1 }, { a: { b: 1 } }];", loop, "FV0216 `a` in a constant list's objects is a string, a number or a boolean"],
    ["a field that is only `null`", "export const L = [{ a: null }];", loop, "FV0217 `a` in a constant list's objects is only ever `null`: declare the list with an interface that gives its type"],
    [
      "a field `null` in one object and absent in another",
      "export const L = [{ a: 1, b: null }, { a: 2 }, { a: 3, b: 4 }];",
      loop,
      "FV0218 `b` in a constant list's objects is `null` in some and absent in others: its Rust type is an `Option`, whose `None` cannot be both, as `=== null` and the props sent to the client would need; write `null` in each",
    ],
    ["a field of numbers and strings", 'export const L = [{ a: 1 }, { a: "x" }];', loop, "FV0219 `a` in a constant list's objects holds values of different types"],
    ["a field of strings and numbers", 'export const L = [{ a: "x" }, { a: 1 }];', loop, "FV0219 `a` in a constant list's objects holds values of different types"],
    ["a field of booleans and numbers", "export const L = [{ a: true }, { a: 1 }];", loop, "FV0219 `a` in a constant list's objects holds values of different types"],
  ];

  for (const [what, ts, template, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(imported("L", ts, template)).toEqual([message]);
    });
  }

  it("refuses two lists whose struct or Rust name is the same", () => {
    const two = (c: string, d: string, a = "ROWS", b = "ROWS") =>
      refusals(`import { ${a} } from "./c";\nimport { ${b} as R2 } from "./d";`, `<p v-for="r in ${a}">{{ r.a }}</p><p v-for="r in R2">{{ r.a }}</p>`, { "c.ts": c, "d.ts": d });
    expect(two("export const ROWS = [{ a: 1 }];", "export const ROWS = [{ a: 2 }];")).toEqual(["FV0220 `RowsItem`, the type of this list's objects, is declared by components/c.ts too"]);
    expect(two("export interface Row { a: number }\nexport const ROWS: Row[] = [{ a: 1 }];", 'import type { Row } from "./c";\nexport const ROWS: Row[] = [{ a: 2 }];')).toEqual([
      "FV0212 a constant list called `ROWS` in Rust comes from components/c.ts too; rename one",
    ]);
    expect(two("export interface Row { a: number }\nexport const myRows: Row[] = [{ a: 1 }];", 'import type { Row } from "./c";\nexport const MY_ROWS: Row[] = [{ a: 2 }];', "myRows", "MY_ROWS")).toEqual([
      "FV0212 a constant list called `MY_ROWS` in Rust comes from components/c.ts too; rename one",
    ]);
  });
});

describe("constant `Map`s", () => {
  const M = 'const M = new Map<string | number, string>([["a", "A"], ["b", "B"], [1, "one"], [2, "two"]]);';

  it("reads a key known when compiling, and tests one", () => {
    expect(render(M, '<p>{{ M.get("a") }}|{{ M.get(1) }}|{{ M.get("z") }}|{{ M.get(9) }}|{{ M.has("a") }}|{{ M.has("z") }}|{{ M.has(2) }}|{{ M.get("a" + "") }}|{{ M.get(1 + 1) }}|{{ M.has(`b`) }}</p>')).toMatch(like(
      'out.push_str("<p>A|one|||true|false|true|A|two|true</p>");',
    ));
    expect(render(`defineProps<{ s: string }>();\nconst N = new Map([[1, "x"]]);`, "<p>{{ N.get(s) }}|{{ N.has(s) }}</p>")).toMatch(like('out.push_str("<p>|false</p>");'));
  });

  it("matches a key of a union of literals, a string and an integer", () => {
    const out = render(`defineProps<{ k: "a" | "z"; j: "a" | "b"; n: 1 | 3; s: string; i: number }>();\n${M}`, "<p>{{ M.get(k) }}|{{ M.get(j) }}|{{ M.has(k) }}|{{ M.has(j) }}|{{ M.get(n) }}|{{ M.get(s) }}|{{ M.has(s) }}|{{ M.get(i) }}|{{ M.has(i) }}|{{ M.get(String(1)) }}</p>");
    expect(out).toMatch(like('if let Some(v) = match props.k { XK::A => Some("A"), XK::Z => None } {'));
    expect(out).toMatch(like('fv::core::escape_into(out, match props.j { XJ::A => "A", XJ::B => "B" });'));
    expect(out).toMatch(like('out.push_str(if matches!(props.k, XK::A) { "true" } else { "false" });\n    out.push_str("|true|");'));
    expect(out).toMatch(like('if let Some(v) = match props.n { 1 => Some("one"), _ => None } {'));
    expect(out).toMatch(like('if let Some(v) = match &*props.s { "a" => Some("A"), "b" => Some("B"), _ => None } {'));
    expect(out).toMatch(like('out.push_str(if matches!(&*props.s, "a" | "b") { "true" } else { "false" });'));
    expect(out).toMatch(like('if let Some(v) = match props.i { 1 => Some("one"), 2 => Some("two"), _ => None } {'));
    expect(out).toMatch(like('out.push_str(if matches!(props.i, 1 | 2) { "true" } else { "false" });'));
    expect(out).toMatch(like('if let Some(v) = match &*fv::core::Js(1i64).to_string() { "a" => Some("A"), "b" => Some("B"), _ => None } {'));
  });

  it("maps `-0` to the key 0", () => {
    expect(render('defineProps<{ n: number }>();\nconst M = new Map([[-0, "z"], [1, "o"]]);', "<p>{{ M.get(0) }} {{ M.get(n) }}</p>")).toMatch(like('match props.n { 0 => Some("z"), 1 => Some("o"), _ => None }'));
  });

  it("refuses a method other than `get` and `has`, and a call of other than one key", () => {
    const of = (call: string, props = "") => refusals(`${props}${M}`, `<p>{{ ${call} }}</p>`);
    const reads = (method: string) => [`FV0227 \`M.${method}()\` of a constant \`Map\`, which the server reads with \`.get(key)\` and \`.has(key)\``];
    expect(of("M.keys()")).toEqual(reads("keys"));
    expect(of("M.has('a', 1)")).toEqual(reads("has"));
    expect(of('M.get("a", 1)')).toEqual(reads("get"));
    expect(of("M.get()")).toEqual(reads("get"));
    expect(of("M.get(...xs)", "defineProps<{ xs: string[] }>();\n")).toEqual(reads("get"));
    expect(of("M.get(b)", "defineProps<{ b: boolean }>();\n")).toEqual(["FV0227 `M.get()` by a boolean: a constant `Map` is read by a string or an integer that is present"]);
    expect(of("M.has(f / 2)", "defineProps<{ f: number }>();\n")).toEqual(["FV0227 `M.has()` by a number: a constant `Map` is read by a string or an integer that is present"]);
  });
});

describe("constant objects", () => {
  const O = 'const O = { a: 1, b: 2, 3: 4, "-1": 5, "01": 6 };';

  it("tests its own keys with `Object.hasOwn()`", () => {
    const out = render(`defineProps<{ s: string; n: number; k: "a" | "z" }>();\n${O}`, "<p>{{ Object.hasOwn(O, s) }}|{{ Object.hasOwn(O, n) }}|{{ Object.hasOwn(O, k) }}|{{ Object.hasOwn(O, 'a') }}|{{ Object.hasOwn(O, 3) }}|{{ Object.hasOwn(O, 'q') }}</p>");
    expect(out).toMatch(like('out.push_str(if matches!(&*props.s, "3" | "a" | "b" | "-1" | "01") { "true" } else { "false" });'));
    expect(out).toMatch(like('out.push_str(if matches!(props.n, 3 | -1) { "true" } else { "false" });'));
    expect(out).toMatch(like('out.push_str(if matches!(props.k, XK::A) { "true" } else { "false" });'));
    expect(out).toMatch(like('out.push_str("|true|true|false</p>");'));
    expect(render('defineProps<{ n: number }>();\nconst O = { "9007199254740993": 1, "2x": 3, 2: 2 };', "<p>{{ Object.hasOwn(O, n) }}</p>")).toMatch(like('out.push_str(if matches!(props.n, 2) { "true" } else { "false" });'));
  });

  it("refuses `Object.hasOwn()` by a key that is neither a string nor an integer", () => {
    expect(refusals(`defineProps<{ b: boolean }>();\n${O}`, "<p>{{ Object.hasOwn(O, b) }}</p>")).toEqual([
      "FV0814 `Object.hasOwn()` of the constant object `O` by a key that is a boolean: it takes a string or an integer that is present",
    ]);
  });

  it("reads a field by a key known when compiling", () => {
    const out = render(
      'import { computed } from "vue";\nconst props = defineProps<{ k: "a" | "b"; s: "a" | "b" }>();\nconst K = "a";\nconst O = { a: { x: "ax" }, b: { x: "bx" }, 2: { x: "two" } };\nconst c = computed(() => O[props.k].x);',
      "<p>{{ c }}|{{ O.a.x }}|{{ O['b'].x }}|{{ O[2].x }}|{{ O[`a`].x }}|{{ O[K].x }}|{{ O[`${s}`].x }}</p>",
    );
    expect(out).toMatch(like('let s_c = match props.k { XK::A => "ax", XK::B => "bx" };'));
    expect(out).toMatch(like('out.push_str("|ax|bx|two|ax|ax|");'));
    expect(out).toMatch(like('fv::core::escape_into(out, match props.s { XS::A => "ax", XS::B => "bx" });'));
  });

  it("reads a field by a key a `.ts` file's constant holds", () => {
    expect(render('import { K, N } from "./c";\nconst O = { a: { x: "ax" }, 2: { x: "two" } };', "<p>{{ O[K].x }}|{{ O[N].x }}</p>", { "c.ts": 'export const K = "a";\nexport const N = 2;' })).toMatch(like('out.push_str("<p>ax|two</p>");'));
    expect(refusals('import { B } from "./c";\nconst O = { true: { x: "ax" } };', "<p>{{ O[B].x }}</p>", { "c.ts": "export const B = true;" })).toEqual([
      'FV0222 `O` read by a key that is a boolean: type the key as a union of string literals, as `"sm" | "md" | "lg"`, or an `enum` of them',
    ]);
  });

  it("refuses `Object.hasOwn()` of a constant `Map`", () => {
    expect(refusals('defineProps<{ s: string }>();\nconst M = new Map([["a", 1]]);', "<p>{{ Object.hasOwn(M, s) }}</p>")).toEqual(["FV0227 `M` is a constant `Map`, which the server reads with `.get(key)` and `.has(key)`"]);
  });

  it("leaves a name a `v-for` or setup binds over a constant", () => {
    expect(render('const O = { a: 1 };', '<p v-for="O in [1, 2]">{{ O }}</p>')).toMatch(like("fv::core::push_int(out, o);"));
    expect(render('import { ref } from "vue";\nconst O = ref(1);', "<p>{{ O }}</p>")).toMatch(like("fv::core::push_int(out, s_o);"));
  });

  const refused: [string, string, string, string][] = [
    ["a key that is a string", 'defineProps<{ s: string }>();\nconst O = { a: "A" };', "<p>{{ O[s] }}</p>", "FV0222 `O` read by a key that is a `string`, which may name a field every object has, as `toString` or `constructor`: type the key as a union of string literals, as `\"sm\" | \"md\" | \"lg\"`, or an `enum` of them"],
    ["a key that is a number", 'defineProps<{ n: number }>();\nconst O = { a: "A" };', "<p>{{ O[n] }}</p>", "FV0222 `O` read by a key that is a `number`: type the key as a union of string literals, as `\"sm\" | \"md\" | \"lg\"`, or an `enum` of them"],
    ["a key that is a fraction", 'defineProps<{ f: number }>();\nconst O = { a: "A" };', "<p>{{ O[f / 2] }}</p>", "FV0222 `O` read by a key that is a number: type the key as a union of string literals, as `\"sm\" | \"md\" | \"lg\"`, or an `enum` of them"],
    ["a key that is a boolean", 'defineProps<{ b: boolean }>();\nconst O = { a: "A" };', "<p>{{ O[b] }}</p>", "FV0222 `O` read by a key that is a boolean: type the key as a union of string literals, as `\"sm\" | \"md\" | \"lg\"`, or an `enum` of them"],
    ["a key that may be absent", 'defineProps<{ k?: "a" | "b" }>();\nconst O = { a: "A" };', "<p>{{ O[k] }}</p>", "FV0223 `O` read by a key that may be absent, where JavaScript reads the field `undefined`: narrow the key with `v-if` first, or give it a default"],
    ["a field of a value that may be `undefined`", 'defineProps<{ k: "a" | "c" }>();\nconst T = { a: { x: { y: "Y" } } };', "<p>{{ T[k].x }}</p>", "FV0224 `T[k]` may be `undefined`, as it is for the key `c`, and reading `.x` of it fails: read it with `?.x`"],
    ["a field of a value read by a prop of `props`", 'const props = defineProps<{ k: "a" | "b" }>();\nconst T = { a: { x: 1 } };', "<p>{{ T[props.k].x }}</p>", "FV0224 `T[k]` may be `undefined`, as it is for the key `b`, and reading `.x` of it fails: read it with `?.x`"],
    ["a field of a value read by a `computed`", 'import { computed } from "vue";\nconst props = defineProps<{ k: "a" | "b" }>();\nconst key = computed(() => props.k);\nconst T = { a: { x: 1 } };', "<p>{{ T[key].x }}</p>", "FV0224 `T[key]` may be `undefined`, as it is for the key `b`, and reading `.x` of it fails: read it with `?.x`"],
    ["a field of a value read by a key with no path", 'defineProps<{ k: "a" | "b" }>();\nconst T = { a: { x: 1 } };', "<p>{{ T[k === 'a' ? 'a' : 'b'].x }}</p>", "FV0224 `T[…]` may be `undefined`, as it is for the key `b`, and reading `.x` of it fails: read it with `?.x`"],
    ["a field of a value two keys deep that may be `undefined`", 'defineProps<{ k: "a" | "b"; j: "x" | "y" }>();\nconst T = { a: { x: { z: 1 }, y: { z: 2 } }, b: { x: { z: 3 } } };', "<p>{{ T[k][j].z }}</p>", "FV0224 `T[k][j]` may be `undefined`, as it is for the key `y`, `b`, and reading `.z` of it fails: read it with `?.z`"],
    ["a field of `Object.prototype`", 'defineProps<{ k: "a" | "c" }>();\nconst T = { a: { x: 1 }, c: { y: 2 } };', "<p>{{ T[k].toString }}</p>", "FV0226 `T[k]` has no field `toString` for the key `a`, where JavaScript reads `Object.prototype.toString`, which the server does not have: add the key to the object"],
    ["a field it lacks", 'const T = { a: "A", c: "C" };', "<p>{{ T.z }}</p>", "FV0204 `T` has no field `z`"],
    ["a field it lacks, by a computed key", 'const T = { a: "A", c: "C" };', "<p>{{ T['z'] }}</p>", "FV0204 `T` has no field `z`"],
    ["a field of a string field", 'const T = { a: { b: "A" } };', "<p>{{ T.a.b.c }}</p>", "FV0604 `.c` of a string, which has no field `c`"],
    ["an object read whole by a key", 'defineProps<{ k: "a" | "b" }>();\nconst T = { a: { x: 1 }, b: { x: 2 } };', "<p>{{ T[k] }}</p>", "FV0208 `T[k]` is an object, read one field at a time: `T[k].x`"],
    ["an object field read whole", "const T = { a: { x: 1 } };", "<p>{{ T.a }}</p>", "FV0208 `T.a` is an object, read one field at a time: `T.a.x`"],
    ["an object field read whole by a computed key", "const T = { a: { x: 1 } };", "<p>{{ T['a'] }}</p>", 'FV0208 `T["a"]` is an object, read one field at a time: `T["a"].x`'],
    ["an object a `Map` holds read whole", 'defineProps<{ s: string }>();\nconst M = new Map([["a", { x: 1 }]]);', "<p>{{ M.get(s) }}</p>", "FV0208 `M.get(…)` is an object, read one field at a time: `M.get(…).x`"],
    ["a field of a value that is an object for one key and a string for another", 'defineProps<{ k: "a" | "b" }>();\nconst T = { a: { x: 1 }, b: "B" };', "<p>{{ T[k].x }}</p>", "FV0208 `T[k]` is an object, read one field at a time: `T[k].x`"],
    ["a field of a value `undefined` for every key", 'defineProps<{ k: "a" | "b" }>();\nconst T = { c: { x: 1 } };', "<p>{{ T[k].x }}</p>", "FV0604 `.x` of `undefined`, which may be absent: narrow it with `v-if` first, or read it with `?.x`"],
    ["a field read after `?.` of a field a key lacks", 'defineProps<{ k: "a" | "c" }>();\nconst T = { a: { x: { y: 1 } }, c: { z: 1 } };', "<p>{{ T[k]?.x.y }}</p>", "FV0224 `T[k].x` may be `undefined`, as it is for the key `c`, and reading `.y` of it fails: read it with `?.y`"],
    ["a field read outside the parentheses that end a `?.` chain", 'defineProps<{ k: "a" | "c" }>();\nconst T = { a: { x: { y: 1 } } };', "<p>{{ (T[k]?.x).y }}</p>", "FV0224 `T[k].x` may be `undefined`, as it is for the key `c`, and reading `.y` of it fails: read it with `?.y`"],
    ["values that are `null` and `undefined` by key", 'defineProps<{ k: "a" | "b" }>();\nconst T = { a: null };', "<p>{{ T[k] }}</p>", "FV0225 `T[k]` is `null` for some keys and `undefined` for others"],
    ["values of two kinds by key", 'defineProps<{ k: "a" | "b" }>();\nconst T = { a: "A", b: 1 };', "<p>{{ T[k] }}</p>", "FV0225 `T[k]` is a string for some keys and a number for others, where a value read by a key known only when rendering is a string, a number, a boolean or a list of them, of one type for every key"],
    ["lists of two kinds by key", 'defineProps<{ k: "a" | "b" }>();\nconst T = { a: ["x"], b: [2] };', '<i v-for="v in T[k]">{{ v }}</i>', "FV0225 `T[k]` is a list, where a value read by a key known only when rendering is a string, a number, a boolean or a list of them, of one type for every key"],
    ["lists of integers and fractions by key", 'defineProps<{ k: "a" | "b" }>();\nconst T = { a: [1], b: [2.5] };', '<i v-for="v in T[k]">{{ v }}</i>', "FV0225 `T[k]` is a list, where a value read by a key known only when rendering is a string, a number, a boolean or a list of them, of one type for every key"],
  ];

  for (const [what, script, template, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(refusals(script, template)).toEqual([message]);
    });
  }
});

describe("constants read by a key known only when rendering", () => {
  const read = (props: string, table: string, template: string) => render(`defineProps<{ ${props} }>();\nconst T = ${table};`, template);

  it("reads `undefined` for the keys it lacks, through `?.`", () => {
    expect(read('k: "a" | "c"', '{ a: { x: { y: "Y" } } }', "<p>{{ T[k]?.x.y }}|{{ T[k]?.x?.y }}</p>")).toMatch(like(
      'if let Some(v) = match props.k { XK::A => Some("Y"), XK::C => None } {\n        fv::core::escape_into(out, v);\n    }\n    out.push(\'|\');\n    if let Some(v) = match props.k { XK::A => Some("Y"), XK::C => None } {',
    ));
    expect(read('k: "a" | "c"', "{ a: { x: 1 }, c: { y: 2 } }", "<p>{{ T[k].x }}</p>")).toMatch(like("if let Some(v) = match props.k { XK::A => Some(1i64), XK::C => None } {"));
  });

  it("tests whether the value is an object, for the keys that have one", () => {
    expect(read('k: "a" | "b" | "c"', '{ a: { x: "1" }, c: { x: "2" } }', '<p v-if="T[k]">x</p>')).toMatch(like("if !matches!(props.k, XK::B) {"));
    expect(read('k: "b" | "a"', '{ a: { x: "1" } }', '<p v-if="T[k]">x</p>')).toMatch(like("if !matches!(props.k, XK::B) {"));
    expect(read('k: "a" | "b"', '{ a: { x: "1" } }', '<p v-if="T[k]">x</p>')).toMatch(like("if matches!(props.k, XK::A) {"));
    expect(read('k: "a" | "c"', '{ a: { x: "1" }, c: { x: "2" } }', '<p v-if="T[k]">{{ T[k].x }}</p>')).toMatch(like(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::render::Refused> {
    out.reserve(7 + 1);
    out.push_str("<p>");
    fv::core::escape_into(out, match props.k { XK::A => "1", XK::C => "2" });
    out.push_str("</p>");
    Ok(())
}
`, true));
    expect(read('k: "b" | "d"', '{ a: { x: "1" }, c: { x: "2" } }', '<p v-if="T[k]">x</p>')).toMatch(like('out.push_str("<!---->");'));
    expect(read('k: "b" | "a"', '{ a: "1" }', '<p v-if="T[k]">x</p>')).toMatch(like('if (match props.k { XK::B => None, XK::A => Some("1") }).is_some() {'));
  });

  it("writes a table of booleans as a test of the keys", () => {
    expect(read('k: "a" | "b" | "c"', "{ a: true, b: false, c: true }", '<p>{{ T[k] }}</p>')).toMatch(like('out.push_str(if !matches!(props.k, XK::B) { "true" } else { "false" });'));
    expect(read('k: "a" | "b" | "c"', "{ a: true, b: false, c: false }", '<p v-if="T[k]">x</p>')).toMatch(like("if matches!(props.k, XK::A) {"));
    expect(read('k: "a" | "b"', "{ a: true, b: true }", '<p v-if="T[k]">x</p>')).toMatch(like("if true {"));
  });

  it("reads lists by key as slices", () => {
    const loop = '<i v-for="v in T[k]">{{ v }}</i>';
    expect(read('k: "a" | "b"', '{ a: ["x"], b: ["y", "z"] }', loop)).toMatch(like('for v_ref in (match props.k { XK::A => &["x"][..], XK::B => &["y", "z"][..] }).iter() {'));
    expect(read('k: "a" | "b"', '{ a: [], b: ["y", "z"] }', loop)).toMatch(like('for v_ref in (match props.k { XK::A => &[][..], XK::B => &["y", "z"][..] }).iter() {'));
    expect(read('k: "a" | "b"', '{ a: ["y"], b: [] }', loop)).toMatch(like('for v_ref in (match props.k { XK::A => &["y"][..], XK::B => &[][..] }).iter() {'));
    expect(read('k: "a" | "b"', '{ a: ["y"] }', '<i v-for="v in T[k] ?? []">{{ v }}</i>')).toMatch(like('for v_ref in (match props.k { XK::A => Some(&["y"][..]), XK::B => None }).map(|v| &v[..]).unwrap_or(&[]).iter() {'));
    expect(read('k: "a" | "b" | "c"', '{ a: ["x"], b: [] }', '<i v-for="v in T[k] ?? []">{{ v }}</i>')).toMatch(like(
      'for v_ref in (match props.k { XK::A => Some(&["x"][..]), XK::B => Some(&[][..]), XK::C => None }).map(|v| &v[..]).unwrap_or(&[]).iter() {',
    ));
    expect(read('k: "a" | "b"', '{ a: ["y"], b: ["y"] }', '<b>{{ T[k].length }}</b>')).toMatch(like('fv::core::push_int(out, (&["y"][..]).len() as i64);'));
    expect(read('k: "a" | "b"', "{ a: [], b: [2] }", "<i>{{ T[k].length }}</i>")).toMatch(like("fv::core::push_int(out, (match props.k { XK::A => &[][..], XK::B => &[2i64][..] }).len() as i64);"));
  });

  it("reads numbers by key as floats where one is a fraction", () => {
    expect(read('k: "a" | "b" | "c"', "{ a: 1, b: 2.5, c: 1 }", "<p>{{ T[k] }}</p>")).toMatch(like("fv::core::push_number(out, match props.k { XK::B => 2.5f64, XK::A | XK::C => 1.0f64 });"));
    expect(read('k: "a" | "b" | "c"', "{ a: 1, b: 2.5 }", "<p>{{ T[k] }}</p>")).toMatch(like("if let Some(v) = match props.k { XK::A => Some(1.0f64), XK::B => Some(2.5f64), XK::C => None } {"));
    expect(read('k: "a" | "b" | "c"', "{ a: 1, b: 2 }", "<p>{{ T[k] ?? 0 }}</p>")).toMatch(like("fv::core::push_int(out, (match props.k { XK::A => Some(1i64), XK::B => Some(2i64), XK::C => None }).unwrap_or(0i64));"));
    expect(read('k: "a" | "b"; j: "x" | "y"', "{ a: { x: 1.5, y: 1 }, b: { x: 2.5 } }", "<p>{{ T[k][j] ?? 0 }}</p>")).toMatch(like(
      "fv::core::push_number(out, (match props.j { XJ::X => Some(match props.k { XK::A => 1.5f64, XK::B => 2.5f64 }), XJ::Y => (match props.k { XK::A => Some(1i64), XK::B => None }).map(|v| v as f64) }).unwrap_or(0.0f64));",
    ));
    expect(read('k: "a" | "b"; j: "x" | "y"', "{ a: { x: 1.5, y: 1 }, b: { x: 2.5, y: 3.5 } }", "<p>{{ T[k][j] }}</p>")).toMatch(like(
      "fv::core::push_number(out, match props.j { XJ::X => match props.k { XK::A => 1.5f64, XK::B => 2.5f64 }, XJ::Y => match props.k { XK::A => 1.0f64, XK::B => 3.5f64 } });",
    ));
  });

  it("writes nothing for a value `null` or absent for every key", () => {
    expect(read('k: "a" | "b"', "{ a: null, b: null }", "<p>{{ T[k] }}</p>")).toMatch(like('out.push_str("<p></p>");'));
    expect(read('k: "a" | "b"', "{ c: 1 }", "<p>{{ T[k] }}</p>")).toMatch(like('out.push_str("<p></p>");'));
    expect(read('k: "a" | "b" | "c"', '{ a: null, b: "B" }', "<p>{{ T[k] }}</p>")).toMatch(like('if let Some(v) = match props.k { XK::B => Some("B"), XK::A | XK::C => None } {'));
  });
});

describe("constants checked a second time", () => {
  it("reads an empty `Map`", () => {
    expect(render("const M = new Map();", "<p>{{ M.has(1) }}|{{ M.get('a') }}</p>")).toMatch(like('out.push_str("<p>false|</p>");'));
  });

  it("refuses a hole in a `Map`'s entries where the hole is", () => {
    const e = (() => {
      try {
        compiled('import { M } from "./c";', "<p>{{ M.get(1) }}</p>", { "c.ts": "export const M = new Map([\n  ,\n  [1, 2],\n]);" });
      } catch (error) {
        return (error as GenErrors).errors[0] as GenError;
      }
      throw new Error("compiled without an error");
    })();
    expect(e.at).toMatchObject({ file: "components/c.ts", line: 1, column: 26 });
  });

  it("gives a child's prop of a union of literals the literal a constant holds", () => {
    const child = (props: string) => sfc(`defineProps<{ ${props} }>();`, "<p>{{ v }}</p>");
    expect(render('import { K } from "./c";\nimport Y from "./Y.vue";', '<Y :v="K" />', { "c.ts": 'export const K = "a";', "Y.vue": child('v: "a" | "b"') })).toMatch(like("super::y::Props { v: super::y::YV::A }"));
    expect(render('import { ONE } from "./c";\nimport Y from "./Y.vue";', '<Y :v="ONE" />', { "c.ts": "export const ONE = 1;", "Y.vue": child("v: 1 | 2") })).toMatch(like("super::y::Props { v: 1i64 }"));
  });

  it("refuses a string for a `Float` field, and two lists of one file with one Rust name", () => {
    expect(imported("L", 'import type { Float } from "ferrovue/types";\ninterface Row { f: Float }\nexport const L: Row[] = [{ f: "x" }];', '<p v-for="r in L">{{ r.f }}</p>')).toEqual(["FV0215 `f` in a constant list's object is a number"]);
    expect(imported("theme, theme_darkMode", "export const theme = { darkMode: [{ a: 1 }] };\nexport const theme_darkMode = [{ b: 2 }];", '<p v-for="r in theme.darkMode">{{ r.a }}</p><p v-for="r in theme_darkMode">{{ r.b }}</p>')).toEqual([
      "FV0212 a constant list called `THEME_DARK_MODE` in Rust comes from components/c.ts too; rename one",
    ]);
  });

  it("tests a key of more than one digit, and refuses a `Map` method other than `get` and `has` of one argument", () => {
    expect(render("defineProps<{ n: number }>();\nconst O = { 12: 1, a: 2 };", "<p>{{ Object.hasOwn(O, n) }}</p>")).toMatch(like('out.push_str(if matches!(props.n, 12) { "true" } else { "false" });'));
    expect(refusals("const M = new Map([['a', 1]]);", "<p>{{ M.keys(1) }}</p>")).toEqual(["FV0227 `M.keys()` of a constant `Map`, which the server reads with `.get(key)` and `.has(key)`"]);
  });

  it("names a key the compiler knows from a value that is no literal", () => {
    expect(refusals("defineProps<{ on: boolean }>();\nconst T = { ab: { x: 1 } };", '<p>{{ T[on ? "ab" : "ab"] }}</p>')).toEqual(['FV0208 `T["ab"]` is an object, read one field at a time: `T["ab"].x`']);
    expect(refusals("defineProps<{ on: boolean }>();\nconst T = { 2: { x: 1 } };", "<p>{{ T[on ? 2 : 2] }}</p>")).toEqual(['FV0208 `T["2"]` is an object, read one field at a time: `T["2"].x`']);
    expect(refusals("defineProps<{ on: boolean }>();\nconst T = { ab: { x: 1 } };", '<p>{{ T[on ? "z" : "z"].x }}</p>')).toEqual(["FV0204 `T` has no field `z`"]);
    expect(render("defineProps<{ on: boolean }>();\nconst M = new Map([['ab', 1], [2, 3]]);", '<p>{{ M.get(on ? "ab" : "ab") }}|{{ M.get(on ? 2 : 2) }}</p>')).toMatch(like("fv::core::push_int(out, 1i64);\n    out.push('|');\n    fv::core::push_int(out, 3i64);"));
  });

  it("writes booleans by key that are no literal, and groups the keys of each literal", () => {
    expect(render('defineProps<{ k: "a" | "b"; j: "x" | "y" }>();\nconst T = { a: { x: true, y: false }, b: { x: true, y: true } };', "<p>{{ T[k][j] }}</p>")).toMatch(like(
      'out.push_str(if match props.j { XJ::X => true, XJ::Y => !matches!(props.k, XK::A) } { "true" } else { "false" });',
    ));
    expect(render('defineProps<{ k: "a" | "b" | "c" }>();\nconst T = { a: false, b: true, c: false };', '<p v-if="T[k]">x</p>')).toMatch(like("if matches!(props.k, XK::B) {"));
  });

  it("refuses a list by one key and a string by another", () => {
    const kinds = (a: string, b: string) => `FV0225 \`T[k]\` is ${a} for some keys and ${b} for others, where a value read by a key known only when rendering is a string, a number, a boolean or a list of them, of one type for every key`;
    expect(refusals('defineProps<{ k: "a" | "b" }>();\nconst T = { a: ["x"], b: "y" };', "<p>{{ T[k] }}</p>")).toEqual([kinds("a list", "a string")]);
    expect(refusals('defineProps<{ k: "a" | "b" }>();\nconst T = { a: "y", b: ["x"] };', "<p>{{ T[k] }}</p>")).toEqual([kinds("a string", "a list")]);
  });

  it("keeps a float that may be absent as it is", () => {
    expect(render('defineProps<{ k: "a" | "b"; j: "x" | "y" }>();\nconst T = { a: { x: 1.5 }, b: { x: 2.5, y: 3.5 } };', "<p>{{ T[k][j] ?? 0 }}</p>")).toMatch(like(
      "fv::core::push_number(out, (match props.j { XJ::X => Some(match props.k { XK::A => 1.5f64, XK::B => 2.5f64 }), XJ::Y => match props.k { XK::A => None, XK::B => Some(3.5f64) } }).unwrap_or(0.0f64));",
    ));
  });
});

describe("lists read by a key as slices", () => {
  it("chooses between a list read by key and another list as slices", () => {
    const read = (table: string) => render(`defineProps<{ k: "a" | "b"; on: boolean; l: string[] }>();\nconst T = ${table};`, '<i v-for="v in on ? T[k] : l">{{ v }}</i>');
    expect(read('{ a: ["x"], b: ["y", "z"] }')).toMatch(like('for v_ref in (if props.on { match props.k { XK::A => &["x"][..], XK::B => &["y", "z"][..] } } else { &props.l[..] }).iter() {'));
    expect(read('{ a: ["x"], b: ["x"] }')).toMatch(like('for v_ref in (if props.on { &["x"][..] } else { &props.l[..] }).iter() {'));
  });
});

describe("constants read by keys that hold markup-breaking characters", () => {
  const O = "const O = { \"1.5\": \"x\", 'a\"b': { x: 1 } };";
  const whole = 'FV0208 `O["a\\"b"]` is an object, read one field at a time: `O["a\\"b"].x`';

  it("reads a field by a fraction literal, and by a constant of a `.ts` file that holds one", () => {
    expect(render(O, "<p>{{ O[1.5] }}</p>")).toMatch(like('out.push_str("<p>x</p>");'));
    expect(render(`import { F } from "./c";\n${O}`, "<p>{{ O[F] }}</p>", { "c.ts": "export const F = 1.5;" })).toMatch(like('out.push_str("<p>x</p>");'));
  });

  it("names a field by a string literal, a template literal or a `.ts` file's constant with a quote", () => {
    expect(refusals(O, "<p>{{ O['a\"b'] }}</p>")).toEqual([whole]);
    expect(refusals(O, '<p>{{ O[`a"b`] }}</p>')).toEqual([whole]);
    expect(refusals(`import { K } from "./c";\n${O}`, "<p>{{ O[K] }}</p>", { "c.ts": "export const K = 'a\"b';" })).toEqual([whole]);
  });

  it("reads a `Map` by a `.ts` file's constant with a quote", () => {
    expect(render("import { K } from \"./c\";\nconst M = new Map([['a\"b', 1], ['c', 2]]);", "<p>{{ M.get(K) }}|{{ M.has(K) }}</p>", { "c.ts": "export const K = 'a\"b';" })).toMatch(like(
      "fv::core::push_int(out, 1i64);\n    out.push_str(\"|true</p>\");",
    ));
  });
});

describe("constants read by a key known only when rendering, further", () => {
  it("names the key by the path of a `v-for` binding whose name holds `_ctx`", () => {
    expect(refusals("interface Row { k: \"a\" | \"b\" }\ndefineProps<{ rows: Row[] }>();\nconst T = { a: { x: 1 } };", '<p v-for="my_ctx in rows">{{ T[my_ctx.k].x }}</p>')).toEqual([
      "FV0224 `T[my_ctx.k]` may be `undefined`, as it is for the key `b`, and reading `.x` of it fails: read it with `?.x`",
    ]);
  });

  it("refuses an object read whole after `?.[key]` or by two keys in `v-if`", () => {
    expect(refusals('defineProps<{ k: "a" | "b" }>();\nconst T = { a: { x: 1 } };', '<p v-if="T?.[k]">x</p>')).toEqual(["FV0208 `T[k]` is an object, read one field at a time: `T[k].x`"]);
    expect(refusals('defineProps<{ k: "a" | "b"; j: "x" | "y" }>();\nconst T = { a: { x: { z: 1 }, y: { z: 1 } }, b: { x: { z: 1 } } };', '<p v-if="T[k][j]">x</p>')).toEqual([
      "FV0208 `T[k][j]` is an object, read one field at a time: `T[k][j].z`",
    ]);
  });

  it("tests a value `undefined` for every key as absent", () => {
    expect(render('defineProps<{ k: "b" | "d" }>();\nconst T = { a: { x: "1" } };', "<p>{{ !T[k] }}</p>")).toMatch(like('out.push_str("<p>true</p>");'));
    expect(refusals('defineProps<{ k: "a" | "b"; on: boolean }>();\nconst T = { c: { x: "X" } };', '<p v-if="on && T[k]">{{ T[k].x }}</p>')).toEqual([
      "FV0604 `.x` of `undefined`, which may be absent: narrow it with `v-if` first, or read it with `?.x`",
    ]);
  });

  it("reads lists by two keys as slices", () => {
    expect(render('defineProps<{ k: "a" | "b"; j: "x" | "y" }>();\nconst T = { a: { x: ["1"], y: ["2"] }, b: { x: ["3"], y: ["4"] } };', '<i v-for="v in T[k][j]">{{ v }}</i>')).toMatch(like(
      'for v_ref in (match props.j { XJ::X => match props.k { XK::A => &["1"][..], XK::B => &["3"][..] }, XJ::Y => match props.k { XK::A => &["2"][..], XK::B => &["4"][..] } }).iter() {',
    ));
  });

  it("passes a child `None` for a constant `null`, and for a value `null` for every key", () => {
    const child = { "Y.vue": sfc("defineProps<{ v: string | null }>();", "<p>{{ v }}</p>") };
    expect(render("import Y from \"./Y.vue\";\nconst N = null;", '<Y :v="N" />', child)).toMatch(like("super::y::Props { v: None }"));
    expect(render("import Y from \"./Y.vue\";\ndefineProps<{ k: \"a\" | \"b\" }>();\nconst T = { a: null, b: null };", '<Y :v="T[k]" />', child)).toMatch(like("super::y::Props { v: None }"));
  });
});

describe("constants read by keys the compiler computes", () => {
  it("reads a `Map` and an object by `String()` of a literal", () => {
    expect(render("const M = new Map([['null', 1], ['a\"b', 2]]);\nconst O = { 'a\"b': 'q' };", "<p>{{ M.get(String(null)) }}|{{ M.get(String('a\"b')) }}|{{ O[String('a\"b')] }}</p>")).toMatch(like(
      'fv::core::push_int(out, 1i64);\n    out.push(\'|\');\n    fv::core::push_int(out, 2i64);\n    out.push_str("|q</p>");',
    ));
  });

  it("matches a `Map`'s keys at render time by a string with an escaped quote the compiler builds, and refuses it as an object's key", () => {
    expect(render("const M = new Map([['a\"b', 2], ['b', 3]]);", "<p>{{ M.get(`a\"${'b'}`) }}</p>")).toMatch(like(
      'if let Some(v) = match "a\\"b" { "a\\"b" => Some(2i64), "b" => Some(3i64), _ => None } {',
    ));
    expect(refusals("const O = { 'a\"b': 'q' };", "<p>{{ O[`a\"${'b'}`] }}</p>")).toEqual([
      'FV0222 `O` read by a key that is a `string`, which may name a field every object has, as `toString` or `constructor`: type the key as a union of string literals, as `"sm" | "md" | "lg"`, or an `enum` of them',
    ]);
  });

  it("matches a `Map`'s keys at render time by a `computed` that holds `-0`, and refuses it as an object's key", () => {
    const z = 'import { computed } from "vue";\nconst z = computed(() => -0);\n';
    expect(render(`${z}const M = new Map([[0, "zero"], [1, "one"]]);`, "<p>{{ M.get(z) }}|{{ M.has(z) }}</p>")).toMatch(like(
      'if let Some(v) = match s_z as i64 { 0 => Some("zero"), 1 => Some("one"), _ => None } {\n        fv::core::escape_into(out, v);\n    }\n    out.push(\'|\');\n    out.push_str(if matches!(s_z as i64, 0 | 1) { "true" } else { "false" });',
    ));
    expect(refusals(`${z}const O = { 0: "zero", 1: "one" };`, "<p>{{ O[z] }}</p>")).toEqual(['FV0222 `O` read by a key that is a `number`: type the key as a union of string literals, as `"sm" | "md" | "lg"`, or an `enum` of them']);
  });

  it("takes an integer constant as truthy where it is not 0", () => {
    expect(render('import { ONE } from "./c";\ndefineProps<{ s: string }>();', "<p>{{ ONE && s }}|{{ ONE || s }}</p>", { "c.ts": "export const ONE = 1;" })).toMatch(like(
      'out.push_str("<p>");\n    fv::core::escape_into(out, &props.s);\n    out.push_str("|1</p>");',
    ));
  });
});

describe("enums a component declares", () => {
  it("refuses an enum member that is a `Map` or a constant of another file", () => {
    expect(refusals("enum E { A = new Map(), C = 1 }", "<p>{{ E.C }}</p>")).toEqual(["FV0203 an enum member's value is a string or a number literal (the template reads it as `E` at components/X.vue:4:17)"]);
    expect(refusals('import { B } from "./c";\nenum E { A = B, C = 1 }', "<p>{{ E.C }}</p>", { "c.ts": "export const B = 1;" })).toEqual([`FV0207 ${EVALUATES} (the template reads it as \`E\` at components/X.vue:5:17)`]);
  });
});

describe("lookup keys built when rendering", () => {
  const script = 'defineProps<{ k: "a" | "b"; s: string }>();\nconst HALF = 0.5;\nconst O = { "0.5": "half", A: "big a", B: "big b", xa: "x of a", xb: "x of b", "A!": "shout" };';

  it("reads a key that is a constant `Float` of the component by the string JavaScript writes for it", () => {
    expect(render(script, "<p>{{ O[HALF] }}</p>")).toContain('out.push_str("<p>half</p>");');
  });

  it("reads keys built from a union by `toUpperCase()`, `toLowerCase()` and template literals through a `match` over the union", () => {
    const out = render(script, "<p>{{ O[k.toUpperCase()] }}|{{ O[`x${k.toLowerCase()}`] }}|{{ O[`${k.toUpperCase()}!`] ?? '-' }}</p>");
    expect(out).toContain('match props.k { XK::A => "big a", XK::B => "big b" }');
    expect(out).toContain('match props.k { XK::A => "x of a", XK::B => "x of b" }');
    expect(out).toContain('match props.k { XK::A => Some("shout"), XK::B => None }');
  });

  it("refuses a key built from a string of any value, or from two unions", () => {
    const string = "FV0222 `O` read by a key that is a `string`, which may name a field every object has, as `toString` or `constructor`: type the key as a union of string literals, as `\"sm\" | \"md\" | \"lg\"`, or an `enum` of them";
    expect(refusals(script, "<p>{{ O[s.toUpperCase()] }}</p>")).toEqual([string]);
    expect(refusals(script, "<p>{{ O[`${k}${k}`] }}</p>")).toEqual([string]);
  });
});

describe("modules that export a list of names", () => {
  it("reads a constant of a `.ts` file that also writes `export { … }`", () => {
    expect(render('import { LIMIT } from "./limits";', "<p>{{ LIMIT }}</p>", { "limits.ts": "const OTHER = 1;\nexport { OTHER };\nexport const LIMIT = 3;\n" })).toContain('out.push_str("<p>3</p>");');
  });
});
