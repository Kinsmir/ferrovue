import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GenError, GenErrors } from "../src/errors.ts";
import { oneLine } from "./code.ts";
import { compile, island } from "./project.ts";

describe("a `?:` whose branches differ in type, where it is shown as text", () => {
  const render = (props: string, template: string): string => {
    const out = compile(island(`<script setup lang="ts">\nimport type { Float } from "ferrovue/types";\ndefineProps<{ ${props} }>();\n</script>\n<template>${template}</template>`)).get("x.rs")!;
    return out.slice(out.indexOf("pub fn render"), out.indexOf("/// The component's markup"));
  };

  it("writes each branch as `{{ }}` writes it, a number by JavaScript's rules and an absent one as nothing", () => {
    const out = render("n: number; o?: Float; on: boolean", '<i>{{ n > 0 ? n : "none" }}</i><b>{{ on ? o : "absent" }}</b><s>{{ on ? true : "off" }}</s>');
    expect(out).toContain('    if props.n as f64 > 0.0 {\n        fv::core::push_int(out, props.n);\n    } else {\n        out.push_str("none");\n    }');
    expect(out).toMatch(/if let Some\(v\) = \(if props\.on \{ props\.o\.map\(\|(fv_o)\| Cow::<str>::Owned\(format!\("\{\}", fv::core::Js\(\1\)\)\)\) \} else \{ Some\(Cow::<str>::Borrowed\("absent"\)\) \}\)\.as_deref\(\) \{/);
  });

  it("writes each branch of an attribute's value as text, leaving the attribute out where a branch is absent", () => {
    const out = render("n: number; o?: number", `<div><i :title="n > 0 ? n : 'none'" :aria-label="o === undefined ? 'unset' : o"></i></div>`);
    expect(out).toContain('out.push_str("<div><i title=\\"");');
    expect(out).toMatch(/aria-label=\\""\);\n {4}if let Some\((fv_o)\) = props\.o \{\n {8}fv::core::push_int\(out, \1\);\n {4}\} else \{\n {8}out\.push_str\("unset"\);\n {4}\}/);
  });

  it("writes each branch in a template literal as `String()` does, `null` and `undefined` too", () => {
    const out = render("n: number; on: boolean; tags: string[]; o?: number", "<i>{{ `${on ? n : 'none'}|${on ? tags : n}|${on ? o : false}` }}</i>");
    expect(out).toContain('fv::strings::JsOr(props.o.map(fv::core::Js), "undefined")');
    expect(out).toContain('fv::core::escape_join(out, props.tags.iter().map(|v| Cow::<str>::Borrowed(&**v)), ",");');
  });
});

describe("functions the server calls", () => {
  const project = (source: string, files: Record<string, string>): string => {
    const root = island(source);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "components", name), text);
    return root;
  };
  const caller = (call: string, imports: string) => `<script setup lang="ts">
import { ${imports} } from "./text";
const props = defineProps<{ word: string; n: number }>();
</script>
<template><i>{{ ${call} }}</i></template>`;

  it("inlines a function imported from a .ts file, which may call the file's own functions and read its constants", () => {
    const out = compile(project(caller("shout(word)", "shout"), { "text.ts": `const MARK = "!";
function loud(t: string): string {
  return t.toUpperCase();
}
export function shout(t: string): string {
  const l = loud(t.trim());
  if (l === "") return "-";
  return l + MARK;
}
` })).get("x.rs")!;
    expect(out).toMatch(/fv::strings::js_trim\(&props\.word\)/);
    expect(out).toMatch(/format!\("\{\}!", /);
  });

  it("inlines a function a .ts file exports as its default", () => {
    const out = compile(project(`<script setup lang="ts">
import initial from "./text";
defineProps<{ word: string }>();
</script>
<template><i>{{ initial(word) }}</i></template>`, { "text.ts": "export default function (t: string): string {\n  return t.slice(0, 1).toUpperCase();\n}\n" })).get("x.rs")!;
    expect(out).toMatch(/fv::strings::js_slice\(&props\.word, 0\.0f64, Some\(1\.0f64\)\)/);
  });

  it("refuses an imported function whose body holds a loop, naming the statement", () => {
    const e = (() => {
      try {
        compile(project(caller("sum(n)", "sum"), { "text.ts": "export function sum(k: number): number {\n  let t = 0;\n  while (t < k) t = t + 1;\n  return t;\n}\n" }));
      } catch (err) {
        return err as GenError;
      }
      throw new Error("compiled");
    })();
    expect(e.code).toBe("FV1901");
    expect(e.message).toMatch(/^components\/text\.ts:3:\d+: a function's body may not hold a `while` loop.*\(in `sum\(\)`, called at components\/X\.vue:5:\d+\)/);
    expect(e.readAt).toMatchObject({ file: "components/X.vue", line: 5 });
  });

  it("refuses a const function setup calls above its declaration, and lets a computed or later code call it", () => {
    const refused = (script: string): string | undefined => {
      try {
        compile(island(`<script setup lang="ts">\nimport { computed } from "vue";\nconst props = defineProps<{ n: number }>();\n${script}\n</script>\n<template><i>{{ props.n }}</i></template>`));
      } catch (err) {
        return (err as GenError).code;
      }
      return undefined;
    };
    expect(refused("const label = fmt(props.n);\nconst fmt = (x: number) => `#${x}`;")).toBe("FV1908");
    expect(refused("const label = wrap(props.n);\nfunction wrap(x: number) { return fmt(x); }\nconst fmt = (x: number) => `#${x}`;")).toBe("FV1908");
    expect(refused("const label = computed(() => fmt(props.n));\nconst fmt = (x: number) => `#${x}`;")).toBeUndefined();
    expect(refused("const fmt = (x: number) => `#${x}`;\nconst label = fmt(props.n);")).toBeUndefined();
    expect(refused("const label = wrap(props.n);\nfunction wrap(x: number) { return `#${x}`; }")).toBeUndefined();
  });

  it("leaves a function only an event handler calls client-only, whatever its body holds", () => {
    const out = compile(island(`<script setup lang="ts">
import { ref } from "vue";
const count = ref(0);
function bump() {
  for (let i = 0; i < 3; i++) count.value++;
}
</script>
<template><button @click="bump">{{ count }}</button></template>`)).get("x.rs")!;
    expect(out).toContain('out.push_str("<button>0</button>");');
  });

  it("binds each argument once, in order, and gives a missing one its default", () => {
    const out = compile(island(`<script setup lang="ts">
const props = defineProps<{ word: string; n: number }>();
function pad(t: string, width = 3, fill?: string): string {
  return t.padStart(width, fill ?? ".") + t;
}
</script>
<template><i>{{ pad(word.toUpperCase()) }}</i></template>`)).get("x.rs")!;
    expect(out).toMatch(/let (fv_t) = props\.word\.to_uppercase\(\);.*fv_refusals\.keep\(fv::strings::try_pad_start\(&\1, 3\.0f64, "\."\), 4, 10\), \1\)/);
    expect(out.match(/to_uppercase/g)).toHaveLength(1);
  });
});

describe("object literals", () => {
  const head = `<script setup lang="ts">
import { computed, type ComputedRef } from "vue";
import V from "./V.vue";
interface Card { title: string; count: number; note?: string; owner: string | null; tags: string[] }
interface Pair { left: Card; right?: Card }
const props = defineProps<{ name: string; n: number; words: string[]; card: Card; maybe?: Card; note?: string }>();
`;
  const child = `<script setup lang="ts">
export interface Item { label: string; n?: number }
defineProps<{ item: Item; items: Item[] }>();
</script>
<template><b>{{ item.label }}{{ items.length }}</b></template>`;
  const x = (setup: string, template: string, files: Record<string, string> = {}): string => {
    const root = island(`${head}${setup}\n</script>\n<template><div>${template}</div></template>`, { V: child });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "components", name), text);
    return compile(root).get("x.rs")!;
  };
  const refusal = (setup: string, template: string, files: Record<string, string> = {}): GenError => {
    try {
      x(setup, template, files);
    } catch (e) {
      if (e instanceof GenErrors) return e.errors[0] as GenError;
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it("builds a computed's literal as the struct of its return type, in the order the keys are written, an optional field left out absent", () => {
    const out = x(`const c = computed((): Card => (props.n > 0 ? { count: props.n, title: props.name, owner: null, tags: [] } : { title: "none", count: 0, owner: props.name, tags: props.words, note: props.note }));`, "{{ c.title }}");
    expect(out).toContain(
      'let s_c = if props.n as f64 > 0.0 { Card { count: props.n, title: Cow::<str>::Borrowed(&*props.name), owner: None, tags: Vec::new(), note: None } } else { Card { title: Cow::<str>::Borrowed("none"), count: 0i64, owner: Some(Cow::<str>::Borrowed(&*props.name)), tags: props.words.iter().map(|v| Cow::Borrowed(&**v)).collect(), note: props.note.as_deref().map(Cow::<str>::Borrowed) } };',
    );
    expect(out).toContain("fv::core::escape_into(out, &s_c.title);");
  });

  it.each([
    ["`computed<T>`", "const c = computed<Card>(() => ({ title: props.name, count: 1, owner: null, tags: [] }));"],
    ["`ComputedRef<T>`", "const c: ComputedRef<Card> = computed(() => ({ title: props.name, count: 1, owner: null, tags: [] }));"],
    ["`satisfies`", "const c = computed(() => ({ title: props.name, count: 1, owner: null, tags: [] }) satisfies Card);"],
    ["an annotated `const`", "const c: Card = { title: props.name, count: 1, owner: null, tags: [] };"],
  ])("takes the type from %s", (_, setup) => {
    expect(x(setup, "{{ c.title }}")).toContain("let s_c = Card { title: Cow::<str>::Borrowed(&*props.name), count: 1i64, owner: None, tags: Vec::new(), note: None };");
  });

  it("copies an optional boolean field of another struct as it is", () => {
    const out = x(
      `interface Flag { on?: boolean; label: string }
const src = computed((): Flag => ({ on: props.n > 0, label: props.name }));
const copy = computed((): Flag => ({ on: src.value.on, label: "x" }));`,
      "{{ copy.on }}",
    );
    expect(out).toContain('let s_copy = Flag { on: s_src.on, label: Cow::<str>::Borrowed("x") };');
  });

  it("writes shorthand keys, constant computed keys, an explicit `undefined`, a nested literal and a spread of the same type", () => {
    const out = x(
      `const KEY = "title";
const title = computed(() => props.name.trim());
const p = computed((): Pair => ({ left: { [KEY]: "l", count: 1, owner: null, tags: [], note: undefined }, right: { ...props.card, title: title.value } }));`,
      "{{ p.left.title }}{{ p.right?.title }}",
    );
    expect(out).toContain('left: Card { title: Cow::<str>::Borrowed("l"), count: 1i64, owner: None, tags: Vec::new(), note: None }');
    expect(out).toContain("right: Some(Card { title: Cow::<str>::Borrowed(s_title), ..props.card.clone() })");
  });

  it("builds a `.map()` callback's literal as the item type of the list it makes, owning what it reads from the callback's own values", () => {
    const typed = x("const rows = computed<Card[]>(() => props.words.map((w, i) => ({ title: w.toUpperCase(), count: i, owner: w, tags: [] })));", '<p v-for="r in rows">{{ r.title }}</p>');
    expect(typed).toContain("Card { title: Cow::<str>::Owned(fv_w.to_uppercase()), count: fv_i, owner: Some(Cow::<str>::Owned(str::to_owned(&*fv_w))), tags: Vec::new(), note: None } }).collect::<Vec<_>>();");
    expect(typed).toContain("for fv_r in s_rows.iter() {");
    const returned = x("const rows = computed(() => props.words.map((w): Card => ({ title: w, count: 0, owner: null, tags: [] })));", "{{ rows.length }}");
    expect(returned).toContain(".collect::<Vec<_>>();");
    expect(returned).toContain("s_rows.len() as i64");
  });

  it("builds a child's prop from a literal, and from `.map()` to literals, as the child's own struct", () => {
    const out = oneLine(x("", `<V :item="{ label: name }" :items="words.map((w) => ({ label: w, n: 1 }))" /><V v-bind="{ item: { label: 'b', n }, items: [] }" />`));
    expect(out).toContain("super::v::try_render(out, &super::v::Props { item: super::v::Item { label: Cow::<str>::Borrowed(&*props.name), n: None }, items: props.words.iter()");
    expect(out).toContain("super::v::Item { label: Cow::<str>::Owned(str::to_owned(&*fv_w)), n: Some(1i64) }).collect::<Vec<_>>() })?;");
    expect(out).toContain('super::v::Props { item: super::v::Item { label: Cow::<str>::Borrowed("b"), n: Some(props.n) }, items: Vec::new() }');
  });

  it("builds the literal a function returns, one of a .ts file as the struct in types.rs, which its caller need not import", () => {
    const out = x(
      `import { cardOf } from "./cards";
function local(on: boolean): Card {
  if (on) return { title: "on", count: 1, owner: null, tags: [] };
  return props.card;
}`,
      "{{ cardOf(name).title }}{{ local(n > 1).title }}",
      { "cards.ts": "export interface Made { title: string; size: number }\nexport function cardOf(title: string): Made {\n  return { title: title.trim(), size: title.length };\n}\n" },
    );
    expect(out).toContain('fv::core::escape_into(out, &((super::types::Made { title: Cow::<str>::Borrowed(fv::strings::js_trim(&props.name)), size: fv::strings::js_length(&props.name) }).title));');
    expect(out).toContain('{ Card { title: Cow::<str>::Borrowed("on"), count: 1i64, owner: None, tags: Vec::new(), note: None } } else { props.card.clone() }');
  });

  it("builds an array literal of objects as a list of the struct, and falls back to a literal from an optional object", () => {
    const out = x(`const list = computed((): Card[] => [{ title: "a", count: 1, owner: null, tags: [] }, props.maybe ?? { title: "b", count: 2, owner: null, tags: [] }]);`, "{{ list.length }}");
    expect(out).toContain('let s_list = Vec::from([Card { title: Cow::<str>::Borrowed("a"), count: 1i64, owner: None, tags: Vec::new(), note: None }, props.maybe.as_ref().cloned().unwrap_or(Card {');
  });

  it("evaluates a literal whose fields may throw where the render first reads it", () => {
    expect(x(`const c = computed((): Card => ({ title: "-".repeat(props.n), count: 1, owner: null, tags: [] }));`, "{{ c.title }}")).toContain("let s_c = std::cell::LazyCell::new(|| Card { title: ");
  });

  it.each([
    ["the template", "", "<p>{{ ({ a: n }).a }}</p>", /^an object literal in the template whose type is not known.*: pass it to a prop typed with an interface/],
    ["a computed", "const c = computed(() => ({ a: props.n }));", "{{ c.a }}", /an object literal in a `computed` whose type is not known.*: annotate the `computed`, as `computed<Card>\(\(\) => …\)`/],
    ["a `.map()` callback", "const c = computed(() => props.words.map((w) => ({ w })));", "{{ c.length }}", /an object literal in a `\.map\(\)` callback whose type is not known.*: type the callback's return, `\.map\(\(x\): Row => \(\{ … \}\)\)`/],
    ["a function", "function f() { return { a: props.n }; }", "{{ f().a }}", /an object literal in a function whose type is not known.*: give the function a return type/],
  ])("refuses an untyped literal in %s, saying how to type it", (_, setup, template, message) => {
    const e = refusal(setup, template);
    expect(e.code === "FV0634" || e.code === "FV0613").toBe(true);
    expect(e.what).toMatch(new RegExp(message.source.replace(/^\^/, "")));
  });

  it("refuses an untyped object constant setup cannot evaluate, saying it may be annotated", () => {
    const e = refusal("const o = { a: props.n };", "{{ o.a }}");
    expect(e.code).toBe("FV0207");
    expect(e.help).toMatch(/annotate it with an interface, `const o: Card = \{ … \}`/);
  });

  it("keeps a value built from literals out of JSON, `Object.keys`, `v-for`, `{{ }}` and `v-bind`, where the order of its keys would show", () => {
    const setup = "const c = computed((): Card => ({ count: 1, title: props.name, owner: null, tags: [] }));";
    expect(refusal(setup, "{{ JSON.stringify(c) }}").code).toBe("FV0707");
    expect(refusal(setup, "{{ Object.keys(c).join() }}").code).toBe("FV0814");
    expect(refusal(setup, '<p v-for="(v, k) in c">{{ k }}</p>').code).toBe("FV0820");
    expect(refusal(setup, "{{ c }}").code).toBe("FV0401");
    expect(refusal(setup, '<p v-bind="c">x</p>').code).toBe("FV0407");
  });
});

describe("constant lookups", () => {
  const render = (script: string, template: string, files: Record<string, string> = {}): string => {
    const project = island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(project, "components", name), text);
    const out = compile(project).get("x.rs")!;
    return out.slice(out.indexOf("pub fn render"), out.indexOf("/// The component's markup"));
  };

  it("reads a constant object by a prop typed as a union of string literals with a `match`", () => {
    const out = render(
      'type Size = "sm" | "md" | "lg";\ndefineProps<{ size: Size }>();\nconst PAD = { sm: "p-1", md: "p-2", lg: "p-4" } as const;',
      '<i :class="PAD[size]">{{ PAD[size] }}</i>',
    );
    expect(out).toContain("fv::attrs::class_into(out, false, &[match props.size { Size::Sm => \"p-1\", Size::Md => \"p-2\", Size::Lg => \"p-4\" }]);");
    expect(out).toContain('out.push_str(match props.size { Size::Sm => "p-1", Size::Md => "p-2", Size::Lg => "p-4" });');
  });

  it("matches every variant of a key's enum, whatever the `??` default and however the values group", () => {
    const out = render(
      'type K = "a" | "b" | "c";\ndefineProps<{ k?: K; j: K }>();\nconst T = { a: "A", b: "B", c: "C" } as const;\nconst U = { a: "A", b: "B", c: "A" } as const;',
      "<i>{{ T[k ?? 'c'] }} {{ T[k ?? 'b'] }} {{ U[j] }}</i>",
    );
    expect(out).toContain('match props.k.unwrap_or(K::C) { K::A => "A", K::B => "B", K::C => "C" }');
    expect(out).toContain('match props.k.unwrap_or(K::B) { K::A => "A", K::B => "B", K::C => "C" }');
    expect(out).toContain('match props.j { K::B => "B", K::A | K::C => "A" }');
  });

  it("holds a key annotated as a union as its enum, and matches every variant whatever the `??` default and however the values group", () => {
    const out = render(
      'import { computed } from "vue";\nconst props = defineProps<{ on: boolean; off: boolean }>();\nconst T = { a: "A", b: "B", c: "C" } as const;\nconst U = { a: "A", b: "B", c: "A" } as const;\nconst k = computed((): "a" | "b" | "c" => (props.on ? "b" : "c"));\nconst x = computed((): "a" | "c" | undefined => (props.off ? undefined : props.on ? "a" : "c"));',
      "<i>{{ U[k] }} {{ T[x ?? 'c'] }} {{ T[x ?? 'a'] }}</i>",
    );
    expect(out).toContain("let s_k = if props.on { XK::B } else { XK::C };");
    expect(out).toContain('match s_k { XK::B => "B", XK::A | XK::C => "A" }');
    expect(out).toContain('match s_x.unwrap_or(XX::C) { XX::A => "A", XX::C => "C" }');
    expect(out).toContain('match s_x.unwrap_or(XX::A) { XX::A => "A", XX::C => "C" }');
    expect(out).not.toContain("_ =>");
  });

  it("tests an enum key in a table of booleans and in `v-if` of a table that lacks members, with every arm of a `match` inside it named", () => {
    const out = render(
      'type K = "a" | "b" | "c";\ndefineProps<{ k: K }>();\nconst LAST = { a: false, b: false, c: true };\nconst FIRST = { a: true, b: false, c: false };\nconst ICON: Partial<Record<K, { label: string }>> = { a: { label: "ia" }, c: { label: "ic" } };\nconst NONE_LAST: Partial<Record<K, { label: string }>> = { a: { label: "ia" }, b: { label: "ib" } };',
      '<i v-if="LAST[k]">l</i><i v-if="FIRST[k]">f</i><b v-if="ICON[k]">{{ ICON[k].label }}</b><b v-if="NONE_LAST[k]">{{ NONE_LAST[k].label }}</b>',
    );
    expect(out).toContain("if !matches!(props.k, K::A | K::B) {");
    expect(out).toContain("if matches!(props.k, K::A) {");
    expect(out).toContain("if !matches!(props.k, K::B) {");
    expect(out).toContain("if matches!(props.k, K::A | K::B) {");
    expect(out).toContain('match props.k { K::A => "ia", K::C | K::B => "ic" }');
    expect(out).not.toContain("_ =>");
  });

  it("reads a constant a `.ts` file exports, keyed by its enum's members, by a prop of the enum and a `v-for` item's field", () => {
    const out = render(
      'import { THEME, Tone } from "./theme";\ninterface Badge { tone: Tone }\ndefineProps<{ tone: Tone; badges: Badge[] }>();',
      '<i :style="{ color: THEME[tone].fg }">{{ THEME[Tone.Warn].fg }}</i><b v-for="b in badges">{{ THEME[b.tone].weight }}</b>',
      { "theme.ts": 'export enum Tone { Info = "info", Warn = "warn" }\nexport const THEME: Record<Tone, { fg: string; weight: number }> = { [Tone.Info]: { fg: "navy", weight: 400 }, [Tone.Warn]: { fg: "red", weight: 700.5 } };\n' },
    );
    expect(out).toContain('out.push_str(match props.tone { super::types::Tone::Info => "navy", super::types::Tone::Warn => "red" });');
    expect(out).toContain("red</i>");
    expect(out).toContain('fv::core::push_number(out, match fv_b.tone { super::types::Tone::Info => 400.0f64, super::types::Tone::Warn => 700.5f64 });');
  });

  it("evaluates an enum member set to a constant of the component, a string joined to one, and an earlier member, as a prop's type", () => {
    const out = render(
      'const B = 1;\nconst PREFIX = "x";\nenum E { A = B, C }\nenum S { A = PREFIX + "a", B = "b" }\nenum R { One = 1, Two = One + 1, Four = R.Two * 2 }\nconst D: S = S.A;\nconst F: E = E.C;\ndefineProps<{ e: E; s: S; r: R }>();',
      "<i>{{ e }} {{ s }} {{ r }}|{{ E.A }} {{ E.C }} {{ D }} {{ F }} {{ R.Two }} {{ R.Four }}</i>",
    );
    expect(out).not.toContain("let s_f");
    expect(out).toContain("fv::core::push_int(out, props.e);");
    expect(out).toContain("fv::core::escape_into(out, fv::props::Union::as_str(props.s));");
    expect(out).toContain("fv::core::push_int(out, props.r);");
    expect(out).toContain('out.push_str("|1 2 xa 2 2 4</i>");');
  });

  it("evaluates an enum member named by a constant beside it as the member", () => {
    const out = render('import { Step } from "./steps";\nconst A = 5;\nenum E { A = 1, B = A }\ndefineProps<{ step: Step }>();', "<i>{{ E.B }} {{ Step.Next }}</i>", {
      "steps.ts": "const First = 7;\nexport enum Step { First = 1, Next = First + 1 }\n",
    });
    expect(out).toContain('out.push_str("<i>1 2</i>");');
  });

  it("reads by integer literal keys, and keeps the literals of a `?:` and a `computed`", () => {
    const out = render(
      'import { computed } from "vue";\nconst props = defineProps<{ level: 1 | 2; on: boolean }>();\nconst NAMES = { 1: "one", 2: "two", x: "ex" };\nconst PAD = { a: "p-1", b: "p-2" };\nconst pick = computed(() => (props.on ? "a" : "b"));',
      "<i>{{ NAMES[level] }} {{ PAD[on ? 'b' : 'a'] }} {{ PAD[pick] }}</i>",
    );
    expect(out).toContain('out.push_str(match props.level { 1 => "one", _ => "two" });');
    expect(out).toContain('out.push_str(if props.on { "p-2" } else { "p-1" });');
    expect(out).toContain('out.push_str(match s_pick { "a" => "p-1", _ => "p-2" });');
  });

  it("reads `undefined` for the keys an object lacks, narrowed with `??`, `?.` and `v-if`", () => {
    const out = render(
      'defineProps<{ kind: "a" | "b" | "c" }>();\nconst T = { a: "A", b: "B" };\nconst I = { a: { label: "x" } };',
      '<i>{{ T[kind] ?? "-" }} {{ I[kind]?.label }}</i><b v-if="I[kind]">{{ I[kind].label }}</b><s v-if="T[kind]">{{ T[kind] }}</s>',
    );
    expect(out).toContain('fv::core::escape_into(out, (match props.kind { XKind::A => Some("A"), XKind::B => Some("B"), XKind::C => None }).unwrap_or("-"));');
    expect(out).toContain('if let Some(v) = match props.kind { XKind::A => Some("x"), XKind::B | XKind::C => None } {');
    expect(out).toContain('out.push_str(if matches!(props.kind, XKind::A) { "</i><b>x</b>" } else { "</i><!---->" });');
    expect(out).toMatch(/if let Some\((fv_t)\) = match props\.kind \{ XKind::A => Some\("A"\), XKind::B => Some\("B"\), XKind::C => None \} \{\n {8}out\.push_str\("<s>"\);\n {8}fv::core::escape_into\(out, \1\);/);
  });

  it("forgets the literals of a list item or a `??` that another value may be", () => {
    expect(() => render('defineProps<{ k: "sm"; s: string }>();\nconst PAD = { sm: "p-1" };', '<i v-for="x in [k, s]">{{ PAD[x] }}</i>')).toThrow(expect.objectContaining({ code: "FV0222" }));
    expect(() => render('defineProps<{ k?: "sm"; s: string }>();\nconst PAD = { sm: "p-1" };', "<i>{{ PAD[k ?? s] }}</i>")).toThrow(expect.objectContaining({ code: "FV0222" }));
    expect(() => render('defineProps<{ ks?: "sm"[]; ss: string[] }>();\nconst PAD = { sm: "p-1" };', '<i v-for="x in (ks ?? ss)">{{ PAD[x] }}</i>')).toThrow(expect.objectContaining({ code: "FV0222" }));
    expect(() => render('defineProps<{ ns: number[] }>();\nconst START = 0;\nconst N: Record<number, string> = { 0: "a", 1: "b" };', "<i>{{ N[ns.reduce((a, n) => a + n, START)] }}</i>")).toThrow(expect.objectContaining({ code: "FV0222" }));
    expect(render('defineProps<{ ks?: "sm"[] }>();\nconst PAD = { sm: "p-1" };', '<i v-for="x in (ks ?? [])">{{ PAD[x] }}</i>')).toContain('out.push_str("<i>p-1</i>");');
  });
});

describe("narrowing through `&&` and `||` chains", () => {
  const render = (script: string, template: string): string => {
    const out = compile(island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`)).get("x.rs")!;
    return out.slice(out.indexOf("pub fn render"), out.indexOf("/// The component's markup"));
  };
  const refused = (script: string, template: string): GenError => {
    try {
      compile(island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`));
    } catch (e) {
      if (e instanceof GenErrors) return e.errors[0] as GenError;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it("keeps a test's narrowing in every operand after it, in a template, a computed and a function", () => {
    const out = render(
      `import { computed } from "vue";
const props = defineProps<{ n?: number }>();
const inside = computed(() => props.n != null && props.n > 1 && props.n < 9);
function outside(x?: number): boolean {
  return x === undefined || x < 1 || x > 9;
}`,
      "<i>{{ n != null && n > 1 && n < 9 }}|{{ inside }}|{{ outside(n) }}</i>",
    );
    expect(out).toContain("let s_inside = if let Some(fv_n) = props.n { fv_n as f64 > 1.0 && (fv_n as f64) < 9.0 } else { false };");
    expect(out).toContain("if let Some(fv_n_2) = props.n { fv_n_2 as f64 > 1.0 && (fv_n_2 as f64) < 9.0 } else { false }");
    expect(out).toContain("if let Some(fv_x) = props.n { (fv_x as f64) < 1.0 || fv_x as f64 > 9.0 } else { true }");
  });

  it("narrows the branches of a `?:` whose test is a chain, and a `v-if` of one", () => {
    const out = render("defineProps<{ n?: number }>();", '<i v-if="n != null && n > 1 && n < 9">{{ n * 2 }}</i><b>{{ n != null && n > 1 ? n * 2 : 0 }}|{{ n == null || n < 0 ? "bad" : n.toFixed(1) }}</b>');
    expect(out).toMatch(/if let Some\(fv_n\) = props\.n && fv_n as f64 > 1\.0 && \(fv_n as f64\) < 9\.0 \{/);
    expect(out).toMatch(/fv::core::js_to_fixed\(fv_n_3 as f64, 1\)/);
  });

  it("reads a lookup by a key `&&` tested, as `undefined` where the key is absent", () => {
    const out = render('const TONE = { info: "blue", warn: "amber" } as const;\ndefineProps<{ tone?: "info" | "warn" }>();', '<b :class="tone && TONE[tone]" :title="tone && TONE[tone]">{{ (tone && TONE[tone]) ?? "none" }}</b>');
    expect(out).toContain("if let Some(fv_tone) = props.tone { match fv_tone {");
    expect(out).toContain('XTone::Info => "blue", XTone::Warn => "amber"');
    expect(out).not.toContain("FV0223");
  });

  it("refuses `&&` after a value that may be falsy while present, saying why", () => {
    const e = refused("defineProps<{ s?: string }>();", "<i>{{ s && s.length }}</i>");
    expect(e.code).toBe("FV0614");
    expect(e.message).toMatch(/`&&` gives its left side where that is falsy, and this one, an optional string, may be falsy where it is present/);
  });
});

describe("constants evaluated when compiling", () => {
  const project = (script: string, template: string, files: Record<string, string>): string => {
    const root = island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "components", name), text);
    return root;
  };
  const failure = (root: string): GenError => {
    try {
      compile(root);
    } catch (e) {
      if (e instanceof GenErrors) return e.errors[0] as GenError;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it("folds arithmetic, `+` of strings and template literals of constants as JavaScript evaluates them", () => {
    const units = `const MINUTE = 60;
const HOUR = 60 * MINUTE;
export const THIRD = 1 / 3;
export const NEG = -(7 % 4) + +2.5;
export const BIG = 2 ** 40 - 1;
const BASE = "/feed";
export const NEWEST = \`\${BASE}/new?h=\${HOUR / MINUTE}\`;
export const MARK = "#" + 1.5 + "/" + THIRD;
export function hours(s: number): number {
  return Math.floor(s / HOUR);
}
`;
    const out = compile(project('import { BIG, MARK, NEG, NEWEST, THIRD, hours } from "./units";\ndefineProps<{ s: number }>();', "<i>{{ hours(s) }}|{{ THIRD }}|{{ NEG }}|{{ BIG }}|{{ NEWEST }}|{{ MARK }}</i>", { "units.ts": units })).get("x.rs")!;
    expect(out).toContain("(props.s as f64 / 3600.0).floor()");
    expect(out).toContain("|0.3333333333333333|-0.5|1099511627775|/feed/new?h=60|#1.5/0.3333333333333333</i>");
  });

  it("folds a constant of setup that an object constant reads", () => {
    const out = compile(project("const GAP = 2 * 4;\nconst SPACE = { sm: GAP, lg: GAP * 2 + 0.5, unit: `${GAP}px` };", "<i>{{ SPACE.sm }}|{{ SPACE.lg }}|{{ SPACE.unit }}</i>", {})).get("x.rs")!;
    expect(out).toContain("<i>8|16.5|8px</i>");
  });

  it("refuses a power engines round in their own ways, and an operator of a list, with the constant's code", () => {
    const power = failure(project('import { HUGE } from "./units";', "<i>{{ HUGE }}</i>", { "units.ts": "export const HUGE = 3 ** 40;\n" }));
    expect(power.code).toBe("FV0720");
    expect(power.at).toMatchObject({ file: "components/units.ts", line: 1 });
    const list = failure(project('import { TWICE } from "./units";', "<i>{{ TWICE }}</i>", { "units.ts": "const XS = [1];\nexport const TWICE = XS * 2;\n" }));
    expect(list.code).toBe("FV0207");
    expect(list.message).toMatch(/arithmetic and template literals in a constant take strings, numbers, booleans and `null`/);
    const mixed = failure(project('import { ODD } from "./units";', "<i>{{ ODD }}</i>", { "units.ts": "export const ODD = true - 1;\n" }));
    expect(mixed.message).toMatch(/`-` in a constant takes two numbers, and these are boolean and number/);
  });
});

describe("strings known to be ASCII", () => {
  const render = (script: string, template: string): string => {
    const out = compile(island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`)).get("x.rs")!;
    return out.slice(out.indexOf("pub fn render"), out.indexOf("/// The component's markup"));
  };

  it("cuts the string of a number into whole characters, which may be joined, indexed and counted", () => {
    const out = render(
      `defineProps<{ n: number }>();
function group(n: number): string {
  const d = String(n);
  return d.split("").reduce((acc, ch, i) => (i > 0 && (d.length - i) % 3 === 0 ? \`\${acc},\${ch}\` : \`\${acc}\${ch}\`), "");
}`,
      "<i>{{ group(n) }}|{{ String(n).split('').join('') }}|{{ String(n)[0] ?? '?' }}|{{ n.toFixed(2).slice(-3) }}</i>",
    );
    expect(out).toContain("fv::strings::js_reduce(fv::strings::js_split(&");
    expect(out).toContain('Some(fv::strings::js_char_at(');
  });

  it("still refuses joining the halves of a string that may hold any character", () => {
    const e = (() => {
      try {
        compile(island(`<script setup lang="ts">\ndefineProps<{ s: string }>();\n</script>\n<template><i>{{ s.split("").join("") }}</i></template>`));
      } catch (err) {
        return (err as GenErrors).errors[0] as GenError;
      }
      throw new Error("compiled");
    })();
    expect(e.code).toBe("FV0706");
  });
});

describe("functions a body declares", () => {
  const compiled = (script: string, template: string): string => {
    const out = compile(island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`)).get("x.rs")!;
    return out.slice(out.indexOf("pub fn render"), out.indexOf("/// The component's markup"));
  };
  const refusal = (script: string, template: string): GenError => {
    try {
      compile(island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`));
    } catch (e) {
      if (e instanceof GenErrors) return e.errors[0] as GenError;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it("inlines an arrow function a function's or a computed's body declares, which reads the body's own names", () => {
    const out = compiled(
      `import { computed } from "vue";
const props = defineProps<{ a: string; b: string }>();
function both(a: string, b: string): string {
  const sep = a.length > 2 ? "; " : ", ";
  const shout = (x: string) => \`\${x.toUpperCase()}\${sep}\`;
  return \`\${shout(a)}\${shout(b)}\`;
}
const tagged = computed(() => {
  const tag = (x: string): string => \`#\${x}\`;
  return tag(props.a);
});`,
      "<i>{{ both(a, b) }}|{{ tagged }}</i>",
    );
    expect(out).toContain("to_uppercase()");
    expect(out).toContain('format!("#{}", props.a)');
  });

  it("builds an object literal an arrow function a body declares returns as the struct of its return type", () => {
    const out = compiled(
      `import { computed } from "vue";
interface Card { title: string; size: number }
const props = defineProps<{ a: string; b: string }>();
function pick(): Card {
  const card = (title: string): Card => ({ title, size: title.length });
  return props.b.length > 0 ? card(props.b) : card(props.a);
}
const first = computed((): Card => {
  const make = (title: string): Card => ({ title, size: 1 });
  return make(props.a);
});`,
      "<i>{{ pick().title }}|{{ first.size }}</i>",
    );
    expect(out).toMatch(/Card \{/);
    const untyped = refusal(
      `import { computed } from "vue";
interface Card { title: string }
const props = defineProps<{ a: string }>();
const first = computed((): Card => {
  const make = (title: string) => ({ title });
  return make(props.a);
});`,
      "<i>{{ first.title }}</i>",
    );
    expect(untyped.code).toBe("FV0634");
    expect(untyped.message).toMatch(/an object literal in a function whose type is not known, .*give the function a return type/);
  });

  it("refuses such a function that calls itself, or that is read as a value, by its own name", () => {
    const loop = refusal("defineProps<{ n: number }>();\nfunction f(n: number): number {\n  const g = (k: number): number => (k > 0 ? g(k - 1) : 0);\n  return g(n);\n}", "<i>{{ f(n) }}</i>");
    expect(loop.code).toBe("FV1906");
    expect(loop.message).toMatch(/`g\(\)` calls itself/);
    const value = refusal("defineProps<{ xs: string[] }>();\nfunction f(xs: string[]): string[] {\n  const up = (x: string) => x.toUpperCase();\n  return xs.map(up);\n}", "<i>{{ f(xs) }}</i>");
    expect(value.code).toBe("FV0805");
  });
});

describe("own keys of constant objects and `Map`s", () => {
  const render = (script: string, template: string): string => {
    const out = compile(island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`)).get("x.rs")!;
    return out.slice(out.indexOf("pub fn render"), out.indexOf("/// The component's markup"));
  };
  const refusal = (script: string, template: string): GenError => {
    try {
      compile(island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`));
    } catch (e) {
      if (e instanceof GenErrors) return e.errors[0] as GenError;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it("tests a free-text key against a constant object's own keys, and reads the object by the key it narrows", () => {
    const out = render('const ROLE: Record<string, string> = { mod: "is-mod", admin: "is-admin" };\ndefineProps<{ role: string; scores: Record<string, number> }>();', `<b :class="Object.hasOwn(ROLE, role) ? ROLE[role] : ''">{{ Object.hasOwn(scores, role) }}|{{ Object.keys(ROLE).join(",") }}</b>`);
    expect(out).toMatch(/if let Some\((fv_role)\) = matches!\(&\*props\.role, "mod" \| "admin"\)\.then_some\(&\*props\.role\) \{ match \1 \{ "mod" => "is-mod", _ => "is-admin" \} \} else \{ "" \}/);
    expect(out).toContain("props.scores.get(&props.role).is_some()");
    expect(out).toContain('["mod", "admin"]');
  });

  it("reads a constant `Map` by `.get()` and `.has()`, `undefined` for a key it lacks", () => {
    const out = render('const WIDTH = new Map([["sm", 12], ["md", 16]]);\ndefineProps<{ size: string }>();', "<i>{{ WIDTH.get(size) ?? 10 }}|{{ WIDTH.has(size) }}</i>");
    expect(out).toContain('match &*props.size { "sm" => Some(12i64), "md" => Some(16i64), _ => None }');
    expect(out).toContain('matches!(&*props.size, "sm" | "md")');
  });

  it("refuses a `Map` read whole or by its size, and `Object.values()` of a constant object, saying what is read", () => {
    expect(refusal('const WIDTH = new Map([["sm", 12]]);', "<i>{{ WIDTH.size }}</i>").code).toBe("FV0227");
    expect(refusal('const WIDTH = new Map([["sm", 12]]);\ndefineProps<{ k?: string }>();', "<i>{{ WIDTH.get(k) }}</i>").message).toMatch(/a constant `Map` is read by a string or an integer that is present/);
    const values = refusal('const ROLE = { mod: "is-mod" };', "<i>{{ Object.values(ROLE).join() }}</i>");
    expect(values.code).toBe("FV0814");
    expect(values.message).toMatch(/`Object\.values\(\)` of `ROLE`, a constant object, whose fields the server reads one by one/);
  });
});

describe("loops and assignments", () => {
  const render = (script: string, template: string): string => {
    const out = compile(
      island(`<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
const props = defineProps<{ rows: Row[]; words: string[]; s: string; n: number; f: Float }>();
${script}
</script>
<template><i>${template}</i></template>`),
    ).get("x.rs")!;
    return out.slice(out.indexOf("pub fn render"));
  };

  it("carries a sum in an f64 the loop adds to, and writes it as JavaScript writes the number", () => {
    const body = render("const total = computed(() => {\n  let sum = 0;\n  for (const r of props.rows) sum += r.n;\n  return sum;\n});", "{{ total }}");
    expect(body).toContain("let s_total = { let mut fv_sum: f64 = 0.0f64; for fv_r in props.rows.iter() { fv_sum += fv_r.n as f64; } fv_sum };");
    expect(body).toContain("fv::core::push_number(out, s_total);");
    expect(body).not.toContain("try_int");
  });

  it("carries a Float once a value the loop gives may be one", () => {
    const body = render("const total = computed(() => {\n  let sum = 0;\n  for (const r of props.rows) sum += r.n * props.f;\n  return sum;\n});", "{{ total }}");
    expect(body).toContain("let mut fv_sum: f64 = 0.0f64; for fv_r in props.rows.iter() { fv_sum += fv_r.n as f64 * props.f; } fv_sum }");
  });

  it("appends to a string the loop builds, and iterates a string by its characters", () => {
    const body = render('function spaced(s: string): string {\n  let out = "";\n  for (const ch of s) out += `${ch} `;\n  return out;\n}', "{{ spaced(s) }}");
    expect(body).toContain('let mut fv_out: String = String::new(); for fv_ch in props.s.split_inclusive(|_: char| true) { use std::fmt::Write as _; let _ = write!(fv_out, "{} ", fv_ch); } Cow::<str>::Owned(fv_out)');
  });

  it("counts with a while loop over an f64, the bound read on every item as JavaScript reads it", () => {
    const body = render('function stars(n: number): string {\n  let out = "";\n  for (let i = 0; i < Math.min(n, 5); i++) out += "*";\n  return out;\n}', "{{ stars(n) }}");
    expect(body).toContain("let mut fv_out: String = String::new(); let mut fv_i: f64 = 0.0f64; while fv_i < props.n.min(5i64) as f64 { fv_out.push('*'); fv_i += 1.0; }");
  });

  it("keeps a return inside a loop for after it, and breaks out", () => {
    const body = render('function first(words: string[]): string {\n  for (const w of words) if (w.length > 2) return w;\n  return "none";\n}', "{{ first(words) }}");
    expect(body).toContain("let mut fv_returned: Option<String> = None; for fv_w in props.words.iter().map(|v| Cow::<str>::Borrowed(&**v)) { if fv::strings::js_length(&fv_w) > 2 { fv_returned = Some(String::from(&*fv_w)); break; } }");
    expect(body).toContain('if fv_returned.is_some() { fv_returned.as_deref().unwrap_or_default() } else { "none" }');
  });

  it("numbers the items of `.entries()` as integers", () => {
    const body = render("function at(words: string[], s: string): number {\n  for (const [i, w] of words.entries()) if (w === s) return i;\n  return -1;\n}", "{{ at(words, s) }}");
    expect(body).toMatch(/for \(fv_i, fv_w\) in .*\.enumerate\(\) \{ let fv_i = fv_i as i64; /);
  });

  it("runs a body that never reaches its next item on the first item alone, with no break", () => {
    const body = render('function initial(s: string): string {\n  let out = "";\n  for (const ch of s) {\n    out = ch;\n    break;\n  }\n  return out;\n}', "{{ initial(s) }}");
    expect(body).toContain("for fv_ch in props.s.split_inclusive(|_: char| true).take(1) { fv_out = String::from(fv_ch); }");
    expect(body).not.toContain("break");
  });

  it("drops a let the loop assigns and nothing reads, and assigns at a break only what is read after the loop", () => {
    const body = render('function f(words: string[]): string {\n  let last = "";\n  let seen = 0;\n  let count = 0;\n  for (const w of words) {\n    last = w;\n    if (seen > 2) break;\n    seen += 1;\n    count += 1;\n  }\n  return `${count}`;\n}', "{{ f(words) }}");
    expect(body).not.toContain("String::new()");
    expect(body).toContain("for _ in props.words.iter() { if fv_seen > 2.0 { break; } else { fv_seen += 1.0; fv_count += 1.0; } }");
  });

  it("binds a let assigned again outside loops anew, with the type TypeScript narrows it to", () => {
    const body = render('function size(n: number): number {\n  let label: string | undefined = undefined;\n  if (n > 1) label = "many";\n  else label = "one";\n  return label.length;\n}', "{{ size(n) }}");
    expect(body).not.toContain("let mut");
    expect(body).toMatch(/if props\.n as f64 > 1\.0 \{ fv::strings::js_length\("many"\) \} else \{ fv::strings::js_length\("one"\) \}/);
  });

  it("evaluates a value the body reads twice once, in a let", () => {
    const body = render('function twice(s: string): string {\n  let t = s;\n  t = t.trim();\n  return t + t;\n}', "{{ twice(s) }}");
    expect(body.match(/fv::strings::js_trim/g)).toHaveLength(1);
  });

  it("swaps two lets through temporaries", () => {
    const body = render('function swapped(n: number): string {\n  let a = "a";\n  let b = "b";\n  for (let i = 0; i < n; i++) {\n    const t = a;\n    a = b;\n    b = t;\n  }\n  return a + b;\n}', "{{ swapped(n) }}");
    expect(body).toContain("let fv_next_a = String::from(&*fv_b); let fv_next_b = String::from(&*fv_a); let fv_next_i = fv_i + 1.0; fv_a = fv_next_a; fv_b = fv_next_b; fv_i = fv_next_i;");
  });
});

describe("the names of generated locals", () => {
  const script = `<script setup lang="ts">
import { computed } from "vue";
interface Row { name: string; n: number }
const props = defineProps<{ rows: Row[]; title?: string; tags: (string | null)[]; label: string }>();
function shout(word: string): string {
  return word + word;
}
const total = computed(() => {
  let rowCount = 0;
  for (const $row of props.rows) rowCount += $row.n;
  return rowCount;
});
</script>`;
  const body = `{{ total }}<b v-if="title">{{ title }}</b><p v-for="(item, i) in rows">{{ i }}{{ item.name }}{{ tags.filter(Boolean).join() }}</p>{{ shout(label.trim()) }}{{ shout(label.toUpperCase()) }}<s v-for="größe in tags">{{ größe }}</s>`;
  const other = (text: string): string => `<script setup lang="ts">\ndefineProps<{ note?: string }>();\n</script>\n<template><em v-if="note">${text}{{ note }}</em></template>`;
  const x = (before = ""): string => `${script}\n<template><i>${before}${body}</i></template>`;

  it("names a local fv_ and its JavaScript name in snake case, a value the compiler makes by its role, and a name the function holds already with _2", () => {
    const out = compile(island(x(), { Y: other("") })).get("x.rs")!;
    expect(out).toContain("let s_total = { let mut fv_row_count: f64 = 0.0f64; for fv_row in props.rows.iter() { fv_row_count += fv_row.n as f64; } fv_row_count };");
    expect(out).toContain("if let Some(fv_title) = props.title.as_deref().filter(|v| !v.is_empty()) {");
    expect(out).toContain("for (fv_i, fv_item) in props.rows.iter().enumerate() {\n        let fv_i = fv_i as i64;");
    expect(out).toContain(".filter(|fv_item_2| !fv_item_2.is_empty())");
    expect(out).toContain("let fv_word = fv::strings::js_trim(&props.label);");
    expect(out).toContain("let fv_word_2 = props.label.to_uppercase();");
    expect(out).toContain("for fv_gro_e_ref in props.tags.iter() {\n        let fv_gro_e = fv_gro_e_ref.as_deref();");
  });

  it("gives the same names to the same component, and keeps the names of code an edit elsewhere leaves alone", () => {
    const first = compile(island(x(), { Y: other("") }));
    const again = compile(island(x(), { Y: other("") }));
    expect(again.get("x.rs")).toBe(first.get("x.rs"));
    expect(again.get("y.rs")).toBe(first.get("y.rs"));
    const edited = compile(island(x(`<u v-for="tag in tags">{{ tag }}</u><hr :title="String(rows.some((r) => r.n > 1))">`), { Y: other("<b>new</b>") }));
    const kept = first.get("x.rs")!.split("\n").filter((line) => /\bfv_[a-z]/.test(line) && !line.includes("reserve("));
    expect(kept.length).toBeGreaterThan(10);
    for (const line of kept) expect(edited.get("x.rs")).toContain(line);
    expect(edited.get("y.rs")).toContain("if let Some(fv_note) = props.note.as_deref().filter(|v| !v.is_empty()) {");
    expect(edited.get("x.rs")).toContain("for fv_tag_ref in props.tags.iter() {");
    expect(edited.get("x.rs")).toContain(".any(|fv_r| fv_r.n as f64 > 1.0)");
  });
});

describe("branches that cannot run", () => {
  const known = (template: string): string =>
    compile(
      island(`<script setup lang="ts">
type Kind = "text" | "link";
type Mark = "" | "new";
interface Part { label: string; tags: string[] }
defineProps<{ note?: string; kind: Kind; mark: Mark; eager: boolean; on: boolean; flair: string[]; parts: Part[]; n: number }>();
</script>
<template>${template}</template>`),
    ).get("x.rs")!;

  it("tests a value for the empty string only where it may be one", () => {
    const out = known(`<div :title="note || undefined" :data-kind="kind" :data-mark="mark"></div>`);
    expect(out).toContain('if let Some(v) = props.note.as_deref().filter(|v| !v.is_empty()) {\n        out.push_str(" title=\\"");\n        fv::core::escape_into(out, v);');
    expect(out).toContain('out.push_str(" data-kind=\\"");\n    fv::core::escape_into(out, fv::props::Union::as_str(props.kind));');
    expect(out).toContain('if fv::props::Union::as_str(props.mark).is_empty() {\n        out.push_str("\\" data-mark></div>");');
    expect(out.match(/is_empty\(\) \{/g)).toHaveLength(1);
    const guarded = known(`<div v-if="note" :data-note="note"></div>`);
    expect(guarded).toContain('if let Some(fv_note) = props.note.as_deref().filter(|v| !v.is_empty()) {\n        out.push_str("<div data-note=\\"");\n        fv::core::escape_into(out, fv_note);');
    expect(guarded).not.toContain("fv_note.is_empty()");
  });

  it("writes an attribute bound to a literal or `undefined` as the literal where the test holds", () => {
    const out = known(`<iframe :loading="eager ? undefined : 'lazy'" :title="on ? 'a&quot;<b>' : undefined" :data-on="on ? '' : undefined"></iframe>`);
    expect(out).toContain('if !props.eager {\n        out.push_str(" loading=\\"lazy\\"");\n    }');
    expect(out).toContain('if props.on {\n        out.push_str(" title=\\"a&quot;&lt;b&gt;\\"");\n    }');
    expect(out).toContain('if props.on {\n        out.push_str(" data-on");\n    }');
    expect(out).not.toContain("escape_into");
  });

  it("compares and adds counts as integers, and numbers that may be beyond 2⁵³ as JavaScript does", () => {
    const out = known(`<p v-for="(part, i) in parts" :class="{ first: i === 0, last: i + 1 === parts.length }">{{ i + 2 }}{{ i * 2 }}{{ i + n }}{{ part.label }}</p>`);
    expect(out).toContain('if fv_i == 0 { "first" }');
    expect(out).toContain("fv_i + 1 == props.parts.len() as i64");
    expect(out).toContain("fv::core::push_int(out, fv_i + 2);");
    expect(out).toContain("fv::core::push_number(out, fv_i as f64 * 2.0);");
    expect(out).toContain("fv_i as f64 + props.n as f64");
    const shown = known(`<b v-for="(part, i) in parts" v-show="i < 2" :title="part.tags.length > i ? 'more' : 'less'"></b>`);
    expect(shown).toContain("if fv_i >= 2 {");
    expect(shown).toContain("fv_part.tags.len() as i64 as f64 > fv_i as f64");
  });

  it("tests a list's length for truth as whether it is empty, and walks a list of objects with no binding of each item again", () => {
    const out = known(`<b v-if="flair.length">x</b><i v-for="part in parts">{{ part.label }}</i>`);
    expect(out).toContain("if !props.flair.is_empty() {");
    expect(out).toContain('for fv_part in props.parts.iter() {\n        out.push_str("<i>");');
    expect(out).not.toContain("_ref");
  });

  describe("a value that is one of a non-empty string and another", () => {
    const joined = (template: string, setup = ""): string =>
      compile(
        island(`<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ a?: string; b: string; c: boolean; s: string; t: string; bs: string[]; m: "" | "new" }>();
${setup}
</script>
<template>${template}</template>`),
      ).get("x.rs")!;

    it.each([
      ["`?:`", `<p v-if="a"><b v-if="c ? a : b">x</b></p>`, ""],
      ["`?:` with the plain side first", `<p v-if="a"><b v-if="c ? b : a">x</b></p>`, ""],
      ["`??`", `<b v-if="(s || undefined) ?? t">x</b>`, ""],
      ["a `?:` of one union whose branches narrow it apart", `<b v-if="m ? m : m">x</b>`, ""],
      ["an array literal's item", `<p v-if="a"><template v-for="x in [a, b]"><b v-if="x">x</b></template></p>`, ""],
      ["an array literal's item with the plain side first", `<p v-if="a"><template v-for="x in [b, a]"><b v-if="x">x</b></template></p>`, ""],
      [
        "a list built in a block of statements",
        `<template v-for="x in both"><b v-if="x">x</b></template>`,
        "interface Tally { n: number }\nconst both = computed(() => {\n  if (props.a) {\n    const r: Tally = { n: props.bs.length };\n    return [props.a, r.n > 0 ? 'x' : 'y'];\n  }\n  const q: Tally = { n: 1 };\n  return [props.b, q.n > props.bs.length ? 'x' : 'y'];\n});",
      ],
      ["a computed `?:`", `<b v-if="pick">x</b>`, "const pick = computed(() => (props.a ? (props.b.length ? props.a : props.b) : 'none'));"],
      ["a computed array literal's item", `<template v-for="x in both"><b v-if="x">x</b></template>`, "const both = computed(() => (props.a ? [props.a, props.b] : []));"],
    ])("tests %s for the empty string", (_, template, setup) => {
      expect(joined(template, setup)).toMatch(/is_empty\(\) \}? ?\{ "[^"]*<b>x<\/b>/);
    });

    it.each([
      ["`?:`", `<p v-if="a"><b v-if="c ? a : 'none'">x</b></p>`],
      ["`??`", `<b v-if="(s || undefined) ?? 'none'">x</b>`],
      ["an array literal's item", `<p v-if="a"><template v-for="x in [a, 'none']"><b v-if="x">x</b></template></p>`],
    ])("tests %s of two non-empty strings for nothing", (_, template) => {
      const out = joined(template);
      expect(out).toMatch(/"[^"]*<b>x<\/b>/);
      expect(out).not.toMatch(/is_empty\(\) \}? ?\{ "[^"]*<b>x<\/b>/);
    });
  });
});

describe("refs the browser alone writes", () => {
  const mounted = (setup: string, template: string): string =>
    compile(
      island(`<script setup lang="ts">
import { onMounted, ref } from "vue";
const props = defineProps<{ n: number; items: string[] }>();
${setup}
</script>
<template>${template}</template>`),
    ).get("x.rs")!;

  it("folds a test of a ref seeded with a number or a boolean, which the server renders with that value", () => {
    const out = mounted(
      "const fresh = ref(0);\nconst live = ref(false);\nonMounted(() => { fresh.value = 3; live.value = true; });",
      `<div><span v-if="fresh > 0" :title="fresh + ' new'">+{{ fresh }}</span><i v-for="(item, i) in items" :class="[live && i !== 0 ? 'hidden' : '']">{{ item }}</i></div>`,
    );
    expect(out).toContain('out.push_str("<div><!----><!--[-->");');
    expect(out).toContain('out.push_str("<i class=\\"\\">");');
    expect(out).not.toContain("s_fresh");
    expect(out).not.toContain("s_live");
    expect(out).not.toContain("format!");
  });

  it("folds `NaN`, `-0` and fractions as JavaScript compares and writes them", () => {
    const out = mounted("const m = ref(NaN);\nconst z = ref(-0);\nconst r = ref(1.5);", `<p v-if="m">a</p><p v-if="m !== m">{{ m }}|{{ 1 / z }}|{{ r > 1 }}|{{ r * 2 }}</p>`);
    expect(out).toContain('out.push_str("<!--[--><!----><p>NaN|-Infinity|true|3</p><!--]-->");');
  });

  it("binds a ref seeded from a prop, whose value the server knows only when rendering", () => {
    const out = mounted("const seen = ref(props.n);", `<p v-if="seen > 0">{{ seen }}</p>`);
    expect(out).toContain("let s_seen = props.n;");
    expect(out).toContain("if s_seen as f64 > 0.0 {");
  });
});

describe("initial values setup runs on the server", () => {
  const source = (setup: string, template: string): string => `<script setup lang="ts">
import { onMounted, onServerPrefetch, reactive, ref, shallowReactive, watch, watchEffect, type Ref } from "vue";
import { useClipboard, useDebounceFn, useElementSize } from "some-composables";
const props = defineProps<{ a: number }>();
const n = ref(0);
const f = ref(false);
const list = ref<string[]>(["b", "a"]);
${setup}
</script>
<template>${template}</template>`;
  const refusal = (setup: string, template = `<p>{{ n }}<b v-if="f">yes</b>{{ list.length }}</p>`): GenError => {
    try {
      compile(island(source(setup, template)));
    } catch (e) {
      if (e instanceof GenErrors) return e.errors[0] as GenError;
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it.each([
    ["an assignment to a ref", "const x = (n.value = 5);\nconst y = [(f.value = true)];", "FV0105", /an assignment in the initial value of `x`/],
    ["`++` of a ref", "const x = n.value++;", "FV0105", /`\+\+` or `--` in the initial value of `x`/],
    ["an assignment through another name of a ref", "const m = n;\nconst z = (m.value = 3);", "FV0105", /an assignment in the initial value of `z`/],
    ["an assignment in a destructured value", "const [a] = [(n.value = 2)];", "FV0105", /an assignment in the initial value of `a`/],
    ["an assignment in an object literal", "const o = { a: (n.value = 2) };", "FV0105", /an assignment in the initial value of `o`/],
    ["an index assignment", 'const b = (list.value[0] = "z");', "FV0105", /an assignment in the initial value of `b`/],
    ["`watchEffect`", "const stop = watchEffect(() => { n.value = 7; });", "FV0103", /`watchEffect` in the initial value of `stop` runs once on the server/],
    ["`watch` with `immediate`", "const stop = watch(() => props.a, (v) => { n.value = v; }, { immediate: true });", "FV0102", /`watch` with `immediate` runs on the server/],
    ["`onServerPrefetch`", "const h = onServerPrefetch(() => { f.value = true; });", "FV0104", /`onServerPrefetch` fetches on the server/],
    ["a function of setup that assigns a ref it is given", "function bump(r: Ref<number>) { r.value = 5; }\nconst x = bump(n);", "FV0105", /^components\/X\.vue:9:11: `bump\(\)`, which runs an assignment, in the initial value of `x`/],
    ["a function of setup that pushes to a list it is given", 'function add(l: string[]) { l.push("b"); }\nconst x = add(list.value);', "FV0105", /`add\(\)`, which runs `push\(\)` of a value of setup/],
    ["a function of setup that gives a library a ref it is given", 'import { mutate } from "some-lib";\nfunction g(r: unknown) { return mutate(r); }\nconst x = g(n);', "FV0105", /`g\(\)`, which runs `mutate\(\)`, given a value of setup/],
    ["`Object.assign` of a ref", "const z = Object.assign(n, { value: 8 });", "FV0105", /`assign\(\)`, given a value of setup, in the initial value of `z`/],
    ["a method of an object of setup", "const o = { set() { n.value = 4; } };\nconst y = o.set();", "FV0105", /`set\(\)` of a value of setup in the initial value of `y`/],
    ["`push` to a reactive object's list", 'const s = reactive({ items: ["a"] });\nconst a = s.items.push("b");', "FV0105", /`push\(\)` of a value of setup/],
    ["`push` to a shallow reactive object's list", "const s = shallowReactive({ items: [1] });\nconst a = s.items.push(2);", "FV0105", /`push\(\)` of a value of setup/],
    ["an assignment to a reactive object", 'const s = reactive({ label: "x" });\nconst c = (s.label = "y");', "FV0105", /an assignment in the initial value of `c`/],
    ["`splice` of a ref's list", "const b = list.value.splice(0, 1);", "FV0105", /`splice\(\)` of a value of setup/],
    ["`delete` of a reactive object's field", "const o = reactive<{ k?: number }>({ k: 1 });\nconst x = delete o.k;", "FV0105", /`delete` in the initial value of `x`/],
    ["an assignment in a callback a list method runs", "const items = ref([{ done: false }]);\nconst x = items.value.map((i) => { i.done = true; return i; });", "FV0105", /an assignment in the initial value of `x`/],
    ["an assignment to a `let` of setup in a callback", "let total = 0;\nconst x = [1, 2].forEach((v) => { total += v; });", "FV0105", /an assignment in the initial value of `x`/],
    ["a library's call given a callback that assigns a ref", 'import { runNow } from "some-lib";\nconst x = runNow(() => { n.value = 3; });', "FV0105", /an assignment in the initial value of `x`/],
    ["a library's call given a function of setup that assigns a ref", 'import { runNow } from "some-lib";\nfunction set() { n.value = 3; }\nconst x = runNow(set);', "FV0105", /`set\(\)`, which runs an assignment, in the initial value of `x`/],
    ["a library's call given a ref", 'import { runNow } from "some-lib";\nconst x = runNow(n);', "FV0105", /`runNow\(\)`, given a value of setup, in the initial value of `x`/],
    ["an emit", 'const emit = defineEmits<{ "update:modelValue": [v: number] }>();\nconst x = emit("update:modelValue", 5);', "FV0105", /`emit\(\)` in the initial value of `x`/],
    ["an assignment to a `defineModel` ref", "const model = defineModel<number>({ default: 0 });\nconst x = (model.value = 5);", "FV0105", /an assignment in the initial value of `x`/],
  ])("refuses %s", (_, setup, code, message) => {
    const e = refusal(setup);
    expect(e.code).toBe(code);
    expect(e.message).toMatch(message);
    expect(e.message).toMatch(/^components\/X\.vue:\d+:\d+: /);
  });

  it.each([
    ["a template ref and a hook", "const el = ref<HTMLElement | null>(null);\nconst stop = onMounted(() => { el.value?.focus(); });"],
    ["event handlers", "const onClick = () => { n.value++; };\nconst handlers = { click: () => { n.value++; } };\nfunction reset() { n.value = 0; }"],
    ["a `watch` without `immediate`", "const stop = watch(n, () => { f.value = true; });"],
    ["composables given no state, or a template ref", "const el = ref<HTMLElement | null>(null);\nconst { copy } = useClipboard();\nconst { width } = useElementSize(el);"],
    ["a composable given a callback that reads state, or a function of setup that does", "const log = useDebounceFn(() => console.log(n.value, list.value.length), 100);\nfunction twice(x: number) { return x * 2; }\nconst later = useDebounceFn(twice, 100);"],
    ["copies sorted or reversed", "const sorted = [...list.value].sort();\nconst back = list.value.slice().reverse();\nconst clone = JSON.parse(JSON.stringify(list.value));"],
    ["a timer that writes later", "const t = setTimeout(() => { n.value++; }, 10);"],
    ["a function that writes only its own values", 'const made = (() => { const m = new Map<string, number>(); m.set("a", 1); return m; })();\nconst at = Date.now();'],
  ])("compiles %s it does not render", (_, setup) => {
    expect(compile(island(source(setup, `<p>{{ n }}<b v-if="f">yes</b>{{ list.length }}</p>`))).get("x.rs")).toContain("pub fn render");
  });
});
