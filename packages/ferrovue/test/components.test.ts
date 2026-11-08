import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { generate } from "../src/compiler.ts";
import { oneLine } from "./code.ts";
import { CONFIG, compile, island } from "./project.ts";

describe("the generator", () => {
  describe("child components", () => {
    const child = `<script setup lang="ts">
export interface Props { label: string; count?: number }
defineProps<Props>();
</script>
<template><b>{{ label }}</b></template>`;

    describe("a struct, or a list of them, handed to a child", () => {
      const types = `export interface Tag { name: string; note?: string; weight: number }
export interface Row { id: number; label: string; tags: Tag[]; marks: number[]; best?: Tag; dict: Record<string, number> }
export interface Plain { id: number; on: boolean }`;
      const withTypes = (root: string, text: string): string => {
        writeFileSync(join(root, "types.ts"), text);
        return root;
      };
      const rows = `<script setup lang="ts">
import type { Row, Tag, Plain } from "../types";
defineProps<{ rows: Row[]; tag?: Tag; tags: Tag[]; plains: Plain[] }>();
</script>
<template><ul><li v-for="r in rows" :key="r.id">{{ r.label }}</li></ul></template>`;
      const parent = `<script setup lang="ts">
import type { Row, Tag, Plain } from "../types";
import Rows from "./Rows.vue";
const props = defineProps<{ rows: Row[]; tags: Tag[]; plains: Plain[] }>();
</script>
<template><Rows :rows="rows" :tag="rows[0]?.best" :tags="tags" :plains="plains" /><Rows v-for="r in rows" :key="r.id" :rows="[]" :tag="r.tags[0]" :tags="r.tags" :plains="[]" /></template>`;

      it("hands the child copies whose strings borrow from the parent's", () => {
        const out = compile(withTypes(island(parent, { Rows: rows }), types));
        const x = oneLine(out.get("x.rs")!);
        expect(x).toContain("tags: props.tags.iter().map(|v| v.borrowed()).collect()");
        expect(x).toContain("tags: fv_r.tags.iter().map(|v| v.borrowed()).collect()");
        expect(x).toContain("tag: props.rows.first().and_then(|fv_value| fv_value.best.as_ref()).map(|v| v.borrowed())");
        expect(x).toContain("tag: fv_r.tags.first().map(|v| v.borrowed())");
        expect(x).toContain("plains: props.plains.to_vec()");
        expect(x).toContain("rows: props.rows.iter().map(|v| v.borrowed()).collect()");
        expect(x).not.toMatch(/tags: [^,]*\.to_owned\(\)/);
        const shared = out.get("types.rs")!;
        expect(shared).toContain(`impl<'a> Tag<'a> {
    #[doc(hidden)]
    pub fn borrowed(&self) -> Tag<'_> {
        Tag {
            name: Cow::Borrowed(&*self.name),
            note: self.note.as_deref().map(Cow::Borrowed),
            weight: self.weight,
        }
    }
}`);
        expect(shared).toContain("            dict: self.dict.borrowed_with(|v| *v),\n");
        expect(shared).not.toContain("impl Plain {\n    #[doc(hidden)]");
      });

      it("clones within the borrowed copy a field of a type the project names, and the whole struct where that type borrows", () => {
        const held = `export interface Note { title: string; body: TrustedHtml; at: Date; marks: Record<string, Note[]> }`;
        const holder = `<script setup lang="ts">
import type { Note } from "../types";
defineProps<{ note: Note }>();
</script>
<template><b>{{ note.title }}</b></template>`;
        const notes = `<script setup lang="ts">
import type { Note } from "../types";
import Child from "./Child.vue";
defineProps<{ notes: Note[] }>();
</script>
<template><Child v-for="(n, i) in notes" :key="i" :note="n" /></template>`;
        const made = (config: object): Map<string, string> => generate(withTypes(island(notes, { Child: holder }), `import type { TrustedHtml } from "ferrovue/types";\n${held}`), { ...CONFIG, ...config });
        const own = made({ dateType: "crate::When", trustedHtml: "crate::Safe" });
        expect(oneLine(own.get("x.rs")!)).toContain("note: fv_n.borrowed()");
        expect(own.get("types.rs")).toContain("    #[doc(hidden)]\n    // A type the project names may be `Copy`.\n    #[allow(clippy::clone_on_copy)]\n    pub fn borrowed(&self) -> Note<'_> {\n");
        expect(own.get("types.rs")).toContain(`        Note {
            title: Cow::Borrowed(&*self.title),
            body: Clone::clone(&self.body),
            at: Clone::clone(&self.at),
            marks: self.marks.borrowed_with(|v| v.iter().map(|v| v.borrowed()).collect()),
        }`);
        for (const config of [{ dateType: "crate::When<'a>", trustedHtml: "crate::Safe" }, { dateType: "crate::When", trustedHtml: "crate::Safe<'a>" }]) {
          const out = made(config);
          expect(oneLine(out.get("x.rs")!), JSON.stringify(config)).toContain("note: fv_n.to_owned()");
          expect(out.get("types.rs"), JSON.stringify(config)).not.toContain("borrowed");
        }
      });

      it("writes no borrowed copy for a struct no child is handed", () => {
        const alone = `<script setup lang="ts">
import type { Tag } from "../types";
defineProps<{ tags: Tag[] }>();
</script>
<template><p v-for="t in tags" :key="t.name">{{ t.name }}</p></template>`;
        expect(compile(withTypes(island(alone), types)).get("types.rs")).not.toContain("borrowed");
      });
    });

    it("renders a child given no props", () => {
      const bare = `<script setup lang="ts">
defineProps<{ note?: string }>();
</script>
<template><i>{{ note }}</i></template>`;
      const parent = `<script setup lang="ts">
import Bare from "./Bare.vue";
defineProps<{ a: string }>();
</script>
<template><div><Bare /><span>{{ a }}</span></div></template>`;
      expect(compile(island(parent, { Bare: bare })).get("x.rs")).toContain("super::bare::try_render(out, &super::bare::Props { note: None })?;");
    });

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
      expect(out).toMatch(/if let Some\((fv_inner)\) = props\.inner\.as_ref\(\) \{\s*super::child::try_render\(out, \1\)\?;/);
    });

    it("borrows each item of a list of the child's Props", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
import type { Props as ChildProps } from "./Child.vue";
const props = defineProps<{ items: ChildProps[] }>();
</script>
<template><ul><Child v-for="item in items" v-bind="item" /></ul></template>`;
      const out = compile(island(parent, { Child: child })).get("x.rs")!;
      expect(out).toContain("for fv_item in props.items.iter() {");
      expect(out).toContain("super::child::try_render(out, fv_item)?;");
      expect(out).not.toContain("use std::borrow::Cow;");
    });

    it("hands a component rendering itself a v-bind of its own Props beside a listener, which the server skips", () => {
      const row = `<script setup lang="ts">
export interface Props { id: string; label: string; rows: Props[] }
defineProps<Props>();
const emit = defineEmits<{ loaded: [rows: Props[]] }>();
function take(row: Props, more: Props[]) {
  emit("loaded", [row, ...more]);
}
</script>
<template><div>{{ label }}<X v-for="r in rows" :key="r.id" v-bind="r" @loaded="(more) => take(r, more)" /></div></template>`;
      const out = compile(island(row)).get("x.rs")!;
      expect(out).toContain("super::x::try_render(out, fv_r)?;");
    });

    it("skips listeners beside a v-bind of the child's Props, in every form", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
import type { Props as ChildProps } from "./Child.vue";
const props = defineProps<{ items: ChildProps[]; ev: string }>();
function note() {}
const handlers = { click: note, Picked: note };
</script>
<template><ul>
  <Child v-for="item in items" v-bind="item" @picked="note" v-on:hover.once="note" @update:label="note" />
  <Child v-for="item in items" v-bind="item" v-on="handlers" />
  <Child v-for="item in items" v-bind="item" @[ev]="note" />
  <Child label="x" title="t" @[ev]="note" @click="note" />
</ul></template>`;
      const out = compile(island(parent, { Child: child })).get("x.rs")!;
      expect(out.match(/super::child::try_render(_scoped)?\(out, fv_item(_\d)?(, &fv::attrs::Attrs::NONE)?\)\?;/g)).toHaveLength(3);
      expect(out).toContain(`("title", fv::attrs::Attr::str("t"))`);
      expect(out).not.toMatch(/"on[A-Z]/);
    });

    it("gives a prop named like a listener the value bound to it, as Vue does", () => {
      const sale = `<script setup lang="ts">
defineProps<{ label: string; onSale?: boolean }>();
</script>
<template><b>{{ label }}<i v-if="onSale">!</i></b></template>`;
      const parent = `<script setup lang="ts">
import Sale from "./Sale.vue";
</script>
<template><div><Sale label="x" :on-sale="true" /></div></template>`;
      expect(compile(island(parent, { Sale: sale })).get("x.rs")).toContain("on_sale: Some(true)");
    });

    it("passes a key the child does not declare as an attribute, which falls through to its root", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
defineProps<{ a: string }>();
</script>
<template><div><Child :label="a" :colour="a" @click="() => {}" /></div></template>`;
      const out = compile(island(parent, { Child: child }));
      expect(out.get("x.rs")).toContain(`&fv::attrs::Attrs::new(&[("colour", fv::attrs::Attr::str(&props.a))], "")`);
      expect(out.get("child.rs")).toContain("pub fn try_render_scoped(out: &mut String, props: &Props<'_>, fv_attrs: &fv::attrs::Attrs<'_>) -> Result<(), fv::render::Refused>");
      expect(out.get("child.rs")).toContain(`fv::attrs::passed_attrs_into(out, fv_attrs.list(), "");`);
    });

    it("gives a kebab-case key to the camelCase prop it names, as Vue does", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><div><Child label="x" :co-unt="2" /></div></template>`;
      const counted = child.replace("count?: number", "coUnt?: number");
      const out = compile(island(parent, { Child: counted }));
      expect(out.get("x.rs")).toContain("co_unt: Some(2i64)");
      expect(out.get("child.rs")).not.toContain("fv::attrs::Attrs");
    });

    it("leaves a component no parent passes attributes as it was", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><div><Child label="x" /></div></template>`;
      const out = compile(island(parent, { Child: child }));
      expect(out.get("child.rs")).not.toContain("render_scoped");
      expect(out.get("x.rs")).toContain("super::child::try_render(out, ");
    });

    it("refuses an attribute that would reach a prop of the component a root passes it on to", () => {
      const wrapper = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><Child label="x" /></template>`;
      const parent = `<script setup lang="ts">
import W from "./W.vue";
</script>
<template><div><W count="2" /></div></template>`;
      expect(() => compile(island(parent, { W: wrapper, Child: child }))).toThrow(/`count`, an attribute W may be passed, would reach Child as its prop `count`/);
    });

    it("refuses a name like a listener's that would reach a prop of the component a root passes it on to", () => {
      const named = `<script setup lang="ts">
defineProps<{ on1?: number; onSale?: boolean }>();
</script>
<template><i>{{ on1 }}{{ onSale }}</i></template>`;
      const root = (attrs: string) => `<script setup lang="ts">
import N from "./N.vue";
${attrs}
</script>
<template><N /></template>`;
      const parent = (given: string) => `<script setup lang="ts">
import W from "./W.vue";
function note() {}
const events = { sale: note };
</script>
<template><div><W ${given} /></div></template>`;
      const bound = `<script setup lang="ts">
import N from "./N.vue";
defineOptions({ inheritAttrs: false });
</script>
<template><p><N v-bind="$attrs" /></p></template>`;
      const refuses = (given: string, wrapper: string, message: RegExp) => {
        expect(() => compile(island(parent(given), { W: wrapper, N: named })), given).toThrow(expect.objectContaining({ code: "FV0502", message: expect.stringMatching(message) }));
      };
      refuses(`:on1="2"`, root(""), /^components\/W\.vue:5:\d+: `on1`, named like a listener, which W may be passed, would reach N as its prop `on1`/);
      refuses(`:on-sale="true"`, root(""), /`on-sale`, named like a listener, which W may be passed, would reach N as its prop `onSale`/);
      refuses(`@sale="note"`, root(""), /`onSale`, named like a listener, which W may be passed, would reach N as its prop `onSale`/);
      refuses(`title="t" v-on="events"`, root(""), /a listener whose name is not known before rendering, which W may be passed, would reach N as its prop `on1`/);
      refuses(`:on1="2"`, bound, /`on1`, named like a listener, which W may be passed, would reach N as its prop `on1`/);
      expect(compile(island(parent(`:on1="2"`), { W: root("defineOptions({ inheritAttrs: false });"), N: named })).get("w.rs")).toContain("on1: None");
      expect(compile(island(parent(`@picked="note"`), { W: root(""), N: named })).get("w.rs")).toContain("on1: None");
    });

    it("leaves out a falsy value of a prop named like a listener where Vue merges a child's props", () => {
      const kid = `<script setup lang="ts">
withDefaults(defineProps<{ on1?: number; onAt: number; onOk: boolean; onTag?: string }>(), { on1: 4 });
</script>
<template><i>{{ on1 }}{{ onAt }}{{ onOk }}{{ onTag }}</i></template>`;
      const parent = (template: string) => `<script setup lang="ts">
import K from "./K.vue";
defineProps<{ n: number; ok: boolean; tag?: string }>();
</script>
<template>${template}</template>`;
      const rust = (template: string) => oneLine(compile(island(parent(template), { K: kid })).get("x.rs")!);
      expect(rust(`<K :on1="n" :on-at="3" :on-ok="ok" :on-tag="tag" />`)).toContain(
        "on1: Some(props.n).filter(|v| *v != 0), on_at: 3i64, on_ok: props.ok, on_tag: props.tag.as_deref().map(Cow::Borrowed).filter(|v| !v.is_empty())",
      );
      expect(rust(`<K :on1="0" :on-at="3" :on-ok="false" :on-tag="''" />`)).toContain("on1: None, on_at: 3i64, on_ok: false, on_tag: None");
      expect(rust(`<p><K :on1="n" :on-at="n" :on-ok="ok" :on-tag="tag" /></p>`)).toContain("on1: Some(props.n), on_at: props.n, on_ok: props.ok, on_tag: props.tag.as_deref().map(Cow::Borrowed) }");
    });

    it("refuses `$attrs` in a component that is the root of one that may be handed scope ids", () => {
      const inner = `<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>
<template><p><b v-bind="$attrs">x</b></p></template>`;
      const wrapper = `<script setup lang="ts">
import Inner from "./Inner.vue";
</script>
<template><Inner /></template>`;
      const parent = `<script setup lang="ts">
import W from "./W.vue";
</script>
<template><div><W /></div></template>
<style scoped>div { color: red; }</style>`;
      expect(() => compile(island(parent, { W: wrapper, Inner: inner }))).toThrow(/`\$attrs` in Inner, the root of a component that may be handed scope ids/);
    });

    it("refuses attributes passed to a root `<Transition>` around a `v-if`, which Vue's server drops", () => {
      const fade = `<script setup lang="ts">
defineProps<{ on: boolean }>();
</script>
<template><Transition><b v-if="on">x</b></Transition></template>`;
      const parent = `<script setup lang="ts">
import Fade from "./Fade.vue";
</script>
<template><div><Fade :on="true" class="c" /></div></template>`;
      expect(() => compile(island(parent, { Fade: fade }))).toThrow(/Fade\.vue:4:11: a root `<Transition>` or `<KeepAlive>` around a `v-if` in Fade/);
    });

    it("refuses an attribute named by a number, which a JavaScript object lists first", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><div><Child label="x" v-bind="{ 7: 'seven' }" /></div></template>`;
      expect(() => compile(island(parent, { Child: child }))).toThrow(/an attribute named `7`/);
    });

    it("refuses a `$route.query` value as an attribute that falls through", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><div><Child label="x" :title="$route.query.q" /></div></template>`;
      const project = island(parent, { Child: child });
      writeFileSync(join(project, "routes.json"), '["/"]');
      expect(() => generate(project, { ...CONFIG, routes: "routes.json" })).toThrow(/an attribute that may fall through is a string, a number or a boolean/);
    });

    it("refuses an attribute passed on to a `<RouterLink>` that would be its prop", () => {
      const link = `<script setup lang="ts">
defineProps<{}>();
</script>
<template><RouterLink to="/">go</RouterLink></template>`;
      const parent = `<script setup lang="ts">
import L from "./L.vue";
</script>
<template><div><L replace /></div></template>`;
      const project = island(parent, { L: link });
      writeFileSync(join(project, "routes.json"), '["/"]');
      expect(() => generate(project, { ...CONFIG, routes: "routes.json" })).toThrow(/`replace`, an attribute L may be passed, would reach its `<RouterLink>` as a prop/);
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
      expect(out).toContain('items: ["a", &*props.a].iter().map(|v| Cow::Borrowed(&**v)).collect()');
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

    it("sends a Teleport's content to the page's Teleports, and hands them down", () => {
      const modal = `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><Teleport to="#modals"><p>{{ a }}</p></Teleport></div></template>`;
      const out = compile(island(modal)).get("x.rs")!;
      expect(out).toContain('fv::page::teleport_into(out, fv_teleports, "#modals", false, &|out: &mut String| {');
      expect(out).toContain("fv_teleports: &fv::page::Teleports");
    });

    it("pushes useHead and useSeoMeta onto the page's Head, before the template renders, and hands it down", () => {
      const headed = `<script setup lang="ts">
import { useHead as head, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string }>();
const entry = head({ title: () => props.a });
useSeoMeta({ ogTitle: props.a, titleTemplate: "%s!", title: "t" });
</script>
<template><p>{{ a }}</p></template>`;
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
defineProps<{ a: string }>();
</script>
<template><div><Child :a="a" /></div></template>`;
      const files = compile(island(parent, { Child: headed }));
      const out = files.get("child.rs")!;
      expect(out).toContain('fv_head.push(fv::head::HeadValue::object([("title", fv::head::HeadValue::str(&props.a))]));');
      expect(oneLine(out)).toContain('fv_head.push_seo_meta(fv::head::HeadValue::object([("title", fv::head::HeadValue::str("t")), ("titleTemplate", fv::head::HeadValue::str("%s!"))]), vec![("property", "og:title", fv::head::HeadValue::str(&props.a))]);');
      expect(out.indexOf("fv_head.push(")).toBeLessThan(out.indexOf('out.push_str("<p>")'));
      expect(files.get("x.rs")).toContain("fv_head: &fv::head::Head");
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
      expect(out).toContain("fv::html::trusted_into(out, &props.body);");
      expect(out).toMatch(/if let Some\(html\) = props\.extra\.as_ref\(\) \{\s*fv::html::trusted_into\(out, html\);/);
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
        /`TrustedHtml` is imported from `\.\/somewhere-else`, which the compiler cannot resolve to a `\.ts` file of the project/,
      );
    });

    const placed = (template: string, others: Record<string, string> = {}) => `<script setup lang="ts">
import type { InlineHtml as Inline, TrustedHtml } from "ferrovue/types";
${Object.keys(others)
  .map((name) => `import ${name} from "./${name}.vue";\n`)
  .join("")}const props = defineProps<{ body: TrustedHtml; short: Inline; maybe?: Inline; items: string[] }>();
</script>
<template>${template}</template>`;
    const SAFE = { ...CONFIG, trustedHtml: "crate::sanitize::SafeHtml" };
    const placing = (template: string, others: Record<string, string> = {}) => () => generate(island(placed(template, others), others), SAFE);

    it("writes an InlineHtml prop as ferrovue::html::InlineHtml, inside a <p>, with no trustedHtml configured", () => {
      const source = `<script setup lang="ts">
import type { InlineHtml } from "ferrovue/types";
defineProps<{ note: InlineHtml; extra?: InlineHtml }>();
</script>
<template><p v-html="note"></p><p><b v-html="extra"></b></p></template>`;
      const out = compile(island(source)).get("x.rs")!;
      expect(out).toContain("pub note: ferrovue::html::InlineHtml,");
      expect(out).toContain("pub extra: Option<ferrovue::html::InlineHtml>,");
      expect(out).toContain("fv::html::trusted_into(out, &props.note);");
      expect(out).not.toContain("<'a>");
    });

    it("makes every TrustedHtml prop inline when trustedHtml names ferrovue::html::InlineHtml", () => {
      const out = generate(island(placed(`<p v-html="body"></p>`)), { ...CONFIG, trustedHtml: "ferrovue::html::InlineHtml" }).get("x.rs")!;
      expect(out).toContain("pub body: ferrovue::html::InlineHtml,");
    });

    it.each([
      ["table", `<table v-html="body"></table>`],
      ["thead", `<table><thead v-html="body"></thead></table>`],
      ["tbody", `<table><tbody v-html="body"></tbody></table>`],
      ["tfoot", `<table><tfoot v-html="body"></tfoot></table>`],
      ["tr", `<table><tr v-html="body"></tr></table>`],
      ["colgroup", `<table><colgroup v-html="body"></colgroup></table>`],
    ])("refuses v-html on a <%s>, whose markup the parser moves out of the table", (tag, template) => {
      expect(placing(template)).toThrow(
        expect.objectContaining({ code: "FV1512", message: expect.stringMatching(new RegExp(`^components/X\\.vue:5:\\d+: \`v-html\` on \`<${tag}>\`.*a \`<td>\`, \`<th>\` or \`<caption>\``)) }),
      );
    });

    it.each([
      ["select", `<select v-html="body"></select>`],
      ["optgroup", `<select><optgroup v-html="short"></optgroup></select>`],
    ])("refuses v-html on a <%s>, whose tags the parser drops", (tag, template) => {
      expect(placing(template)).toThrow(expect.objectContaining({ code: "FV1512", message: expect.stringMatching(new RegExp(`\`<${tag}>\`.*write the \`<option>\`s in the template`)) }));
    });

    it.each([
      ["svg", `<svg v-html="body"></svg>`],
      ["g", `<svg><g v-html="short"></g></svg>`],
      ["text", `<svg><text v-html="body"></text></svg>`],
    ])("refuses v-html on an SVG <%s>", (tag, template) => {
      expect(placing(template)).toThrow(expect.objectContaining({ code: "FV1512", message: expect.stringMatching(new RegExp(`SVG \`<${tag}>\`.*inside a \`<foreignObject>\``)) }));
    });

    it.each([
      ["math", `<math v-html="body"></math>`],
      ["mrow", `<math><mrow v-html="body"></mrow></math>`],
      ["annotation-xml", `<math><annotation-xml v-html="body"></annotation-xml></math>`],
      ["annotation-xml", `<math><annotation-xml encoding="application/mathml+xml" v-html="body"></annotation-xml></math>`],
      ["annotation-xml", `<math><annotation-xml :encoding="'text/html'" v-html="body"></annotation-xml></math>`],
    ])("refuses v-html on a MathML <%s> that holds no HTML", (tag, template) => {
      expect(placing(template)).toThrow(expect.objectContaining({ code: "FV1512", message: expect.stringMatching(new RegExp(`MathML \`<${tag}>\`.*on an \`<mtext>\``)) }));
    });

    it.each([
      `<table><tr><td v-html="body"></td><th v-html="body"></th></tr><caption v-html="body"></caption></table>`,
      `<svg><foreignObject v-html="body"></foreignObject><desc v-html="body"></desc><title v-html="body"></title><foreignObject><div v-html="body"></div></foreignObject></svg>`,
      `<math><mi v-html="body"></mi><mo v-html="body"></mo><mn v-html="body"></mn><ms v-html="body"></ms><mtext v-html="body"></mtext></math>`,
      `<math><annotation-xml encoding="text/html" v-html="body"></annotation-xml><annotation-xml encoding="Application/XHTML+XML" v-html="body"></annotation-xml></math>`,
      `<select><option v-html="body"></option></select><span v-html="body"></span><div><span v-html="maybe"></span></div>`,
    ])("accepts v-html where the browser keeps any markup: %s", (template) => {
      expect(placing(template)).not.toThrow();
    });

    it.each([
      [`<p v-html="body"></p>`, "on"],
      [`<div>\n<p><b><span v-html="body" /></b></p></div>`, "inside"],
      [`<p><template v-if="items.length"><span v-for="i in items" :key="i" v-html="body"></span></template></p>`, "inside"],
      [`<p><slot><i v-html="body"></i></slot></p>`, "inside"],
    ])("refuses v-html of HTML that may hold blocks in a <p>: %s", (template, where) => {
      expect(placing(template)).toThrow(
        expect.objectContaining({
          code: "FV1513",
          message: expect.stringMatching(new RegExp(`^components/X\\.vue:\\d+:\\d+: \`v-html\` ${where} a \`<p>\` .*type the prop \`InlineHtml\` from \`ferrovue/types\``)),
        }),
      );
    });

    it("points at the v-html it refuses", () => {
      expect(placing(`<div><p v-html="short"></p>\n  <p><span v-html="body"></span></p></div>`)).toThrow(/^components\/X\.vue:6:19: `v-html` inside a `<p>`/);
    });

    it.each([
      `<p v-html="short"></p><p><b v-html="maybe"></b></p>`,
      `<p><button><span v-html="body"></span></button><object><span v-html="body"></span></object></p>`,
      `<p><svg><foreignObject><div v-html="body"></div></foreignObject></svg></p>`,
      `<p><template><span v-html="body"></span></template></p>`,
      `<p><Y><span v-html="body"></span></Y></p>`,
    ])("accepts v-html in a <p> where the parser keeps its blocks to themselves, or the HTML is inline: %s", (template) => {
      expect(placing(template, template.includes("<Y>") ? { Y: "<template><div><slot /></div></template>" } : {})).not.toThrow();
    });
  });

  describe("slots", () => {
    const frame = `<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><div><slot name="head">{{ title }}</slot><slot /></div></template>`;

    it("gives a component with <slot> a Slots argument, one optional field per slot", () => {
      const out = compile(island(frame)).get("x.rs")!;
      expect(out).toContain("pub head: Option<fv::render::Slot<'s>>,");
      expect(out).toContain("pub default: Option<fv::render::Slot<'s>>,");
      expect(out).toContain("pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>)");
      expect(out).not.toContain("pub fn island");
      expect(out).not.toContain("pub fn into_");
    });

    it("decides at generation time when slot content always holds something", () => {
      const parent = `<script setup lang="ts">
import Frame from "./Frame.vue";
const props = defineProps<{ on: boolean }>();
</script>
<template><Frame title="t"><template #head><b v-if="on">h</b></template><i>body</i></Frame></template>`;
      const out = compile(island(parent, { Frame: frame })).get("x.rs")!;
      expect(out).toContain("head: Some(fv::render::Slot::markup(&|out: &mut String| -> bool {");
      expect(out).toContain("default: Some(fv::render::Slot::new(&|out: &mut String| {");
    });

    it("asks of a push whose values decide whether it is only comments what it wrote", () => {
      const parent = (body: string) => `<script setup lang="ts">
import Frame from "./Frame.vue";
const props = defineProps<{ note?: string; tags: string[] }>();
</script>
<template><Frame title="t">${body}</Frame></template>`;
      const markers = compile(island(parent(`{{ note }}<i v-for="t in tags">{{ t }}</i>`), { Frame: frame })).get("x.rs")!;
      expect(markers).toContain("let fv_chunk = out.len();");
      expect(markers).toContain("filled |= !fv::render::is_comment(&out[fv_chunk..]);");
      const text = compile(island(parent(`{{ note }} of {{ tags.length }}<i v-for="t in tags">{{ t }}</i>`), { Frame: frame })).get("x.rs")!;
      expect(text).not.toContain("fv::render::is_comment");
      expect(text).toContain("default: Some(fv::render::Slot::new(&|out: &mut String| {");
    });

    it("reads $slots.x as whether the parent gave that slot content", () => {
      const source = `<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><div><aside v-if="$slots.side"><slot name="side" /></aside></div></template>`;
      expect(compile(island(source)).get("x.rs")).toContain("if fv_slots.side.is_some() {");
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
      expect(out).toContain("fv::render::scoped_slot_into(out, fv_slots.item, &ItemSlotProps { text: fv_it, index: fv_i }, Some(");
    });

    it("binds the props a parent destructures, whatever order it generates in", () => {
      const parent = `<script setup lang="ts">
import Lister from "./Lister.vue";
defineProps<{ items: string[] }>();
</script>
<template><Lister :items="items"><template #item="{ text, index: n }"><b :data-n="n">{{ text }}</b></template></Lister></template>`;
      const out = compile(island(lister, { A: parent, Lister: lister })).get("a.rs")!;
      expect(out).toMatch(/item: Some\(&\|out: &mut String, (fv_slot_props): &super::lister::ItemSlotProps<'_>\| -> bool \{/);
      expect(out).toMatch(/fv::core::escape_into\(out, fv_slot_props\.text\);/);
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

  describe("scoped styles", () => {
    const leaf = `<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template><b>{{ label }}</b></template>
<style scoped>b { color: red }</style>`;
    const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 8);

    it("hashes the path and source from Vite's root, as `@vitejs/plugin-vue` does", () => {
      const root = island(leaf);
      expect(compile(root).get("x.rs")).toContain(`<b data-v-${hash(`components/X.vue${leaf}`)}>`);
      expect(generate(root, { ...CONFIG, scopeId: "filepath" }).get("x.rs")).toContain(`<b data-v-${hash("components/X.vue")}>`);
      const nested = join(root, "app");
      mkdirSync(nested);
      expect(generate(root, { ...CONFIG, scopeId: "filepath", viteRoot: ".." }).get("x.rs")).toContain(`<b data-v-${hash(`${basename(root)}/components/X.vue`)}>`);
      writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ ...CONFIG, scopeId: "dev" }));
      expect(() => loadConfig(root)).toThrow(/`scopeId` in ferrovue\.config\.json is "filepath" or "filepath-source"/);
    });

    it("hands a child's root the parent's id, and what a parent passes on to its root", () => {
      const middle = `<script setup lang="ts">
import Leaf from "./Leaf.vue";
</script>
<template><Leaf label="x" /></template>
<style scoped>b { color: blue }</style>`;
      const top = `<script setup lang="ts">
import Middle from "./Middle.vue";
</script>
<template><section><Middle /></section></template>
<style scoped>section { color: green }</style>`;
      const out = generate(island(top, { Middle: middle, Leaf: leaf }), { ...CONFIG, scopeId: "filepath" });
      expect(out.get("leaf.rs")).toContain("pub fn try_render_scoped(out: &mut String, props: &Props<'_>, fv_attrs: &str) -> Result<(), fv::render::Refused>");
      expect(out.get("leaf.rs")).toContain('try_render_scoped(out, props, "")');
      expect(out.get("leaf.rs")).toContain("out.push_str(fv_attrs);");
      expect(out.get("x.rs")).toContain(`super::middle::try_render_scoped(out, &super::middle::Props {}, " data-v-${hash("components/X.vue")}")?;`);
      expect(out.get("middle.rs")).toContain(`super::leaf::try_render_scoped(out, &super::leaf::Props { label: Cow::Borrowed("x") }, &fv::attrs::scope_attrs(fv_attrs, "data-v-${hash("components/Middle.vue")}", ""))?;`);
    });

    it("gives slot content the slot scope id of a component with `:slotted()` styles", () => {
      const card = `<script setup lang="ts">
defineSlots<{ default(): unknown }>();
</script>
<template><div><slot /></div></template>
<style scoped>:slotted(p) { margin: 0 }</style>`;
      const parent = `<script setup lang="ts">
import Card from "./Card.vue";
</script>
<template><Card><p>x</p></Card></template>`;
      const out = generate(island(parent, { Card: card }), { ...CONFIG, scopeId: "filepath" });
      expect(out.get("card.rs")).toContain(`fv::render::slot_into_slotted(out, fv_slots.default, "data-v-${hash("components/Card.vue")}-s", None);`);
      expect(out.get("x.rs")).toContain("default: Some(fv::render::Slot::slotted(&|out: &mut String, fv_slot_id: &str| -> bool {");
    });
  });

  describe("<ClientOnly>", () => {
    const page = (inside: string, from = "ferrovue") => `<script setup lang="ts">
import { ClientOnly } from "${from}";
import Chart from "chart-library";
defineProps<{ label: string }>();
</script>
<template><div><ClientOnly>${inside}</ClientOnly></div></template>`;

    it("writes the fallback between fragment markers and skips the default slot", () => {
      const out = compile(island(page(`<Chart :data="window.points" /><v-tooltip>{{ label.at(-1) }}</v-tooltip><template #fallback><p>{{ label }}</p></template>`))).get("x.rs")!;
      expect(out).toContain('out.push_str("<div><!--[--><p>");\n    fv::core::escape_into(out, &props.label);\n    out.push_str("</p><!--]--></div>");');
      expect(out).not.toContain("tooltip");
    });

    it("writes a comment where there is no fallback", () => {
      const out = compile(island(page(`<Chart />`))).get("x.rs")!;
      expect(out).toContain('out.push_str("<div><!----></div>");');
    });

    it("reads `<ClientOnly>` from the package root alone", () => {
      expect(() => compile(island(page(`<Chart />`, "ferrovue/client")))).toThrow(/a child component must be imported from a `\.vue` file/);
    });

    it("still refuses a component resolved by name outside it", () => {
      const source = page(`<v-tooltip /></ClientOnly><v-tooltip /><ClientOnly>`);
      expect(() => compile(island(source))).toThrow(/`<v-tooltip>` is a component the template resolves by name, which must be imported/);
    });

    it("refuses attributes, slots other than the default and `#fallback`, and fallback props", () => {
      expect(() => compile(island(page(`<Chart />`).replace("<ClientOnly>", '<ClientOnly class="wide">')))).toThrow(/`<ClientOnly>` takes no attributes/);
      expect(() => compile(island(page(`<template #header>h</template>`)))).toThrow(/a default slot and a `#fallback` slot, and no other/);
      expect(() => compile(island(page(`<template #fallback="{ x }">{{ x }}</template>`)))).toThrow(/`#fallback` passes no props/);
    });
  });

  describe("defineAsyncComponent", () => {
    const child = `<script setup lang="ts">
defineProps<{ text: string }>();
</script>
<template><p>{{ text }}</p></template>`;
    const parent = (declared: string) => `<script setup lang="ts">
import { defineAsyncComponent as lazy } from "vue";
const Later = ${declared};
defineProps<{ label: string }>();
</script>
<template><div><Later :text="label" /></div></template>`;

    it("renders the component it loads as a child", () => {
      for (const declared of ['lazy(() => import("./Y.vue"))', 'lazy({ loader: () => import("./Y.vue"), delay: 200 })']) {
        const out = compile(island(parent(declared), { Y: child })).get("x.rs")!;
        expect(out, declared).toContain("super::y::try_render(out, &super::y::Props { text: Cow::Borrowed(&*props.label) })?;");
      }
    });

    it("refuses a loader that is not an import of a `.vue` file", () => {
      for (const declared of ['lazy(() => import("./y.ts"))', "lazy(() => import(name))", "lazy(load)"]) {
        expect(() => compile(island(parent(declared).replace("const Later", "const name = 'Y';\nconst load = () => null;\nconst Later"), { Y: child })), declared).toThrow(/`defineAsyncComponent` loads a component of this project/);
      }
    });
  });
});
