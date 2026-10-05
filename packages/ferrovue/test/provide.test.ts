import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Config, GenError, generate } from "../src/compiler.ts";
import { type Code } from "../src/errors.ts";

const roots: string[] = [];

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

const KEYS = `import type { InjectionKey, Ref } from "vue";
export interface TabsState { active: string; count: number }
export const ThemeKey: InjectionKey<string> = Symbol("theme");
export const CountKey: InjectionKey<Ref<number>> = Symbol("count");
export const TabsKey = Symbol("tabs") as InjectionKey<TabsState>;
export const PickKey: InjectionKey<(name: string) => void> = Symbol("pick");
export const Bare = Symbol("bare");
`;

function project(components: Record<string, string>, extra: Partial<Config> = {}): Map<string, string> {
  const root = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(root);
  mkdirSync(join(root, "components"), { recursive: true });
  mkdirSync(join(root, "types"), { recursive: true });
  writeFileSync(join(root, "types", "keys.ts"), KEYS);
  writeFileSync(join(root, "routes.json"), JSON.stringify(["/"]));
  for (const [name, text] of Object.entries(components)) writeFileSync(join(root, "components", `${name}.vue`), text);
  return generate(root, { components: "components", out: "out", ...extra });
}

const sfc = (script: string, template: string, props = "defineProps<{ label: string }>();") => `<script setup lang="ts">
import { computed, inject, provide, reactive, ref } from "vue";
import { CountKey, PickKey, TabsKey, ThemeKey, Bare } from "../types/keys";
${props}
${script}
</script>
<template>${template}</template>`;

const button = sfc('const theme = inject(ThemeKey, "light");', '<button :class="theme">{{ label }}</button>');

function refusal(components: Record<string, string>, extra: Partial<Config> = {}): GenError {
  try {
    project(components, extra);
  } catch (e) {
    if (e instanceof GenError) return e;
    throw e;
  }
  throw new Error("compiled without an error");
}

describe("provide and inject", () => {
  it("reads an injection from the context, with its default when no ancestor provides it", () => {
    const out = project({ X: button });
    expect(out.get("x.rs")).toContain("pub fn render(out: &mut String, props: &Props<'_>, fv_provides: super::provides::Provides<'_>) {");
    expect(out.get("x.rs")).toContain('fv_provides.theme_key.unwrap_or("light")');
    expect(out.get("x.rs")).not.toContain("pub fn island");
    expect(out.get("provides.rs")).toContain("pub struct Provides<'p> {\n    /// What is provided under `ThemeKey`, exported from `types/keys.ts`.\n    pub theme_key: Option<&'p str>,\n}");
  });

  it("overlays what a component provides on what it was given, and reads its own injections from what it was given", () => {
    const scope = sfc('const outer = inject(ThemeKey, "light");\nprovide(ThemeKey, props.label);\nprovide("size", 3);', '<div :title="outer"><Button label="in" /><slot /></div>', 'import Button from "./Button.vue";\nconst props = defineProps<{ label: string }>();');
    const out = project({ X: scope, Button: button }).get("x.rs")!;
    expect(out).toContain("let fv_inherited = fv_provides;");
    expect(out).toContain("let fv_provides = super::provides::Provides { theme_key: Some(&props.label), size: Some(3i64) };");
    expect(out).toContain('fv::escape_into(out, fv_inherited.theme_key.unwrap_or("light"));');
    expect(out).toContain("super::button::render(out, &super::button::Props { label: std::borrow::Cow::Borrowed(\"in\") }, fv_provides);");
    expect(out).toContain("pub type DefaultSlot<'s> = dyn Fn(&mut String, super::provides::Provides<'_>) -> bool + 's;");
    expect(out).toContain("fv::scoped_slot_into(out, fv_slots.default.map(|f| move |out: &mut String, _: &()| f(out, fv_provides)).as_ref(), &(), None);");
  });

  it("hands slot content the context of the component whose outlet renders it", () => {
    const layout = sfc('provide(ThemeKey, "dark");', "<main><slot /></main>");
    const page = sfc("", '<Layout label="l"><Button :label="label" /></Layout>', 'import Layout from "./Layout.vue";\nimport Button from "./Button.vue";\ndefineProps<{ label: string }>();');
    const out = project({ X: page, Layout: layout, Button: button }).get("x.rs")!;
    expect(out).toContain("default: Some(&|out: &mut String, fv_provides: super::provides::Provides<'_>| -> bool {");
  });

  it("leaves the context unread where nothing injected is used", () => {
    const out = project({ X: sfc('const theme = inject(ThemeKey, "light");', "<b>{{ label }}</b>") }).get("x.rs")!;
    expect(out).toContain("_fv_provides: super::provides::Provides<'_>");
    const provider = project({ X: sfc('provide(ThemeKey, "dark");', "<b>{{ label }}</b>") }).get("x.rs")!;
    expect(provider).not.toContain("let fv_provides");
    const every = project({ X: sfc("provide(ThemeKey, props.label);", "<nav><slot /></nav>", "const props = defineProps<{ label: string }>();") }).get("x.rs")!;
    expect(every).toContain("_fv_provides: super::provides::Provides<'_>");
    expect(every).toContain("let fv_provides = super::provides::Provides { theme_key: Some(&props.label) };");
  });

  it("builds a provided object as its interface, and treats a key holding a function as client-only", () => {
    const tabs = sfc('const active = computed(() => props.label);\nprovide(TabsKey, reactive({ active, count: 2 }));\nprovide(PickKey, (name: string) => name);', "<div><slot /></div>", "const props = defineProps<{ label: string }>();");
    const tab = sfc("const tabs = inject(TabsKey);\nconst pick = inject(PickKey, () => {});", '<b v-if="tabs?.active === label" @click="pick(label)">{{ tabs?.count }}</b>');
    const out = project({ X: tabs, Tab: tab });
    expect(out.get("x.rs")).toContain("let fv_provided_tabs_key = super::types::TabsState { active: std::borrow::Cow::Borrowed(s_active), count: 2i64 };");
    expect(out.get("tab.rs")).toContain("fv_provides.tabs_key.map(|v| &*v.active) == Some(&*props.label)");
    expect(out.get("provides.rs")).not.toContain("pick");
  });

  it("calls a factory default, and keeps a ref default as a ref", () => {
    const out = project({
      X: sfc('const tone = inject("tone", () => "plain", true);\nconst count = inject(CountKey, ref(0));\nconst doubled = computed(() => count.value * 2);', "<b>{{ tone }} {{ doubled }}</b>"),
    }).get("x.rs")!;
    expect(out).toContain('fv_provides.tone.unwrap_or("plain")');
    expect(out).toContain("fv_provides.count_key.unwrap_or(0i64)");
  });

  it("builds an object default as the key's interface, called once for a factory", () => {
    const out = project({
      X: sfc('const tabs = inject(TabsKey, { active: props.label, count: 1 });\nconst made = inject(TabsKey, () => ({ active: "made", count: 2 }), true);\nconst live = inject(TabsKey, reactive({ active: computed(() => props.label), count: 3 }));', "<b>{{ tabs.active }} {{ made.count }} {{ live.active }}</b>", "const props = defineProps<{ label: string }>();"),
    }).get("x.rs")!;
    expect(out).toContain("let fv_default_tabs = super::types::TabsState { active: std::borrow::Cow::Borrowed(&*props.label), count: 1i64 };");
    expect(out).toContain("let fv_default_made = super::types::TabsState { active: std::borrow::Cow::Borrowed(\"made\"), count: 2i64 };");
    expect(out).toContain("fv::escape_into(out, &fv_provides.tabs_key.unwrap_or(&fv_default_tabs).active);");
    expect(out).toContain("fv_provides.tabs_key.unwrap_or(&fv_default_live).active");
  });

  const refused: [string, Code, Record<string, string>, RegExp][] = [
    ["a key held in a local", "FV1601", { X: sfc('const key = "theme";\nconst theme = inject(key, "x");', "<b>{{ theme }}</b>") }, /an injection key is a string literal, or a `Symbol` exported/],
    ["a key a package exports", "FV1601", { X: sfc('const theme = inject(routerKey, "x");', "<b>{{ theme }}</b>", 'import { routerKey } from "vue-router";\ndefineProps<{ label: string }>();') }, /an injection key is a string literal/],
    ["a symbol without `InjectionKey<T>`", "FV1602", { X: sfc('const bare = inject(Bare, "x");', "<b>{{ bare }}</b>") }, /types\/keys\.ts:7:\d+: `Bare` names the type of what it is provided with/],
    ["`provide` with one argument", "FV1603", { X: sfc('provide("theme");', "<b />") }, /`provide` takes a key and a value/],
    ["a destructured injection", "FV1604", { X: sfc("const { active } = inject(TabsKey, reactive({ active: '', count: 0 }));", "<b>{{ active }}</b>") }, /what `inject` returns is bound to a name/],
    ["`inject(key)!`", "FV1605", { X: sfc("const tabs = inject(TabsKey)!;", "<b>{{ tabs.active }}</b>") }, /`!` asserts that an ancestor provides `TabsKey`/],
    ["a string key with no type", "FV1606", { X: sfc('const theme = inject("theme");', "<b>{{ theme }}</b>") }, /`"theme"` has no type here: give `inject` a type argument/],
    ["a function default without the factory flag", "FV1607", { X: sfc('const tone = inject("tone", () => "plain");', "<b>{{ tone }}</b>") }, /pass `true` as the third argument/],
    ["one key given two types", "FV1608", { X: sfc('provide("size", props.label);', "<Y />", 'import Y from "./Y.vue";\nconst props = defineProps<{ label: string }>();'), Y: sfc('const size = inject<number>("size");', "<b>{{ size }}</b>", "") }, /every `provide` and `inject` of a key agree on its type/],
    ["a provided value that may be absent", "FV1609", { X: sfc("provide(ThemeKey, props.note);", "<b />", "const props = defineProps<{ note?: string }>();") }, /fall back with `\?\?` before providing it/],
    ["a list computed in place", "FV1610", { X: sfc('provide("rows", props.rows.filter((r) => r !== ""));', "<b />", "const props = defineProps<{ rows: string[] }>();") }, /a provided list is one the component holds/],
    ["an object under a string key", "FV1611", { X: sfc('provide("tabs", { active: "a" });', "<b />") }, /an object is provided under `"tabs"`, which has no declared type/],
    ["an object default under a key that holds a string", "FV1611", { X: sfc('const theme = inject(ThemeKey, { name: "x" });', "<b>{{ theme }}</b>") }, /an object is given as a default under `ThemeKey`, which holds a string/],
    ["an object default under a string key without a type", "FV1611", { X: sfc('const tabs = inject("tabs", { active: "a" });', "<b>{{ tabs }}</b>") }, /an object is given as a default under `"tabs"`, which has no declared type/],
    ["an object default with a field its interface lacks", "FV1612", { X: sfc('const tabs = inject(TabsKey, { active: "a", count: 1, extra: 2 });', "<b>{{ tabs.active }}</b>") }, /`TabsState` has no field `extra`/],
    ["an object default missing a required field", "FV1612", { X: sfc('const tabs = inject(TabsKey, () => ({ active: "a" }), true);', "<b>{{ tabs.active }}</b>") }, /`TabsState` requires `count`/],
    ["a ref inside a plain object default", "FV1612", { X: sfc('const active = ref("a");\nconst tabs = inject(TabsKey, { active, count: 1 });', "<b>{{ tabs.active }}</b>") }, /`active` is a ref, which a plain object keeps as one/],
    ["a method in an object default", "FV1612", { X: sfc('const tabs = inject(TabsKey, { active: "a", count: 1, pick() {} });', "<b>{{ tabs.active }}</b>") }, /an object given as a default holds plain keys and values/],
    ["a ref inside a plain provided object", "FV1612", { X: sfc('const active = ref("a");\nprovide(TabsKey, { active, count: 1 });', "<b />") }, /`active` is a ref, which a plain object keeps as one/],
    ["a provided object with a field its interface lacks", "FV1612", { X: sfc('provide(TabsKey, { active: "a", count: 1, extra: 2 });', "<b />") }, /`TabsState` has no field `extra`/],
    ["a plain default for a key provided as a ref", "FV1613", { X: sfc("const count = inject(CountKey, 0);", "<b>{{ count }}</b>") }, /`CountKey` is provided as a ref, and this default is not one/],
    ["a key provided twice", "FV1614", { X: sfc('provide(ThemeKey, "a");\nprovide(ThemeKey, "b");', "<b />") }, /`ThemeKey` is provided twice by X/],
    ["two keys with one field name", "FV1615", { X: sfc('provide(ThemeKey, "a");\nprovide("theme-key", "b");', "<b />") }, /`"theme-key"` and `ThemeKey` would both be the field `theme_key`/],
    ["a provider that holds RouterView", "FV1616", { X: sfc('provide(ThemeKey, "a");', "<main><RouterView /></main>") }, /X holds `<RouterView>`, whose page is rendered from Rust/],
    ["an assignment to an injected value", "FV1618", { X: sfc('const tabs = inject(TabsKey);\ntabs.active = "b";', "<b />") }, /setup assigns to `tabs`, which an ancestor provides/],
    ["a function and a value under one key", "FV1619", { X: sfc('provide("pick", (n: string) => n);', "<Y />", 'import Y from "./Y.vue";\ndefineProps<{ label: string }>();'), Y: sfc('provide("pick", "value");', "<b />", "") }, /`"pick"` is provided with a function elsewhere, and with a value here/],
    ["`inject` inside a provided value", "FV1620", { X: sfc('provide(ThemeKey, inject(ThemeKey, "x"));', "<b />") }, /`inject` is called at the top of `<script setup>`/],
  ];

  for (const [what, code, components, message] of refused) {
    it(`refuses ${what}`, () => {
      const e = refusal(components, { routes: "routes.json" });
      expect(e.message).toMatch(message);
      expect(e.code).toBe(code);
      expect(e.at?.line).toBeGreaterThan(0);
    });
  }

  it("refuses a `provide` not imported from vue, which it cannot tell from a function of another library", () => {
    const e = refusal({ X: '<script setup lang="ts">\ndefineProps<{ label: string }>();\nprovide("theme", "dark");\n</script>\n<template><b>{{ label }}</b></template>' });
    expect(e.code).toBe("FV0105");
  });

  it("refuses a string key injected inside a Rust twin's slot, and allows a symbol there", () => {
    const twins = { twins: { VCard: { rust: "crate::ui::v_card", slots: ["default"] } } };
    const page = (child: string) => sfc("", `<VCard><${child} label="in" /></VCard>`, `import { VCard } from "vuetify/components";\nimport ${child} from "./${child}.vue";\ndefineProps<{ label: string }>();`);
    const sized = sfc('const size = inject<number>("size", 1);', "<b>{{ size }}</b>");
    const e = refusal({ X: page("Sized"), Sized: sized }, twins);
    expect(e.code).toBe("FV1617");
    expect(e.message).toMatch(/Sized injects `"size"`, in the slot of VCard, a Rust twin/);
    expect(project({ X: page("Button"), Button: button }, twins).get("x.rs")).toContain("super::button::render(out");
  });
});
