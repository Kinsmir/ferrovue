/* The generator refuses what it cannot translate.
 *
 * Each case here is a component Vue renders one way and a careless translation would render
 * another, without failing: the conformance suite only catches it if some fixture happens to
 * exercise the construct. So each must be an error naming it instead. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generate } from "../src/compiler.ts";

/** Every project a case made, removed after it. */
const roots: string[] = [];

/** The configuration every case here compiles under. */
const CONFIG = { components: "components", out: "out" };

const compile = (project: string) => generate(project, CONFIG);

/** A project holding one component, `X.vue`, with this source, and any others named. */
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

describe("the generator", () => {
  it("translates a component inside its vocabulary", () => {
    const out = compile(
      island(`<script setup lang="ts">
const props = defineProps<{ label: string }>();
</script>
<template><b :title="label">{{ label }}</b></template>`),
    );
    expect(out.get("x.rs")).toContain("pub fn render");
  });

  it("reserves a loop's markup per item and the text the props hold", () => {
    const out = compile(
      island(`<script setup lang="ts">
const props = defineProps<{ label: string; items: string[] }>();
</script>
<template><ul :title="label"><li v-for="i in items">{{ i }}</li></ul></template>`),
    ).get("x.rs")!;
    const reserve = out.split("\n").find((l) => l.includes("out.reserve("))!;
    expect(reserve).toMatch(/\d+ \* \(props\.items\)\.len\(\)/);
    expect(reserve).toContain("props.label.len()");
    expect(reserve).toContain("props.items.iter().map(|v| v.len()).sum::<usize>()");
  });

  describe("child components", () => {
    const child = `<script setup lang="ts">
export interface Props { label: string; count?: number }
defineProps<Props>();
</script>
<template><b>{{ label }}</b></template>`;

    it("writes an exported `interface Props` once, as the props struct", () => {
      const out = compile(island(child)).get("x.rs")!;
      expect(out.match(/pub struct Props/g)).toHaveLength(1);
    });

    it("hands a v-bind of the child's own Props straight to it", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
import type { Props as ChildProps } from "./Child.vue";
const props = defineProps<{ inner?: ChildProps }>();
</script>
<template><div><Child v-if="inner" v-bind="inner" /></div></template>`;
      const out = compile(island(parent, { Child: child })).get("x.rs")!;
      expect(out).toContain("pub inner: Option<super::child::Props<'a>>,");
      expect(out).toMatch(/if let Some\((n\d+)\) = props\.inner\.as_ref\(\) \{\s*super::child::render\(out, \1\);/);
    });

    it("borrows each item of a list of the child's Props", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
import type { Props as ChildProps } from "./Child.vue";
const props = defineProps<{ items: ChildProps[] }>();
</script>
<template><ul><Child v-for="item in items" v-bind="item" /></ul></template>`;
      const out = compile(island(parent, { Child: child })).get("x.rs")!;
      expect(out).toContain("let item = item_ref;");
      expect(out).toContain("super::child::render(out, item);");
      expect(out).not.toContain("use std::borrow::Cow;");
    });

    it("refuses a prop the child does not declare, which would fall through as an attribute", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
defineProps<{ a: string }>();
</script>
<template><div><Child :label="a" :colour="a" /></div></template>`;
      expect(() => compile(island(parent, { Child: child }))).toThrow(/`colour` is not a prop of Child/);
    });

    it("refuses a child left without a prop it requires", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
defineProps<{ a: string }>();
</script>
<template><div><Child :count="1" /></div></template>`;
      expect(() => compile(island(parent, { Child: child }))).toThrow(/Child requires `label`/);
    });

    it("hands a child an array literal, and an empty one as an empty list", () => {
      const lister = `<script setup lang="ts">
export interface Props { items: string[] }
defineProps<Props>();
</script>
<template><ul><li v-for="i in items">{{ i }}</li></ul></template>`;
      const parent = `<script setup lang="ts">
import Lister from "./Lister.vue";
defineProps<{ a: string }>();
</script>
<template><div><Lister :items="[]" /><Lister :items="['a', a]" /></div></template>`;
      const out = compile(island(parent, { Lister: lister })).get("x.rs")!;
      expect(out).toContain("items: Vec::new()");
      expect(out).toContain('items: (["a", &*props.a]).iter().map(|v| std::borrow::Cow::Borrowed(&**v)).collect()');
    });

    it("refuses an object of the parent's own type where the child declares its own", () => {
      const card = `<script setup lang="ts">
interface User { name: string }
defineProps<{ user: User }>();
</script>
<template><b>{{ user.name }}</b></template>`;
      const parent = `<script setup lang="ts">
import Card from "./Card.vue";
interface User { name: string }
defineProps<{ user: User }>();
</script>
<template><div><Card :user="user" /></div></template>`;
      expect(() => compile(island(parent, { Card: card }))).toThrow(/share a type only when both import it from one `.ts` file/);
    });

    it("renders Suspense's default content in place", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><Suspense><p>{{ a }}</p></Suspense></div></template>`),
      ).get("x.rs")!;
      expect(out).toContain('out.push_str("<div><p>");');
    });

    it("refuses a v-bind of anything but the child's own Props", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
interface Other { label: string }
const props = defineProps<{ other: Other }>();
</script>
<template><div><Child v-bind="other" /></div></template>`;
      expect(() => compile(island(parent, { Child: child }))).toThrow(/`v-bind` of Child's own `Props`/);
    });
  });

  describe("narrowing", () => {
    it("binds an optional object a v-if found present, and reads it inside the branch", () => {
      const out = compile(
        island(`<script setup lang="ts">
interface Embed { provider: string }
const props = defineProps<{ embed?: Embed }>();
</script>
<template><p v-if="embed">{{ embed.provider }}</p></template>`),
      ).get("x.rs")!;
      expect(out).toMatch(/if let Some\((n\d+)\) = props\.embed\.as_ref\(\) \{[\s\S]*fv::escape_into\(out, &\*\1\.provider\)/);
    });

    it("keeps JavaScript's truthiness for an optional string: empty is not taken", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ note?: string }>();
</script>
<template><p v-if="note">{{ note }}</p></template>`),
      ).get("x.rs")!;
      expect(out).toContain(".filter(|v| !(*v).is_empty())");
    });

    it("counts a list with .length and joins strings with +", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ items: string[]; name: string }>();
</script>
<template><ul v-if="items.length" :title="'list of ' + name"><li v-for="i in items">{{ i }}</li></ul></template>`),
      ).get("x.rs")!;
      expect(out).toContain("((props.items).len() as i64)");
      expect(out).toContain('format!("{}{}", "list of ", &*props.name)');
    });

    it("adds two numbers, and refuses + between a number and anything but a string", () => {
      const sum = compile(
      island(`<script setup lang="ts">
const props = defineProps<{ n: number; m: number }>();
</script>
<template><b :title="n + m"></b></template>`),
    ).get("x.rs")!;
    expect(sum).toContain("(props.n + props.m)");
    expect(() =>
      compile(
        island(`<script setup lang="ts">
const props = defineProps<{ n: number; on: boolean }>();
</script>
<template><b :title="n + on"></b></template>`),
      ),
    ).toThrow(/`\+` joins a string to a string or a number, or adds two numbers/);
    });
  });

  describe("conditions", () => {
    it("negates the whole truthiness test, never the number inside it", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ items: string[]; note?: string }>();
</script>
<template><p v-if="!items.length">none</p><p v-if="!items.length || note">either</p></template>`),
      ).get("x.rs")!;
      expect(out).toContain("if !((((props.items).len() as i64)) != 0) {");
      expect(out).not.toMatch(/if !\(\(\(props\.items\)\.len\(\) as i64\)\) != 0/);
    });
  });

  describe("v-html", () => {
    const trusted = `<script setup lang="ts">
import type { TrustedHtml } from "ferrovue/types";
const props = defineProps<{ body: TrustedHtml; extra?: TrustedHtml }>();
</script>
<template><div class="md" v-html="body"></div><aside v-html="extra"></aside></template>`;

    it("writes a TrustedHtml prop raw, as the configured Rust type", () => {
      const out = generate(island(trusted), { ...CONFIG, trustedHtml: "crate::sanitize::SafeHtml" }).get("x.rs")!;
      expect(out).toContain("pub body: crate::sanitize::SafeHtml,");
      expect(out).toContain("pub extra: Option<crate::sanitize::SafeHtml>,");
      expect(out).toContain("fv::trusted_into(out, &props.body);");
      expect(out).toMatch(/if let Some\(html\) = props\.extra\.as_ref\(\) \{\s*fv::trusted_into\(out, html\);/);
    });

    it("refuses a TrustedHtml prop when the configuration names no Rust type for it", () => {
      expect(() => compile(island(trusted))).toThrow(/`trustedHtml` in ferrovue\.config\.json/);
    });

    it("refuses v-html on a plain string", () => {
      const source = `<script setup lang="ts">
const props = defineProps<{ body: string }>();
</script>
<template><div v-html="body"></div></template>`;
      expect(() => generate(island(source), { ...CONFIG, trustedHtml: "crate::sanitize::SafeHtml" })).toThrow(
        /`v-html` renders only a `TrustedHtml` prop/,
      );
    });

    it("trusts only the TrustedHtml that ferrovue/types exports", () => {
      const source = `<script setup lang="ts">
import type { TrustedHtml } from "./somewhere-else";
const props = defineProps<{ body: TrustedHtml }>();
</script>
<template><div v-html="body"></div></template>`;
      expect(() => generate(island(source), { ...CONFIG, trustedHtml: "crate::sanitize::SafeHtml" })).toThrow(
        /unsupported prop type `TrustedHtml`/,
      );
    });
  });

  describe("slots", () => {
    const frame = `<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><div><slot name="head">{{ title }}</slot><slot /></div></template>`;

    it("gives a component with <slot> a Slots argument, one optional field per slot", () => {
      const out = compile(island(frame)).get("x.rs")!;
      expect(out).toContain("pub head: Option<fv::Slot<'s>>,");
      expect(out).toContain("pub default: Option<fv::Slot<'s>>,");
      expect(out).toContain("pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>)");
      expect(out).not.toContain("pub fn island");
    });

    it("decides at generation time when slot content always holds something", () => {
      const parent = `<script setup lang="ts">
import Frame from "./Frame.vue";
const props = defineProps<{ on: boolean }>();
</script>
<template><Frame title="t"><template #head><b v-if="on">h</b></template><i>body</i></Frame></template>`;
      const out = compile(island(parent, { Frame: frame })).get("x.rs")!;
      expect(out).toContain("head: Some(fv::Slot::markup(&|out: &mut String| -> bool {");
      expect(out).toContain("default: Some(fv::Slot::new(&|out: &mut String| {");
    });

    it("reads $slots.x as whether the parent gave that slot content", () => {
      const source = `<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><div><aside v-if="$slots.side"><slot name="side" /></aside></div></template>`;
      expect(compile(island(source)).get("x.rs")).toContain("if (fv_slots.side.is_some()) {");
      const unknown = source.replace("$slots.side", "$slots.other");
      expect(() => compile(island(unknown))).toThrow(/`\$slots\.other` names a slot this template does not render/);
    });

    const lister = `<script setup lang="ts">
defineProps<{ items: string[] }>();
</script>
<template><ul><li v-for="(it, i) in items"><slot name="item" :text="it" :index="i">{{ it }}</slot></li></ul></template>`;

    it("gives a scoped slot a props struct, and its content the props through a closure", () => {
      const out = compile(island(lister)).get("x.rs")!;
      expect(out).toContain("pub struct ItemSlotProps<'v> {\n    pub text: &'v str,\n    pub index: i64,\n}");
      expect(out).toContain("pub type ItemSlot<'s> = dyn for<'v> Fn(&mut String, &ItemSlotProps<'v>) -> bool + 's;");
      expect(out).toContain("pub item: Option<&'s ItemSlot<'s>>,");
      expect(out).toContain("fv::scoped_slot_into(out, fv_slots.item, &ItemSlotProps { text: it, index: i }, Some(");
    });

    it("binds the props a parent destructures, whatever order it generates in", () => {
      const parent = `<script setup lang="ts">
import Lister from "./Lister.vue";
defineProps<{ items: string[] }>();
</script>
<template><Lister :items="items"><template #item="{ text, index: n }"><b :data-n="n">{{ text }}</b></template></Lister></template>`;
      // `A` sorts before `Lister`: the child is still generated first.
      const out = compile(island(lister, { A: parent, Lister: lister })).get("a.rs")!;
      expect(out).toMatch(/item: Some\(&\|out: &mut String, (fv_sp\d+): &super::lister::ItemSlotProps<'_>\| -> bool \{/);
      expect(out).toMatch(/fv::escape_into\(out, fv_sp\d+\.text\);/);
    });

    it("refuses outlets of one slot that pass different props", () => {
      const twice = `<script setup lang="ts">
defineProps<{ a: string; n: number }>();
</script>
<template><div><slot :v="a" /><slot :v="n" /></div></template>`;
      expect(() => compile(island(twice))).toThrow(/every `<slot>` passes the same props/);
    });

    it("refuses an array literal as a slot prop", () => {
      const literal = `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><slot :list="[a]" /></div></template>`;
      expect(() => compile(island(literal))).toThrow(/a slot prop is not an array literal/);
    });

    it("refuses slot props a slot does not pass, and defaults for them", () => {
      const plain = `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><slot /></div></template>`;
      const taker = `<script setup lang="ts">
import Plain from "./Plain.vue";
defineProps<{ a: string }>();
</script>
<template><Plain a="x" v-slot="{ v }">{{ v }}</Plain></template>`;
      expect(() => compile(island(taker, { Plain: plain }))).toThrow(/`<slot>` in Plain passes no props/);
      const defaulted = `<script setup lang="ts">
import Lister from "./Lister.vue";
defineProps<{ items: string[] }>();
</script>
<template><Lister :items="items"><template #item="{ text = 'x' }">{{ text }}</template></Lister></template>`;
      expect(() => compile(island(defaulted, { Lister: lister }))).toThrow(/without defaults/);
    });

    it("refuses content for a slot the child does not have", () => {
      const parent = `<script setup lang="ts">
import Frame from "./Frame.vue";
defineProps<{ on: boolean }>();
</script>
<template><Frame title="t"><template #foot>f</template></Frame></template>`;
      expect(() => compile(island(parent, { Frame: frame }))).toThrow(/Frame has no slot `foot`/);
    });
  });

  describe("the router", () => {
    const withRoutes = (root: string) => {
      writeFileSync(join(root, "routes.json"), JSON.stringify(["/", "/users/:id"]));
      return generate(root, { ...CONFIG, routes: "routes.json" });
    };
    const nav = `<script setup lang="ts">
export interface Props { href: string }
defineProps<Props>();
</script>
<template><nav><RouterLink :to="href" class="tab">go</RouterLink></nav></template>`;

    it("resolves a RouterLink against the route, and hands the route down to it", () => {
      const parent = `<script setup lang="ts">
import Nav from "./Nav.vue";
defineProps<{ href: string }>();
</script>
<template><header><Nav :href="href" /></header></template>`;
      const out = withRoutes(island(parent, { Nav: nav }));
      expect(out.get("nav.rs")).toContain("let fv_link = fv_route.link(&*props.href);");
      expect(out.get("x.rs")).toContain("pub fn render(out: &mut String, props: &Props<'_>, fv_route: &fv::Route<'_>)");
      expect(out.get("x.rs")).toContain(", fv_route);");
      expect(out.get("route_table.rs")).toContain('"/users/:id",');
    });

    it("refuses a RouterLink when the configuration names no routes", () => {
      expect(() => compile(island(nav))).toThrow(/`routes` in ferrovue\.config\.json/);
    });

    it("refuses a custom RouterLink, which renders a scoped slot", () => {
      const custom = `<script setup lang="ts">
defineProps<{ href: string }>();
</script>
<template><RouterLink :to="href" custom>go</RouterLink></template>`;
      expect(() => withRoutes(island(custom))).toThrow(/`custom` on `<RouterLink>`/);
    });

    const named = (root: string, router: Record<string, unknown> = {}) => {
      writeFileSync(join(root, "routes.json"), JSON.stringify([{ path: "/", name: "home" }, { path: "/users/:id", name: "user" }]));
      return generate(root, { ...CONFIG, router: { routes: "routes.json", ...router } });
    };
    const linkTo = (to: string) => `<script setup lang="ts">
defineProps<{ id: string }>();
</script>
<template><RouterLink :to="${to}">go</RouterLink></template>`;

    it("resolves a named route with its parameters, and writes the base and class names configured", () => {
      const out = named(island(linkTo("{ name: 'user', params: { id } }")), { base: "/app/", linkActiveClass: "on", linkExactActiveClass: "here" });
      expect(out.get("x.rs")).toContain('fv_route.link_named("user", &[("id", &*props.id)], "", "")');
      expect(out.get("x.rs")).toContain('if fv_link.active { "on" } else { "" }, if fv_link.active { "here" } else { "" }');
      expect(out.get("route_table.rs")).toContain('pub const BASE: &str = "/app/";');
      expect(out.get("route_table.rs")).toContain('("/users/:id", Some("user")),');
    });

    it("refuses a route name no route has", () => {
      expect(() => named(island(linkTo("{ name: 'nobody' }")))).toThrow(/no route is called `nobody`/);
    });

    it("refuses a named location without every parameter, or with one the route lacks", () => {
      expect(() => named(island(linkTo("{ name: 'user' }")))).toThrow(/route `user` needs `id`/);
      expect(() => named(island(linkTo("{ name: 'user', params: { id, page: id } }")))).toThrow(/route `user` has no parameter `page`/);
    });

    it("reads the route's path, hash, name and parameters, and refuses the rest", () => {
      const reader = (field: string) => `<script setup lang="ts">
import { useRoute } from "vue-router";
defineProps<{ a: string }>();
const route = useRoute();
</script>
<template><p>{{ route.${field} }}</p></template>`;
      expect(named(island(reader("params.id"))).get("x.rs")).toContain('fv_route.param("id")');
      expect(() => named(island(reader("query.q")))).toThrow(/`route.query` is not available on the server/);
    });

    it("writes RouterView as the page the server supplies, and refuses it below the top", () => {
      const app = `<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><main><RouterView /></main></template>`;
      expect(withRoutes(island(app)).get("x.rs")).toContain("fv_slots.router_view.render_to(out);");
      const parent = `<script setup lang="ts">
import App from "./App.vue";
defineProps<{ title: string }>();
</script>
<template><div><App title="t" /></div></template>`;
      expect(() => withRoutes(island(parent, { App: app }))).toThrow(/renders it at the top/);
    });
  });

  describe("Pinia stores", () => {
    const store = `import { defineStore } from "pinia";
export interface PrefsState { density: string; wide: boolean }
export const usePrefs = defineStore("prefs", { state: (): PrefsState => ({ density: "classic", wide: false }) });
`;
    const withStore = (root: string, source = store) => {
      mkdirSync(join(root, "stores"), { recursive: true });
      writeFileSync(join(root, "stores", "prefs.ts"), source);
      return generate(root, { ...CONFIG, stores: "stores" });
    };
    const reader = `<script setup lang="ts">
import { storeToRefs } from "pinia";
import { usePrefs } from "../stores/prefs";
defineProps<{ title: string }>();
const prefs = usePrefs();
const { wide } = storeToRefs(prefs);
</script>
<template><p :class="prefs.density" :data-wide="wide">{{ title }}</p></template>`;

    it("reads a store's state from the Stores the server is given, and hands it down", () => {
      const parent = `<script setup lang="ts">
import Reader from "./Reader.vue";
defineProps<{ title: string }>();
</script>
<template><div><Reader :title="title" /></div></template>`;
      const out = withStore(island(parent, { Reader: reader }));
      expect(out.get("reader.rs")).toContain("&*fv_stores.prefs.density");
      expect(out.get("reader.rs")).toContain("if fv_stores.prefs.wide");
      expect(out.get("x.rs")).toContain("fv_stores: &super::stores::Stores<'_>");
      expect(out.get("stores.rs")).toContain("pub prefs: PrefsState<'a>,");
    });

    it("refuses a store whose state has no declared type", () => {
      const untyped = store.replace("(): PrefsState =>", "() =>");
      expect(() => withStore(island(reader), untyped)).toThrow(/declares its return type/);
    });

    it("refuses a setup store, whose state it cannot see", () => {
      const setup = `import { defineStore } from "pinia";
export const usePrefs = defineStore("prefs", () => ({}));
`;
      expect(() => withStore(island(reader), setup)).toThrow(/option store/);
    });

    it("refuses storeToRefs of anything but a store bound in setup", () => {
      const wrong = reader.replace("storeToRefs(prefs)", "storeToRefs(usePrefs())");
      expect(() => withStore(island(wrong))).toThrow(/`storeToRefs` takes a store bound in this setup/);
    });

    it("refuses a field the store's state does not have", () => {
      const getter = reader.replace("prefs.density", "prefs.doubled");
      expect(() => withStore(island(getter))).toThrow(/`PrefsState` has no field `doubled`/);
    });

    it("translates a getter of the state where a component reads it", () => {
      const withGetter = store.replace("});\n", `, getters: { label: (s) => s.density + "!" } });\n`);
      const out = withStore(island(reader.replace("prefs.density", "prefs.label")), withGetter);
      expect(out.get("x.rs")).toContain('format!("{}{}", &*fv_stores.prefs.density, "!")');
    });

    it("refuses a getter that reads `this`, or returns a function", () => {
      const viaThis = store.replace("});\n", `, getters: { label(): string { return this.density; } } });\n`);
      expect(() => withStore(island(reader.replace("prefs.density", "prefs.label")), viaThis)).toThrow(/reads `this`/);
      const fn = store.replace("});\n", `, getters: { label: (s) => (x: string) => x } });\n`);
      expect(() => withStore(island(reader.replace("prefs.density", "prefs.label")), fn)).toThrow(/returns a function/);
    });
  });

  describe("attributes and text", () => {
    it("renders `:hidden` by the value's type, which Vue decides only at run time", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ on: boolean }>();
</script>
<template><p :hidden="on">x</p></template>`),
      ).get("x.rs")!;
      expect(out).toMatch(/if \(props\.on\) \{\s*out\.push_str\(" hidden"\);/);
    });

    it("counts a string's length in UTF-16 code units, as JavaScript does", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ name: string }>();
</script>
<template><p>{{ name.length }}</p></template>`),
      ).get("x.rs")!;
      expect(out).toContain("fv::js_length(&*props.name)");
      expect(out).not.toContain("(&*props.name).len()");
    });
  });

  describe("styles", () => {
    it("merges a static style, a binding and v-show, the last value of a property winning", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ on: boolean; c: string }>();
</script>
<template><p style="display: block; color: red" :style="{ color: c }" v-show="on">x</p></template>`),
      ).get("x.rs")!;
      // `display` stays first, where the static style put it, with v-show's value when it hides.
      expect(out).toMatch(/if !\(\(props\.on\)\) \{\s*out\.push_str\("display:none;"\);\s*\} else \{\s*out\.push_str\("display:block;"\);/);
      expect(out).toContain("fv::escape_into(out, &*props.c);");
    });

    it("allows a global <style> block, which changes no markup", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ a }}</i></template>
<style>i { color: red }</style>`),
      ).get("x.rs")!;
      expect(out).toContain("pub fn render");
    });
  });

  describe("helpers", () => {
    const config = {
      ...CONFIG,
      helpers: {
        module: "./helpers",
        functions: { plural: { rust: "crate::helpers::plural", params: ["int" as const], returns: "string" as const, maxLen: 1 } },
      },
    };

    it("calls a helper's Rust twin and reserves what it can write", () => {
      const out = generate(
        island(`<script setup lang="ts">
import { plural } from "./helpers";
const props = defineProps<{ n: number }>();
</script>
<template><p>item{{ plural(n) }}</p></template>`),
        config,
      ).get("x.rs")!;
      expect(out).toContain("fv::escape_into(out, crate::helpers::plural(props.n));");
    });

    it("refuses a helper with no Rust twin", () => {
      const source = `<script setup lang="ts">
import { shout } from "./helpers";
const props = defineProps<{ n: number }>();
</script>
<template><p>{{ shout(n) }}</p></template>`;
      expect(() => generate(island(source), config)).toThrow(/`shout` has no Rust twin/);
    });

    it("refuses a helper called with the wrong number of arguments", () => {
      const source = `<script setup lang="ts">
import { plural } from "./helpers";
const props = defineProps<{ n: number }>();
</script>
<template><p>{{ plural(n, n) }}</p></template>`;
      expect(() => generate(island(source), config)).toThrow(/`plural` takes 1 argument/);
    });
  });

  describe("output", () => {
    const source = `<script setup lang="ts">
const props = defineProps<{ label: string; note?: string }>();
</script>
<template><b v-if="note">{{ note }}</b><i v-if="note">{{ label }}</i></template>`;

    it("is the same on every run", () => {
      const project = island(source);
      expect(compile(project)).toEqual(compile(project));
    });

    it("marks every file as generated, naming its source", () => {
      for (const [name, text] of compile(island(source))) {
        expect(text.startsWith("// @generated by ferrovue from "), name).toBe(true);
      }
    });

    it("numbers narrowed bindings per component, so one file's text depends on its own source", () => {
      const alone = compile(island(source)).get("x.rs");
      const beside = compile(island(source, { A: source })).get("x.rs");
      expect(beside).toBe(alone);
    });
  });

  const refused: [string, string, RegExp][] = [
    [
      "destructured props gathered with a rest element",
      `<script setup lang="ts">
const { color = "slate", ...rest } = defineProps<{ color?: string; size: string }>();
</script>
<template><span :title="color"></span></template>`,
      /`\.\.\.rest` has no Rust type/,
    ],
    [
      "a runtime props declaration, which has no types",
      `<script setup lang="ts">
defineProps(["label"]);
</script>
<template><span></span></template>`,
      /declared with a type/,
    ],
    [
      "a default that is not a literal",
      `<script setup lang="ts">
const label = "x";
withDefaults(defineProps<{ title?: string }>(), { title: () => label });
</script>
<template><span>{{ title }}</span></template>`,
      /the default of `title` must be a literal/,
    ],
    [
      "watchEffect, which runs on the server",
      `<script setup lang="ts">
import { watchEffect } from "vue";
defineProps<{ a: string }>();
watchEffect(() => {});
</script>
<template><span></span></template>`,
      /`watchEffect` runs once on the server/,
    ],
    [
      "an immediate watcher, which runs on the server",
      `<script setup lang="ts">
import { watch } from "vue";
const props = defineProps<{ a: string }>();
watch(() => props.a, () => {}, { immediate: true });
</script>
<template><span></span></template>`,
      /`watch` with `immediate` runs on the server/,
    ],
    [
      "a setup statement that changes state",
      `<script setup lang="ts">
import { ref } from "vue";
const props = defineProps<{ label: string }>();
const shown = ref("");
shown.value = props.label;
</script>
<template><b>{{ shown }}</b></template>`,
      /could change what renders/,
    ],
    [
      "a setup binding it cannot evaluate, named like a prop",
      `<script setup lang="ts">
const props = defineProps<{ label: string }>();
const label = props.label.split(",");
</script>
<template><i>{{ label }}</i></template>`,
      /`label` is set up in a way the server cannot evaluate/,
    ],
    [
      "an interface whose name the generated Rust already uses",
      `<script setup lang="ts">
interface Option { label: string }
const props = defineProps<{ options: Option[] }>();
</script>
<template><i v-for="o in options">{{ o.label }}</i></template>`,
      /an interface called `Option` would hide Rust's own `Option`/,
    ],
    [
      "a comparison with null",
      `<script setup lang="ts">
const props = defineProps<{ note?: string }>();
</script>
<template><i v-if="note === null">x</i></template>`,
      /`null`/,
    ],
    [
      "an ordering comparison of strings, which JavaScript orders by UTF-16 code unit",
      `<script setup lang="ts">
const props = defineProps<{ a: string; b: string }>();
</script>
<template><i v-if="a < b">x</i></template>`,
      /`<` is supported between two numbers/,
    ],
    [
      "division, which gives a fraction",
      `<script setup lang="ts">
const props = defineProps<{ n: number }>();
</script>
<template><i>{{ n / 2 }}</i></template>`,
      /`\/` gives a fraction/,
    ],
    [
      "a remainder by a divisor that may be zero",
      `<script setup lang="ts">
const props = defineProps<{ n: number; m: number }>();
</script>
<template><i>{{ n % m }}</i></template>`,
      /`%` takes a literal divisor/,
    ],
    [
      "a fractional number",
      `<script setup lang="ts">
const props = defineProps<{ n: number }>();
</script>
<template><i :title="n + 0.5"></i></template>`,
      /only integer literals/,
    ],
    [
      "a ternary whose branches differ in type",
      `<script setup lang="ts">
const props = defineProps<{ n: number }>();
</script>
<template><i>{{ n ? n : "none" }}</i></template>`,
      /the two branches of `\?:` differ in type/,
    ],
    [
      "a prop type with no Rust twin",
      `<script setup lang="ts">
const props = defineProps<{ when: Date }>();
</script>
<template><i></i></template>`,
      /unsupported prop type `Date`/,
    ],
    [
      "a component without `<script setup>`",
      `<template><i>x</i></template>`,
      /needs `<script setup lang="ts">`/,
    ],
    [
      "a scoped `<style>`, whose attribute the bundler names",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ a }}</i></template>
<style scoped>i { color: red }</style>`,
      /`<style scoped>`/,
    ],
    [
      "a CSS module, whose class names the bundler chooses",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ a }}</i></template>
<style module>.i { color: red }</style>`,
      /`<style module>`/,
    ],
    [
      "v-bind() in a style block",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a }}</i></template>
<style>i { color: v-bind(a) }</style>`,
      /`v-bind\(\)` in `<style>`/,
    ],
    [
      "a style property whose place would depend on a condition",
      `<script setup lang="ts">
defineProps<{ on: boolean }>();
</script>
<template><i :style="[on ? { color: 'red' } : null, { width: '1px' }, { color: 'blue' }]"></i></template>`,
      /the place of style property `color` would depend on a condition/,
    ],
    [
      "a component resolved by name rather than imported",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><Unknown :a="a" /></div></template>`,
      /must be imported, or be this one/,
    ],
    [
      "a function call the server has no twin for",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.split(",") }}</i></template>`,
      /`\.split\(\)` is not supported/,
    ],
    [
      "a Teleport, whose content the page must place",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><Teleport to="body"><p>{{ a }}</p></Teleport></div></template>`,
      /`<Teleport>` renders its content into a separate buffer/,
    ],
    [
      "a dynamic component",
      `<script setup lang="ts">
defineProps<{ tag: string }>();
</script>
<template><div><component :is="tag" /></div></template>`,
      /`<component :is>` chooses its component at run time/,
    ],
    [
      "a custom directive the configuration does not declare client-only",
      `<script setup lang="ts">
const vFocus = { mounted: (el: HTMLElement) => el.focus() };
defineProps<{ a: string }>();
</script>
<template><input v-focus /></template>`,
      /custom directive `v-focus` may add attributes.*`clientDirectives`/,
    ],
    [
      "null in a prop's type",
      `<script setup lang="ts">
defineProps<{ a: string | null }>();
</script>
<template><i>{{ a }}</i></template>`,
      /`null` in a type/,
    ],
  ];

  for (const [what, source, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(() => compile(island(source))).toThrow(message);
    });
  }
});
