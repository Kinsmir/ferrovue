import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenError, GenErrors, generate } from "../src/compiler.ts";
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

function sfc(script: string, template: string, style = ""): string {
  return `<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>\n${style}`;
}

const Y = sfc("defineProps<{ b?: string }>();", "<b>y{{ b }}<slot /></b>");
const Z = sfc("", '<i>z<slot name="x" /></i>');

function compiled(files: Record<string, string>): Map<string, string> {
  return generate(project({ "Y.vue": Y, "Z.vue": Z, ...files }), { components: "components", out: "out" });
}

function render(script: string, template: string, files: Record<string, string> = {}): string {
  const out = compiled({ "X.vue": sfc(script, template), ...files }).get("x.rs")!;
  return /pub fn try_render[\s\S]*?\n}\n/.exec(out)![0];
}

function errors(files: Record<string, string>): GenError[] {
  try {
    compiled(files);
  } catch (e) {
    if (e instanceof GenErrors) return e.errors.filter((one): one is GenError => one instanceof GenError);
    if (e instanceof GenError) return [e];
    throw e;
  }
  throw new Error("compiled without an error");
}

function refusals(script: string, template: string, files: Record<string, string> = {}): string[] {
  return errors({ "X.vue": sfc(script, template), ...files }).map((e) => `${e.code} ${e.what}`);
}

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

const OPEN =
  "`<component :is>` renders a closed set of choices: imported components, element names, a `computed` or `?:` choosing among them, a prop typed as a union of string literals, or an object of imported components read by such a prop";
const NOT_ONE = `FV0418 ${OPEN}; this value is not one of those`;
const TAG = 'defineProps<{ tag: "b" | "i" }>();';

const element = (name: string, tag: string, indent = "    ") =>
  [
    `let ${name} = match props.tag { ${tag} };`,
    "out.push('<');",
    `out.push_str(${name});`,
    'out.push_str("></");',
    `out.push_str(${name});`,
    "out.push('>');",
  ]
    .map((line) => `${indent}${line}`)
    .join("\n");

const BI = element("fv_tag1", 'XTag::B => "b", XTag::I => "i"');

const Y_ALONE = `super::y::try_render(out, &super::y::Props { b: None }, super::y::Slots {
        default: None,
    })?;`;

describe("the prop `<component :is>` reads", () => {
  it("reads a prop through `props`, a destructured name and a `computed` of either", () => {
    expect(render('const props = defineProps<{ tag: "b" | "i" }>();', '<component :is="props.tag" />')).toMatch(like(BI));
    expect(render('const { tag } = defineProps<{ tag: "b" | "i" }>();', '<component :is="tag" />')).toMatch(like(BI));
    const choice = (script: string) => render(`import { computed } from "vue";\n${script}`, '<component :is="c" />');
    const inner = (tag: string) => `    if props.on {\n${element("fv_tag1", 'XTag::B => "b", XTag::I => "i"', "        ").replace("props.tag", tag)}\n    } else {\n        out.push_str("<u></u>");\n    }`;
    expect(choice('const { tag, on } = defineProps<{ tag: "b" | "i"; on: boolean }>();\nconst c = computed(() => (on ? tag : "u"));')).toMatch(like(inner("props.tag")));
    expect(choice('const { tag: t, on } = defineProps<{ tag: "b" | "i"; on: boolean }>();\nconst c = computed(() => (on ? t : "u"));')).toMatch(like(inner("props.tag")));
    expect(choice('const { tag: t = "b", on } = defineProps<{ tag?: "b" | "i"; on: boolean }>();\nconst c = computed(() => (on ? t : "u"));')).toMatch(like(inner("props.tag.unwrap_or(XTag::B)")));
    expect(choice('const props = defineProps<{ tag: "b" | "i"; on: boolean }>();\nconst c = computed(() => (props.on ? props.tag : "u"));')).toMatch(like(inner("props.tag")));
    expect(render('import Y from "./Y.vue";\nconst props = defineProps<{ tag: "b" | "i"; on: boolean }>();', '<component :is="on ? Y : props.tag" />')).toMatch(like(
      `    if props.on {\n        ${Y_ALONE.replaceAll("\n    ", "\n        ")}\n    } else {\n${element("fv_tag1", 'XTag::B => "b", XTag::I => "i"', "        ")}\n    }`,
    ));
  });

  it("refuses a name that is no prop", () => {
    expect(refusals('const props = defineProps<{ tag: "b" | "i" }>();', '<component :is="props.other" />')).toEqual([NOT_ONE]);
    expect(refusals('const { tag } = { tag: "b" };\ndefineProps<{ x: string }>();', '<component :is="tag" />')).toEqual([NOT_ONE]);
    expect(refusals('import { computed } from "vue";\nconst props = defineProps<{ tag: "b" | "i" }>();\nconst c = computed(() => [{ tag: "b" }].map((props) => props.tag)[0]);', '<component :is="c" />')).toEqual([NOT_ONE]);
    expect(render('import { computed } from "vue";\nconst x = { tag: "b" };\nconst { tag } = defineProps<{ tag: "b" | "i" }>();\nconst c = computed(() => x.tag);', '<component :is="c" />')).toMatch(like('out.push_str("<b></b>");'));
    expect(refusals('defineProps<{ tags: ("b" | "i")[] }>();', '<component v-for="tag in tags" :is="tag" />')).toEqual([NOT_ONE]);
    expect(refusals('defineProps<{ tag: "b" | "i"; tags: string[] }>();', '<component v-for="tag in tags" :is="tag" />')).toEqual([NOT_ONE]);
    expect(refusals('const { tag } = defineProps<{ tag: "b" | "i"; tags: string[] }>();', '<component v-for="tag in tags" :is="tag" />')).toEqual([NOT_ONE]);
  });

  it("reads the literals of the prop's type, through parentheses, template literals and aliases", () => {
    const tagOf = (script: string) => render(script, '<component :is="tag" />');
    expect(tagOf('type T = ("b" | "i");\ndefineProps<{ tag: (T) }>();')).toMatch(like(element("fv_tag1", 'T::B => "b", T::I => "i"')));
    expect(tagOf("defineProps<{ tag: `b` | `i` }>();")).toMatch(like(BI));
    expect(tagOf('type A = "b" | "i";\ndefineProps<{ tag: A | "b" }>();')).toMatch(like(BI));
    expect(tagOf('interface P { tag: "b" | "i" }\ndefineProps<P>();')).toMatch(like(element("fv_tag1", 'PTag::B => "b", PTag::I => "i"')));
    expect(tagOf('export interface P { tag: "b" | "i" }\ndefineProps<P>();')).toMatch(like(element("fv_tag1", 'PTag::B => "b", PTag::I => "i"')));
    expect(tagOf('type P = { tag: "b" | "i" };\ndefineProps<P>();')).toMatch(like(element("fv_tag1", 'PTag::B => "b", PTag::I => "i"')));
    expect(tagOf('interface Q { tag: string }\ninterface P { tag: "b" | "i" }\ndefineProps<P>();')).toMatch(like(element("fv_tag1", 'PTag::B => "b", PTag::I => "i"')));
    expect(tagOf('enum Tag { B = "b", I = "i" }\ndefineProps<{ tag: Tag }>();')).toMatch(like(element("fv_tag1", 'Tag::B => "b", Tag::I => "i"')));
    expect(render('import type { Tag } from "./p";\ndefineProps<{ tag: Tag }>();', '<component :is="tag" />', { "p.ts": 'export type Tag = "b" | "i";' })).toMatch(like(element("fv_tag1", 'super::types::Tag::B => "b", super::types::Tag::I => "i"')));
    expect(tagOf('let x;\nconst props = defineProps<{ tag: "b" | "i" }>();\nconst y = 1;')).toMatch(like(BI));
    expect(tagOf('withDefaults(defineProps<{ tag?: "b" | "i" }>(), { tag: "i" });')).toMatch(like(element("fv_tag1", 'XTag::B => "b", XTag::I => "i"').replace("match props.tag", "match props.tag.unwrap_or(XTag::I)")));
  });

  it("refuses a prop whose type is no union of string literals, or which may be absent", () => {
    expect(refusals("defineProps<{ tag: `b${string}` }>();", '<component :is="tag" />')).toEqual([`FV0418 ${OPEN}; \`tag\` is not typed as a union of string literals, as \`"h1" | "h2"\``]);
    expect(refusals('defineProps<{ tag?: "b" | "i" }>();', '<component :is="tag" />')).toEqual(["FV0420 `tag` may be absent, where Vue renders `<!---->` or fails: make it required, or give it a default"]);
  });
});

describe("the elements `<component :is>` names", () => {
  const refusedTag = (tag: string) => `FV0419 \`${tag}\` is not an HTML element \`<component :is>\` renders: name an HTML element other than \`<textarea>\`, \`<template>\` and \`<slot>\`, or bind an imported component`;

  it("renders a string literal and a template literal without expressions", () => {
    expect(render("", "<component :is=\"'b'\" />")).toMatch(like('out.push_str("<b></b>");'));
    expect(render("", '<component :is="`b`" />')).toMatch(like('out.push_str("<b></b>");'));
  });

  it("refuses an element that is no HTML element, a reserved tag, or the component itself", () => {
    for (const tag of ["my-x", "template", "slot", "component", "textarea"]) expect(refusals("", `<component :is="'${tag}'" />`)).toEqual([refusedTag(tag)]);
    expect(errors({ "Table.vue": sfc("", "<component :is=\"'table'\" />") }).map((e) => `${e.code} ${e.what}`)).toEqual([refusedTag("table")]);
    expect(errors({ "table.vue": sfc("", "<component :is=\"'table'\" />") }).map((e) => `${e.code} ${e.what}`)).toEqual([refusedTag("table")]);
    expect(refusals('defineProps<{ x: string }>();', '<component :is="`b${x}`" />')).toEqual([NOT_ONE]);
  });
});

describe("components and tables `<component :is>` chooses among", () => {
  const T = 'import Y from "./Y.vue";\nconst T = { a: Y, b: "em" };';
  const byKey = `    match props.k {
        XK::A => {
            super::y::try_render(out, &super::y::Props { b: None }, super::y::Slots {
                default: None,
            })?;
        }
        XK::B => {
            out.push_str("<em></em>");
        }
    }`;

  it("reads a table by a literal key, and by a prop", () => {
    expect(render(T, '<component :is="T.a" />')).toMatch(like(Y_ALONE));
    expect(render(T, "<component :is=\"T['b']\" />")).toMatch(like('out.push_str("<em></em>");'));
    expect(render(`${T}\ndefineProps<{ k: "a" | "b" }>();`, '<component :is="T[k]" />')).toMatch(like(byKey));
    expect(render(`${T}\nconst props = defineProps<{ k: "a" | "b" }>();`, '<component :is="T[props.k]" />')).toMatch(like(byKey));
    expect(render('import Y from "./Y.vue";\nconst T = { a: Y as typeof Y, b: "em" } as const;\ndefineProps<{ k: "a" | "b" }>();', '<component :is="T[k]" />')).toMatch(like(byKey));
    expect(render('import Y from "./Y.vue";\nconst T = { 1: Y, "b": "em" };\ndefineProps<{ k: "1" | "b" }>();', '<component :is="T[k]" />')).toMatch(like(byKey.replace("XK::A", "XK::V1")));
  });

  const ts = { "t.ts": 'import Y from "./Y.vue";\nimport { ref } from "vue";\nexport const T = { a: Y, b: "em" };\nconst L = { a: Y };\nexport const N = 1;\nexport const R = ref(Y);\nexport let V = { a: Y };' };

  it("reads a table a `.ts` file exports", () => {
    expect(render('import { T } from "./t";\ndefineProps<{ k: "a" | "b" }>();', '<component :is="T[k]" />', ts)).toMatch(like(byKey));
    expect(render('import { T as Q } from "./t";\nimport { ref } from "vue";\ndefineProps<{ k: "a" | "b" }>();', '<component :is="Q[k]" />', ts)).toMatch(like(byKey));
    expect(render('import { T } from "./t";', '<component :is="T.a" />', ts)).toMatch(like(Y_ALONE));
    expect(render('import { T } from "./t";', '<component :is="T.b" />', ts)).toMatch(like('out.push_str("<em></em>");'));
  });

  it("refuses a value that is no table it reads", () => {
    for (const script of ['import { L } from "./t";', 'import { N } from "./t";', 'import { R } from "./t";', 'import { V } from "./t";', 'import type { T } from "./t";', 'import { type T } from "./t";', 'import T from "./t";', 'import { T } from "./nope";']) {
      expect(refusals(script, `<component :is="${/\{ (?:type )?(\w)/.exec(script)?.[1] ?? "T"}.a" />`, ts)).toEqual([NOT_ONE]);
    }
    expect(refusals('import { T } from "./t";', '<component :is="T" />', ts)).toEqual([`FV0418 ${OPEN}; \`T\` is an object: read one of its components by key, as \`T[key]\``]);
    expect(refusals('import Y from "./Y.vue";\nconst T = [Y];\ndefineProps<{ k: "a" }>();', '<component :is="T[k]" />')).toEqual([NOT_ONE]);
    expect(refusals('import Y from "./Y.vue";\nconst T = { a: Y };\nconst k = "a";', '<component :is="T[k]" />')).toEqual([NOT_ONE]);
  });

  it("refuses a table with a key it lacks, keys it cannot read, or a value that is no component", () => {
    const notComponent = `FV0418 ${OPEN}; \`T.a\` is not a component imported from a \`.vue\` file among the components compiled, or an element name`;
    expect(refusals('import Y from "./Y.vue";\nconst T = { a: Y };', '<component :is="T.z" />')).toEqual(["FV0421 `z` is not a key of `T`, where Vue finds no component and renders `<!---->`"]);
    expect(refusals('import Y from "./Y.vue";\nconst T = { [1]: Y };', '<component :is="T[1]" />')).toEqual([`FV0418 ${OPEN}; \`T\` holds plain keys`]);
    expect(refusals('import Y from "./Y.vue";\nconst S = { a: Y };\nconst T = { ...S };\ndefineProps<{ k: "a" }>();', '<component :is="T[k]" />')).toEqual([`FV0418 ${OPEN}; \`T\` holds plain keys`]);
    expect(refusals('const T = { a: 1 };\ndefineProps<{ k: "a" }>();', '<component :is="T[k]" />')).toEqual([notComponent]);
    expect(refusals('const W = 1;\nconst T = { a: W };\ndefineProps<{ k: "a" }>();', '<component :is="T[k]" />')).toEqual([notComponent]);
    for (const t of ['import Q from "./Q.vue";\nexport const T = { a: Q };', 'import { Y } from "./Y.vue";\nexport const T = { a: Y };', 'import Y from "./Y";\nexport const T = { a: Y };', "export const T = { a: 1 };"]) {
      expect(refusals('import { T } from "./t";', '<component :is="T.a" />', { "t.ts": t })).toEqual([notComponent]);
    }
  });

  it("renders a component a `ref` or a stated type holds, and refuses a choice that refers to itself", () => {
    expect(render('import { ref } from "vue";\nimport Y from "./Y.vue";\nconst c = ref(Y);', '<component :is="c" />')).toMatch(like(Y_ALONE));
    expect(render('import Y from "./Y.vue";\nconst c = Y as typeof Y;', '<component :is="c" />')).toMatch(like(Y_ALONE));
    expect(refusals('import { computed } from "vue";\nconst c = computed(() => c);', '<component :is="c" />')).toEqual([NOT_ONE]);
    expect(refusals('import { computed } from "vue";\nconst a = computed(() => b);\nconst b = computed(() => a);', '<component :is="a" />')).toEqual([NOT_ONE]);
    expect(refusals('import Y from "./Y.vue";\ndefineProps<{ xs: string[] }>();', '<component v-for="Y in xs" :is="Y" />')).toEqual([NOT_ONE]);
  });
});

describe("rendering the choices", () => {
  it("renders the branch a test known when compiling takes", () => {
    expect(render('const ON = true;\nimport Y from "./Y.vue";', "<component :is=\"ON ? Y : 'b'\" />")).toMatch(like(Y_ALONE));
    expect(render('const ON = false;\nimport Y from "./Y.vue";', "<component :is=\"ON ? Y : 'b'\" />")).toMatch(like('out.push_str("<b></b>");'));
  });

  it("renders one choice where every key chooses it, and groups the keys of each choice", () => {
    const T = (table: string, keys = '"a" | "b"') => `import Y from "./Y.vue";\nimport Z from "./Z.vue";\nconst T = ${table};\ndefineProps<{ k: ${keys} }>();`;
    expect(render(T("{ a: Y, b: Y }"), '<component :is="T[k]" />')).toMatch(like(`pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {\n    out.reserve(1);\n    ${Y_ALONE}\n    Ok(())\n}\n`, true));
    expect(render(T('{ a: "em", b: "em" }'), '<component :is="T[k]">x</component>')).toMatch(like('out.push_str("<em>x</em>");'));
    expect(render(T('{ a: "br", b: "hr" }'), '<component :is="T[k]" />')).toMatch(like('    match props.k {\n        XK::A => {\n            out.push_str("<br>");\n        }\n        XK::B => {\n            out.push_str("<hr>");\n        }\n    }'));
    expect(render(T('{ a: "br", b: "em" }'), '<component :is="T[k]" />')).toMatch(like('    match props.k {\n        XK::A => {\n            out.push_str("<br>");\n        }\n        XK::B => {\n            out.push_str("<em></em>");\n        }\n    }'));
    expect(render(T('{ a: "em", b: "strong", c: "em", d: "u" }', '"a" | "b" | "c" | "d"'), '<component :is="T[k]" />')).toMatch(like(element("fv_tag1", 'XK::A | XK::C => "em", XK::B => "strong", XK::D => "u"').replace("props.tag", "props.k")));
    expect(render(T('{ a: Y, b: Z, c: Y, d: "em" }', '"a" | "b" | "c" | "d"'), '<component :is="T[k]" />')).toMatch(like(`    match props.k {
        XK::A | XK::C => {
            super::y::try_render(out, &super::y::Props { b: None }, super::y::Slots {
                default: None,
            })?;
        }
        XK::B => {
            super::z::try_render(out, &super::z::Props {  }, super::z::Slots {
                x: None,
            })?;
        }
        XK::D => {
            out.push_str("<em></em>");
        }
    }`));
  });

  it("writes the attributes, the default slot and the scope ids of an element", () => {
    expect(render('defineProps<{ tag: "b" | "i"; c: string }>();', '<component :is="tag" :class="c" id="x" text="t">t</component>')).toMatch(like(
      'out.push_str(" class=\\"");\n    fv::class_into(out, false, &[&*props.c]);\n    out.push_str("\\" id=\\"x\\" text=\\"t\\">t</");',
    ));
    expect(render(TAG, '<component :is="tag"><template #default>d</template><template #other>o</template></component>')).toMatch(like('out.push_str(">d</");'));
    expect(render(TAG, '<component :is="tag"><template #other>o</template></component>')).toMatch(like('out.push_str("></");'));
    const slotted = (style: string) =>
      compiled({ "X.vue": sfc('import W from "./W.vue";\ndefineProps<{ tag: "b" | "i" }>();', '<W><component :is="tag">t</component></W>', style), "W.vue": sfc("", "<p><slot /></p>", "<style scoped>:slotted(b) { color: red }</style>") }).get("x.rs")!;
    expect(slotted("")).toMatch(like('out.push_str(&fv::scope_attrs("", "", fv_sid1));'));
    expect(slotted("<style scoped>b { color: red }</style>")).toMatch(/out\.push_str\(&fv::scope_attrs\("", "data-v-\w+", \w+\)\);/);
  });

  it("marks the slot content an element fills", () => {
    expect(render('import V from "./V.vue";\ndefineProps<{ tag: "b" | "i" }>();', "<V><template v-if=\"tag === 'b'\"><component :is=\"tag\" /></template></V>", { "V.vue": sfc("", "<p><slot>vf</slot></p>") })).toMatch(like(
      '            if props.tag == XTag::B {\n                let fv_tag1 = match props.tag { XTag::B => "b", XTag::I => "i" };\n                filled = true;\n                out.push(\'<\');',
    ));
  });

  it("gives a chosen component the slots it takes", () => {
    expect(render('import Z from "./Z.vue";\nimport Y from "./Y.vue";\ndefineProps<{ on: boolean }>();', '<component :is="on ? Z : Y"><template #x>xx</template><template #default>dd</template></component>')).toMatch(like(`    if props.on {
        super::z::try_render(out, &super::z::Props {  }, super::z::Slots {
            x: Some(fv::Slot::new(&|out: &mut String| {
                out.push_str("xx");
            })),
        })?;
    } else {
        super::y::try_render(out, &super::y::Props { b: None }, super::y::Slots {
            default: Some(fv::Slot::new(&|out: &mut String| {
                out.push_str("dd");
            })),
        })?;
    }`));
    expect(render('import V from "./V.vue";\ndefineProps<{ on: boolean }>();', "<component :is=\"on ? V : 'i'\">c</component>", { "V.vue": sfc("", "<b>v</b>") })).toMatch(like(
      '    if props.on {\n        super::v::try_render(out, &super::v::Props {  })?;\n    } else {\n        out.push_str("<i>c</i>");\n    }',
    ));
  });
});

describe("content `<component :is>` renders from virtual nodes", () => {
  const tag = 'defineProps<{ tag: "b" | "i" }>();';
  const fallback = (name = "") => `FV0919 \`<slot${name}>\` has fallback content and is rendered inside an element \`<component :is>\` chooses, where Vue tests its content by other rules: move the fallback into the parent`;

  it("refuses `v-text` and `v-html` on it, wherever it is", () => {
    expect(refusals('defineProps<{ tag: "b" | "i"; s: string }>();', '<component :is="tag" v-text="s" />')).toEqual(["FV0422 `v-text` on `<component :is>`: Vue's server renders the element empty, which hydration then fills; put the content inside it"]);
    const [html] = errors({ "X.vue": sfc('defineProps<{ tag: "b" | "i"; s: string }>();', '<div>\n  <component :is="tag" v-html="s" /></div>') });
    expect(`${html!.code} ${html!.what}`).toBe("FV0422 `v-html` on `<component :is>`: Vue's server renders the element empty, which hydration then fills; put the content inside it");
    expect(html!.at).toMatchObject({ file: "components/X.vue", line: 5, column: 24 });
  });

  it("keeps `v-text` and `v-html` elsewhere, and refuses a choice it cannot read before its content", () => {
    const out = render('import type { InlineHtml } from "ferrovue/types";\ndefineProps<{ tag: "b" | "i"; s: string; h: InlineHtml }>();', '<p v-text="s" /><div v-html="h" /><component :is="tag" v-show="!!s" />');
    expect(out).toMatch(like('out.push_str("<!--[--><p>");\n    fv::escape_into(out, &props.s);\n    out.push_str("</p><div>");\n    fv::trusted_into(out, &props.h);'));
    expect(refusals('defineProps<{ tag: string; s: string }>();', '<component :is="tag" v-html="s" />')).toEqual([`FV0418 ${OPEN}; \`tag\` is not typed as a union of string literals, as \`"h1" | "h2"\``]);
  });

  it("refuses a named slot's fallback inside it, and a named slot both inside it and outside", () => {
    expect(refusals(tag, '<component :is="tag"><slot name="n">fb</slot></component>')).toEqual([fallback(' name="n"')]);
    expect(refusals(tag, '<component :is="tag"><slot name="n" /></component><p><slot name="n" /></p>')).toEqual([
      'FV0920 `<slot name="n">` is rendered both inside an element `<component :is>` chooses and outside one, where Vue renders the content it is given differently',
    ]);
    expect(render(tag, '<component :is="tag"><slot name="n" /></component><p><slot /></p>')).toMatch(like("fv::slot_into(out, fv_slots.default, None);"));
  });

  it("leaves the slot content an element does not render", () => {
    expect(render(tag, '<component :is="tag"><template #default><slot /></template><template #other><slot>fb</slot></template></component>')).toMatch(like("fv::slot_into(out, fv_slots.default, None);"));
  });

  it("follows slot content into a child that renders it inside such an element, and through a chosen component", () => {
    const W = sfc(tag, '<component :is="tag"><slot /></component>');
    const N = sfc(tag, '<component :is="tag"><slot name="n" /></component>');
    expect(refusals('import W from "./W.vue";', "<W><slot>fb</slot></W>", { "W.vue": W })).toEqual([fallback()]);
    expect(refusals('import W from "./W.vue";', "<W><template #n><slot>fb</slot></template></W>", { "W.vue": N })).toEqual([fallback()]);
    expect(errors({ "A.vue": sfc('import X from "./X.vue";', "<X><slot>fb</slot></X>"), "X.vue": sfc('import W from "./W.vue";', '<W tag="b"><slot /></W>'), "W.vue": W }).map((e) => `${e.code} ${e.what}`)).toEqual([fallback()]);
    expect(refusals('import W from "./W.vue";\nimport V from "./V.vue";\ndefineProps<{ on: boolean }>();', '<component :is="on ? W : V"><slot>fb</slot></component>', { "W.vue": W, "V.vue": sfc("", "<p><slot /></p>") })).toEqual([fallback()]);
  });

  it("leaves the slot content of a child that renders it as markup", () => {
    const U = sfc("", "<b><slot /></b>");
    const V = sfc("", '<p><slot /><slot name="n" /></p>');
    expect(render('import V from "./V.vue";\nimport U from "./U.vue";\ndefineProps<{ on: boolean }>();', '<component :is="on ? U : V"><slot>fb</slot></component>', { "U.vue": U, "V.vue": V })).toMatch(like("fv::Slot::markup"));
    expect(render('import V from "./V.vue";\ndefineProps<{ on: boolean }>();', "<component :is=\"on ? V : 'b'\"><template #n><slot>fb</slot></template></component>", { "V.vue": V })).toMatch(like("            n: Some(fv::Slot::markup("));
    expect(render('import V from "./V.vue";', '<V><slot>fb</slot></V>', { "V.vue": V })).toMatch(like("fv::Slot::markup"));
  });
});

describe("choices the analyses read", () => {
  it("renders the branch a `?:` known when compiling takes", () => {
    expect(render(TAG, "<component :is=\"false ? 'b' : 'i'\">x</component>")).toMatch(like('out.push_str("<i>x</i>");'));
    expect(render(TAG, "<component :is=\"true ? 'b' : 'i'\">x</component>")).toMatch(like('out.push_str("<b>x</b>");'));
  });

  it("hands the scope id of a scoped component to a child inside an element it chooses", () => {
    const files = {
      "X.vue": sfc(`import C from "./C.vue";\n${TAG}`, '<component :is="tag"><C /></component>', "<style scoped>b { color: red; }</style>\n"),
      "C.vue": sfc("", "<span>c</span>"),
    };
    const out = compiled(files);
    expect(out.get("c.rs")).toMatch(like('pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {\n    try_render_scoped(out, props, "")\n}'));
    expect(out.get("x.rs")).toMatch(/super::c::try_render_scoped\(out, &super::c::Props \{ {2}\}, " data-v-\w+"\)\?;/);
  });

  it("passes the route to a child a table of a `.ts` file chooses", () => {
    const made = project({
      "X.vue": sfc('import { VIEWS } from "./views";\ndefineProps<{ k: "c" | "d" }>();', '<component :is="VIEWS[k]" />'),
      "views.ts": 'import C from "./C.vue";\nimport D from "./D.vue";\nexport const VIEWS = { c: C, d: D };\n',
      "C.vue": sfc('import { useRoute } from "vue-router";\nconst route = useRoute();', "<span>{{ route.path }}</span>"),
      "D.vue": sfc("", "<em>d</em>"),
    });
    writeFileSync(join(made, "routes.json"), JSON.stringify([{ path: "/", name: "home" }]));
    const out = generate(made, { components: "components", out: "out", routes: "routes.json" }).get("x.rs")!;
    expect(out).toMatch(like("pub fn render(out: &mut String, props: &Props, fv_route: &fv::Route<'_>) {"));
    expect(out).toMatch(like("super::c::try_render(out, &super::c::Props {  }, fv_route)?;"));
  });

  it("reads a slot with fallback content in a twin's slot as rendered outside the element chosen", () => {
    const made = project({
      "X.vue": sfc(`import { VBtn } from "vuetify/components";\n${TAG}`, '<component :is="tag">a</component><VBtn label="x"><slot name="x">fb</slot></VBtn>'),
    });
    const out = generate(made, { components: "components", out: "out", twins: { VBtn: { rust: "crate::ui::v_btn", props: { label: "string" }, slots: ["default"] } } }).get("x.rs")!;
    expect(out).toMatch(like("pub fn render(out: &mut String, props: &Props, fv_slots: Slots<'_>) {"));
  });
});

describe("the props and tables `<component :is>` reads, checked a second time", () => {
  const C = sfc("", "<span>c</span>");
  const rendered = (script: string, template: string) => render(script, template, { "C.vue": C });
  const choice = "if props.on {\n        super::c::try_render(out, &super::c::Props {  })?;\n    } else {\n        out.push_str(\"<b></b>\");\n    }";

  it("reads a `computed` of choices through `satisfies` and `!`", () => {
    const pick = (body: string) => `import C from "./C.vue";\nimport { computed } from "vue";\nconst props = defineProps<{ on: boolean }>();\nconst pick = computed(() => ${body});`;
    expect(rendered(pick('(props.on ? C : "b") satisfies unknown'), '<component :is="pick" />')).toMatch(like(choice));
    expect(rendered(pick('(props.on ? C : "b")!'), '<component :is="pick" />')).toMatch(like(choice));
  });

  it("reads a field of a setup object named like a prop as the object's", () => {
    expect(rendered('import { computed } from "vue";\ndefineProps<{ tag: "b" | "i" }>();\nconst cfg = { tag: "u" };\nconst pick = computed(() => cfg.tag);', '<component :is="pick" />')).toMatch(like('out.push_str("<u></u>");'));
    expect(rendered('import C from "./C.vue";\nconst props = defineProps<{ c: "b" | "i" }>();\nconst VIEWS = { c: C };', '<component :is="VIEWS.c" />')).toMatch(like("super::c::try_render(out, &super::c::Props {  })?;"));
  });

  it("reads the prop's type from the interface or alias `defineProps` names, and its field by name", () => {
    expect(render('interface Props { tag: "b" | "i" }\ninterface Other { tag: string }\ndefineProps<Props>();', '<component :is="tag" />')).toMatch(like(BI));
    expect(render('type Props = { tag: "b" | "i" };\ntype Other = { tag: string };\ndefineProps<Props>();', '<component :is="tag" />')).toMatch(like(BI));
    expect(render('defineProps<{ other?: string; tag: "b" | "i" }>();', '<component :is="tag" />')).toMatch(like(BI));
  });

  it("refuses a prop typed as a union that holds other than string literals, a table with no value, and a table a `v-for` hides", () => {
    const untyped = `FV0418 ${OPEN}; \`tag\` is not typed as a union of string literals, as \`"h1" | "h2"\``;
    expect(refusals("defineProps<{ tag: 1 | 2 }>();", '<component :is="tag" />')).toEqual([untyped]);
    expect(refusals('defineProps<{ tag: "b" | string }>();', '<component :is="tag" />')).toEqual([untyped]);
    expect(refusals('defineProps<{ k: "c" | "d" }>();\nlet VIEWS;', '<component :is="VIEWS[k]" />')).toEqual([NOT_ONE]);
    expect(refusals('import C from "./C.vue";\ndefineProps<{ k: "c"; lists: Record<string, string>[] }>();\nconst VIEWS = { c: C };', '<template v-for="VIEWS in lists"><component :is="VIEWS[k]" /></template>', { "C.vue": C })).toEqual([NOT_ONE]);
  });
});

describe("the names `<component :is>` reads, against the setup's and the props'", () => {
  it("refuses a field of a `v-for` item named like a prop", () => {
    const item = "interface I { c: string }\ninterface J { x: I }\n";
    expect(refusals(`${item}const { c } = defineProps<{ c: "b" | "i"; items: I[] }>();`, '<template v-for="item in items"><component :is="item.c" /></template>')).toEqual([NOT_ONE]);
    expect(refusals(`${item}defineProps<{ c: "b" | "i"; items: I[] }>();`, '<template v-for="item in items"><component :is="item.c" /></template>')).toEqual([NOT_ONE]);
    expect(refusals(`${item}defineProps<{ c: "b" | "i"; items: J[] }>();`, '<template v-for="item in items"><component :is="item.x.c" /></template>')).toEqual([NOT_ONE]);
    expect(refusals(`${item}const props = defineProps<{ c: "b" | "i"; items: I[] }>();`, '<template v-for="props in items"><component :is="props.c" /></template>')).toEqual([NOT_ONE]);
  });

  it("reads a setup constant named like a prop as the constant", () => {
    expect(render('defineProps<{ c: "b" | "i" }>();\nconst c = "nav";', '<component :is="c" />')).toContain('out.push_str("<nav></nav>");');
  });

  it("reads a setup object named `$setup` or `_ctx` as no table", () => {
    expect(render('import Y from "./Y.vue";\nconst $setup = { c: "em" };\nconst c = Y;', '<component :is="c" />')).toMatch(like(Y_ALONE));
    expect(refusals('const _ctx = { x: "em" };', '<component :is="x" />')).toEqual([NOT_ONE]);
  });

  it("refuses the prop a model declares, whose type it does not read", () => {
    const untyped = `FV0418 ${OPEN}; \`modelValue\` is not typed as a union of string literals, as \`"h1" | "h2"\``;
    expect(refusals('const m = defineModel<"b" | "i">({ required: true });', '<component :is="modelValue" />')).toEqual([untyped]);
    expect(refusals('defineProps<{ x: string }>();\nconst m = defineModel<"b" | "i">({ required: true });', '<component :is="modelValue" />')).toEqual([untyped]);
  });

  it("refuses a field of a store's hook", () => {
    const made = project({ "X.vue": sfc('import { usePrefs } from "../stores/prefs";', '<component :is="usePrefs.a" />') });
    mkdirSync(join(made, "stores"));
    writeFileSync(join(made, "stores", "prefs.ts"), 'import { defineStore } from "pinia";\nexport interface PrefsState { a: string }\nexport const usePrefs = defineStore("prefs", { state: (): PrefsState => ({ a: "em" }) });\n');
    const refused = (): string[] => {
      try {
        generate(made, { components: "components", out: "out", stores: "stores" });
      } catch (e) {
        if (e instanceof GenErrors) return e.errors.filter((one): one is GenError => one instanceof GenError).map((one) => `${one.code} ${one.what}`);
        throw e;
      }
      return [];
    };
    expect(refused()).toEqual([NOT_ONE]);
  });
});

describe("the components `<component :is>` renders", () => {
  it("refuses a chosen component that is not compiled, and one missing a required prop, where the element is", () => {
    expect(refusals('import M from "./M.vue";', '<component :is="M" />')).toEqual(["FV0501 a child component must be imported from a `.vue` file among the components compiled, in components"]);
    const [missing] = errors({ "X.vue": sfc('import P from "./P.vue";', '<p>\n    <component :is="P" /></p>'), "P.vue": sfc("defineProps<{ p: string }>();", "<b>{{ p }}</b>") });
    expect(`${missing!.code} ${missing!.what}`).toBe("FV0506 P requires `p`");
    expect(missing!.at).toMatchObject({ file: "components/X.vue", line: 5, column: 1 });
  });

  it("refuses slots a chosen component is given by `v-if`", () => {
    expect(refusals('import Y from "./Y.vue";\ndefineProps<{ on: boolean }>();', "<component :is=\"on ? Y : 'b'\"><template v-if=\"on\" #default>d</template></component>")).toEqual(["FV0901 slots must be an object literal"]);
  });

  it("hands a chosen component the scope ids of its parent and of the slot it is in, and an element's outlet the slot's", () => {
    const scoped = "<style scoped>b { color: red; }</style>\n";
    const inSlot = compiled({ "X.vue": sfc('import W from "./W.vue";\nimport Y from "./Y.vue";', '<W><component :is="Y" /></W>', scoped), "W.vue": sfc("", "<p><slot /></p>") });
    expect(inSlot.get("x.rs")).toMatch(/fv_refusals\.join\(super::y::try_render_scoped\(out, &super::y::Props \{ b: None \}, super::y::Slots \{\n {16}default: None,\n {12}\}, " data-v-\w+"\)\);/);
    expect(inSlot.get("y.rs")).toMatch(like("pub fn try_render_scoped("));
    const slotted = compiled({ "X.vue": sfc('import W from "./W.vue";\nimport Y from "./Y.vue";', '<W><component :is="Y" /></W>'), "W.vue": sfc("", "<p><slot /></p>", "<style scoped>:slotted(b) { color: red }</style>") });
    expect(slotted.get("x.rs")).toMatch(like('fv_refusals.join(super::y::try_render_scoped(out, &super::y::Props { b: None }, super::y::Slots {\n                default: None,\n            }, &fv::scope_attrs("", "", fv_slot_id)));'));
    expect(slotted.get("y.rs")).toMatch(like("pub fn try_render_scoped("));
    const forwarded = compiled({ "X.vue": sfc(`import W from "./W.vue";\n${TAG}`, '<W><component :is="tag"><slot /></component></W>'), "W.vue": sfc("", "<p><slot /></p>", "<style scoped>:slotted(b) { color: red }</style>") });
    expect(forwarded.get("x.rs")).toMatch(like("fv::slot_into_slotted(out, fv_slots.default, fv_slot_id, None);"));
    const top = compiled({ "X.vue": sfc('import Y from "./Y.vue";', '<component :is="Y" />', scoped) }).get("x.rs")!;
    expect(top).toMatch(/super::y::try_render_scoped\(out, &super::y::Props \{ b: None \}, super::y::Slots \{\n {8}default: None,\n {4}\}, " data-v-\w+"\)\?;/);
  });
});

describe("`<component :is>` among the rest of a template", () => {
  it("writes only the branch a `?:` known when compiling takes", () => {
    const body = (inner: string) => `pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {\n    out.reserve(7);\n    ${inner}\n    Ok(())\n}\n`;
    expect(render("", "<component :is=\"false ? 'b' : 'i'\" />")).toMatch(like(body('out.push_str("<i></i>");'), true));
    expect(render("", "<component :is=\"true ? 'b' : 'i'\" />")).toMatch(like(body('out.push_str("<b></b>");'), true));
  });

  it("refuses a slot with no literal name inside an element it chooses as Vue's other slots", () => {
    expect(refusals('defineProps<{ tag: "b" | "i"; n: string }>();', '<component :is="tag"><slot :name="n">fb</slot></component>')).toEqual(["FV0912 a slot's name is literal"]);
  });

  it("reports every refusal of a template that holds one, and of the other components", () => {
    const unavailable = (name: string) => `FV0601 \`${name}\` is not available when rendering on the server`;
    expect(refusals('import Y from "./Y.vue";', '<component :is="Y" /><p>{{ a }}</p><p>{{ b }}</p>')).toEqual([unavailable("a"), unavailable("b")]);
    expect(refusals("", '<component :is="nope" /><p>{{ a }}</p>')).toEqual([NOT_ONE, unavailable("a")]);
    expect(errors({ "X.vue": sfc("", '<component :is="nope" />'), "A.vue": sfc("", "<p>{{ a }}</p>") }).map((e) => `${e.code} ${e.what}`)).toEqual([unavailable("a"), NOT_ONE]);
  });
});
