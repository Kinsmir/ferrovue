import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generate } from "../src/compiler.ts";
import { CONFIG, compile, island } from "./project.ts";

describe("the generator", () => {
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

    it("refuses a query value that may be null, which vue-router writes as the key alone", () => {
      const source = `<script setup lang="ts">
defineProps<{ q: string | null }>();
</script>
<template><RouterLink :to="{ path: '/', query: { q } }">go</RouterLink></template>`;
      expect(() => withRoutes(island(source))).toThrow(/X\.vue:4:\d+: a query value that may be `null`, which vue-router writes as the key alone/);
    });

    it("refuses comparing a query value with null, which vue-router gives a key with no value", () => {
      const source = `<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
</script>
<template><p v-if="route.query.q === null">bare</p></template>`;
      expect(() => withRoutes(island(source))).toThrow(/X\.vue:5:\d+: `===` between a query value and `null`/);
    });

    it("reads a field of the route by a string key as it reads the field", () => {
      const read = (path: string, fullPath: string) =>
        withRoutes(
          island(`<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
</script>
<template><p :data-path="${path}">{{ ${fullPath} }}</p></template>`),
        ).get("x.rs")!;
      const dotted = read("$route.path", "route.fullPath");
      expect(read(`$route['path']`, `route['fullPath']`)).toBe(dotted);
      expect(dotted).toContain("fv_route.path()");
      expect(dotted).toContain("fv_route.full_path()");
    });

    it("resolves a RouterLink against the route, and hands the route down to it", () => {
      const parent = `<script setup lang="ts">
import Nav from "./Nav.vue";
defineProps<{ href: string }>();
</script>
<template><header><Nav :href="href" /></header></template>`;
      const out = withRoutes(island(parent, { Nav: nav }));
      expect(out.get("nav.rs")).toContain('fv::attrs::link_to_open(out, fv_route, &props.href, "page", "router-link-active", "router-link-active router-link-exact-active", &["tab"], true);');
      expect(out.get("x.rs")).toContain("pub fn render(out: &mut String, props: &Props<'_>, fv_route: &fv::router::Route<'_>)");
      expect(out.get("x.rs")).toContain(", fv_route)?;");
      expect(out.get("route_table.rs")).toContain('"/users/:id",');
    });

    it("refuses a RouterLink when the configuration names no routes", () => {
      expect(() => compile(island(nav))).toThrow(/`routes` in ferrovue\.config\.json/);
    });

    it("gives a RouterLink scope ids as vue-router's virtual nodes take them, and refuses what they take otherwise", () => {
      const scoped = (template: string) => `<script setup lang="ts">
defineProps<{ href: string }>();
</script>
<template>${template}</template>
<style scoped>a { color: red }</style>`;
      const out = withRoutes(island(scoped(`<nav><RouterLink :to="href">go</RouterLink></nav>`))).get("x.rs")!;
      expect(out).toMatch(/fv::attrs::link_to_open\(out, fv_route, &props\.href, "page", "router-link-active", "router-link-active router-link-exact-active", &\[\], false\);\n\s+out\.push_str\(" data-v-[0-9a-f]{8}>go<\/a><\/nav>"\);/);
      expect(() => withRoutes(island(scoped(`<main><RouterView /></main>`)))).toThrow(/`<RouterView>` in a component with `<style scoped>`/);
      expect(() => withRoutes(island(scoped(`<nav><RouterLink :to="href"><slot /></RouterLink></nav>`)))).toThrow(/X\.vue:4:33: a `<slot>` inside a `<RouterLink>` that takes scope ids/);
      const card = `<script setup lang="ts">
defineSlots<{ default(): unknown }>();
</script>
<template><div><slot /></div></template>
<style scoped>:slotted(a) { margin: 0 }</style>`;
      const parent = `<script setup lang="ts">
import Card from "./Card.vue";
</script>
<template><Card><RouterLink to="/"><b>go</b></RouterLink></Card></template>`;
      expect(() => withRoutes(island(parent, { Card: card }))).toThrow(/an element inside a `<RouterLink>` in slot content given a slot scope id/);
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
      expect(out.get("x.rs")).toContain('fv::attrs::link_open(out, &fv_link, "page", "on", "on here", &[], false);');
      const same = named(island(linkTo("'/users/' + id\" active-class=\"same\" exact-active-class=\"same\" aria-current-value=\"a&quot;<b>")));
      expect(same.get("x.rs")).toContain('fv::attrs::link_to_open(out, fv_route, &format!("/users/{}", props.id), "a&quot;&lt;b&gt;", "", "same", &[], false);');
      expect(out.get("route_table.rs")).toContain('pub const BASE: &str = "/app/";');
      expect(out.get("route_table.rs")).toContain('ferrovue::router::RouteDef::new("/users/:id").with_name("user"),');
      expect(out.get("route_table.rs")).toContain("ferrovue::router::Router::tree(ROUTES).with_base(BASE)\n}");
    });

    it("builds the router with vue-router's strict and sensitive matching when configured", () => {
      const both = named(island(linkTo("'/users/' + id")), { strict: true, sensitive: true });
      expect(both.get("route_table.rs")).toContain("ferrovue::router::Router::tree(ROUTES).with_base(BASE).with_strict(true).with_sensitive(true)\n}");
      const strict = named(island(linkTo("'/users/' + id")), { strict: true, sensitive: false });
      expect(strict.get("route_table.rs")).toContain("ferrovue::router::Router::tree(ROUTES).with_base(BASE).with_strict(true)\n}");
    });

    it("keeps the spaces of the class names configured or given, as vue-router's class object does", () => {
      const spaced = named(island(linkTo("'/users/' + id")), { linkActiveClass: " on ", linkExactActiveClass: "h  ere " });
      expect(spaced.get("x.rs")).toContain('"page", "on", "on  h  ere", &[], false);');
      const given = named(island(linkTo("'/users/' + id\" active-class=\"2\" exact-active-class=\"1\" :class=\"id")), { linkActiveClass: " on " });
      expect(given.get("x.rs")).toContain('"page", "2", "1 2", &[&*props.id], true);');
      const listed = named(island(linkTo("'/users/' + id\" active-class=\" \" :class=\"[id]")));
      expect(listed.get("x.rs")).toContain('"page", "", "router-link-exact-active", &[&*props.id], false);');
    });

    it("writes nested routes as a tree, and asks a nested route for its parent's parameters too", () => {
      const root = island(linkTo("{ name: 'post', params: { id, post: id } }"));
      writeFileSync(
        join(root, "routes.json"),
        JSON.stringify([{ path: "/users/:id", name: "user", children: [{ path: "", name: "user-home" }, { path: "posts/:post", name: "post" }] }]),
      );
      const out = generate(root, { ...CONFIG, routes: "routes.json" });
      expect(out.get("route_table.rs")).toContain('ferrovue::router::RouteDef::new("posts/:post").with_name("post"),');
      expect(out.get("route_table.rs")).toContain('"/users/:id/posts/:post",');
      expect(out.get("x.rs")).toContain('fv_route.link_named("post", &[("id", &*props.id), ("post", &*props.id)], "", "")');
      const missing = island(linkTo("{ name: 'post', params: { post: id } }"));
      writeFileSync(join(missing, "routes.json"), JSON.stringify([{ path: "/users/:id", children: [{ path: "posts/:post", name: "post" }] }]));
      expect(() => generate(missing, { ...CONFIG, routes: "routes.json" })).toThrow(/route `post` needs `id`/);
    });

    it("refuses a route name no route has", () => {
      expect(() => named(island(linkTo("{ name: 'nobody' }")))).toThrow(/no route is called `nobody`/);
    });

    const withPages = (root: string, pages: Record<string, string>) => {
      for (const [file, text] of Object.entries(pages)) {
        mkdirSync(join(root, "pages", file, ".."), { recursive: true });
        writeFileSync(join(root, "pages", file), text);
      }
      return generate(root, { ...CONFIG, router: { routes: { pages: "pages" } } });
    };
    const view = "<template><p>page</p></template>";

    it("builds the routes from a folder of pages, and compiles each page as a component named by its path", () => {
      const out = withPages(island(linkTo("{ name: '/books/[id]', params: { id } }")), {
        "index.vue": view,
        "books/[id].vue": `<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
</script>
<template><h1>{{ route.params.id }}</h1></template>`,
        "[...path].vue": view,
      });
      const table = out.get("route_table.rs")!;
      expect(table).toContain("// @generated by ferrovue from pages. Do not edit: change the pages and run");
      expect(table).toContain('ferrovue::router::RouteDef::new("/").with_name("/"),');
      expect(table).toContain('ferrovue::router::RouteDef::new("/books").with_view(false).with_children(&[\n        ferrovue::router::RouteDef::new(":id").with_name("/books/[id]"),');
      expect(table).toContain('ferrovue::router::RouteDef::new("/:path(.*)").with_name("/[...path]"),');
      expect(out.get("x.rs")).toContain('fv_route.link_named("/books/[id]", &[("id", &*props.id)], "", "")');
      expect(out.get("books_id.rs")).toContain('pub const NAME: &str = "BooksId";');
      expect(out.get("books_id.rs")).toContain('fv_route.param("id")');
      expect(out.has("index.rs") && out.has("path.rs")).toBe(true);
      expect(out.get("mod.rs")).toContain("pub mod books_id;");
    });

    it("takes an optional parameter given or left out", () => {
      const out = withPages(island(linkTo("{ name: '/[[lang]]/about' }"), { Y: linkTo("{ name: '/[[lang]]/about', params: { lang: id } }") }), { "[[lang]]/about.vue": view });
      expect(out.get("x.rs")).toContain('fv_route.link_named("/[[lang]]/about", &[], "", "")');
      expect(out.get("y.rs")).toContain('fv_route.link_named("/[[lang]]/about", &[("lang", &*props.id)], "", "")');
      expect(out.get("route_table.rs")).toContain('ferrovue::router::RouteDef::new("/:lang?").with_view(false).with_children(&[');
    });

    it("refuses routes that are neither a file nor a folder of pages, and a page whose name is taken", () => {
      expect(() => generate(island(view), { ...CONFIG, routes: { folder: "pages" } as never })).toThrow(expect.objectContaining({ code: "FV1238" }));
      expect(() => withPages(island(view), { "x.vue": view })).toThrow(/pages\/x\.vue: the page's component would be called `X`, as components\/X\.vue is: rename one of them/);
      expect(() => withPages(island(view), { "a-b.vue": view, "a_b.vue": view })).toThrow(expect.objectContaining({ code: "FV1245" }));
      expect(() => withPages(island(view), { "404.vue": view })).toThrow(/would be called `404`, which is not a Rust name/);
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
      expect(named(island(reader("query.q"))).get("x.rs")).toContain('fv_route.query("q").write_display(out);');
      expect(named(island(reader("fullPath"))).get("x.rs")).toContain("fv_route.full_path()");
      expect(() => named(island(reader("meta.title")))).toThrow(/`route.meta` is not available on the server/);
    });

    it("refuses a query value, an array when its key is repeated, as an attribute, unless narrowed to one string", () => {
      const bound = (value: string, attr = ":data-q") => `<script setup lang="ts">
import { useRoute } from "vue-router";
defineProps<{ a: string }>();
const route = useRoute();
</script>
<template><p ${attr}="${value}">x</p></template>`;
      const refused = /components\/X\.vue:6:\d+: `data-q` is bound to a query value, which is an array when its key is repeated: .*hydration then sets it.*typeof route\.query\.q === "string"/;
      expect(() => named(island(bound("route.query.q")))).toThrow(refused);
      expect(() => named(island(bound("route.query.q ?? 'none'")))).toThrow(refused);
      expect(() => named(island(bound("route.query.q", ":hidden")))).toThrow(/`hidden` is bound to a query value/);
      const narrowed = named(island(bound("typeof route.query.q === 'string' ? route.query.q : 'none'"))).get("x.rs")!;
      expect(narrowed).toContain('fv::core::escape_into(out, fv_route.query("q").attr_value().unwrap_or("none"));');
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

    it("writes a setup store's nullable state as null, and refuses one that starts undefined", () => {
      const session = (init: string) => `import { defineStore } from "pinia";
import { ref } from "vue";
export const usePrefs = defineStore("prefs", () => {
  const user = ref<string | null>(${init});
  return { user };
});
`;
      const user = `<script setup lang="ts">
import { usePrefs } from "../stores/prefs";
const prefs = usePrefs();
</script>
<template><p>{{ prefs.user ?? "guest" }}</p></template>`;
      const out = withStore(island(user), session("null"));
      expect(out.get("stores.rs")).toContain('    pub user: Option<Cow<\'a, str>>,');
      expect(() => withStore(island(user), session(""))).toThrow(/prefs\.ts:4:\d+: a `ref<T \| null>\(\)` with no value starts `undefined`/);
    });

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

    it("refuses a Date in a store's state, which hydrateState reads back as a string", () => {
      const dated = store.replace("wide: boolean }", "wide: boolean; seen: Date[] }").replace("wide: false }", "wide: false, seen: [] }");
      expect(() => withStore(island(reader), dated)).toThrow(/prefs\.ts:2:\d+: `seen` of a store's state holds a `Date`/);
      const setup = `import { defineStore } from "pinia";
import { ref } from "vue";
export const usePrefs = defineStore("prefs", () => {
  const at = ref<Date | null>(null);
  return { at };
});
`;
      expect(() => withStore(island(reader), setup)).toThrow(/prefs\.ts:4:\d+: a setup store's ref holds a `Date`/);
    });

    it("refuses a store whose state has no declared type", () => {
      const untyped = store.replace("(): PrefsState =>", "() =>");
      expect(() => withStore(island(reader), untyped)).toThrow(/declares its return type/);
    });

    it("reads a setup store's returned refs as its state, and refuses one it cannot see", () => {
      const setup = `import { defineStore } from "pinia";
import { ref } from "vue";
export const usePrefs = defineStore("prefs", () => {
  const density = ref("classic");
  const wide = ref(false);
  return { density, wide };
});
`;
      const out = withStore(island(reader), setup);
      expect(out.get("stores.rs")).toContain("pub struct PrefsState<'a> {");
      expect(out.get("x.rs")).toContain("&*fv_stores.prefs.density");
      const expression = `import { defineStore } from "pinia";
export const usePrefs = defineStore("prefs", () => ({}));
`;
      expect(() => withStore(island(reader), expression)).toThrow(/returns its state from a block/);
      const untyped = setup.replace('ref("classic")', "ref([])");
      expect(() => withStore(island(reader), untyped)).toThrow(/declares its type: `ref<string\[\]>\(\[\]\)`/);
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
      expect(out.get("x.rs")).toContain('fv::core::escape_into(out, fv::strings::js_trim_start(&fv_stores.prefs.density));\n    out.push_str("!\\" data-wide');
    });

    it("refuses a getter read by `[…]`", () => {
      const withGetter = store.replace("});\n", `, getters: { label: (s) => s.density + "!" } });\n`);
      expect(() => withStore(island(reader.replace("prefs.density", "prefs['label']")), withGetter)).toThrow(expect.objectContaining({ code: "FV0612" }));
    });

    it("refuses a getter that reads `this`, or returns a function", () => {
      const viaThis = store.replace("});\n", `, getters: { label(): string { return this.density; } } });\n`);
      expect(() => withStore(island(reader.replace("prefs.density", "prefs.label")), viaThis)).toThrow(/reads `this`/);
      const fn = store.replace("});\n", `, getters: { label: (s) => (x: string) => x } });\n`);
      expect(() => withStore(island(reader.replace("prefs.density", "prefs.label")), fn)).toThrow(/returns a function/);
    });
  });

  describe("vue-i18n", () => {
    const withLocales = (root: string, messages: Record<string, unknown>) => {
      mkdirSync(join(root, "locales"), { recursive: true });
      writeFileSync(join(root, "locales", "en.json"), JSON.stringify(messages));
      return generate(root, { ...CONFIG, i18n: { messages: "locales", locale: "en" } });
    };
    const translating = (call: string) => `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ ${call} }}</p></template>`;

    it("compiles the messages to a table, and a $t call to a lookup in the request's locale", () => {
      const out = withLocales(island(translating("$t('apples', n)")), { apples: "one | {n} apples", a: { b: "@.upper:a.c" }, "a.c": "x" });
      expect(out.get("x.rs")).toContain('fv_i18n.t("apples", &fv::i18n::Args::new().with_plural(props.n))');
      expect(out.get("x.rs")).toContain("fv_i18n: &fv::i18n::I18n");
      expect(out.get("i18n.rs")).toContain('("apples", Message::new(&[&[Part::Text("one")], &[Part::Named("n"), Part::Text(" apples")]]))');
      expect(out.get("i18n.rs")).toContain('Part::Linked { key: "a.c", modifier: Some("upper") }');
    });

    it("builds the arguments of a $t call and a locale with no messages through their constructors", () => {
      const out = withLocales(island(translating("$t('a', { n }, [n, 'x'])")), {});
      expect(out.get("x.rs")).toContain('fv_i18n.t("a", &fv::i18n::Args::new().with_named(&[("n", fv::i18n::Value::Int(props.n))]).with_list(&[fv::i18n::Value::Int(props.n), fv::i18n::Value::Str("x")]))');
      expect(out.get("i18n.rs")).toContain('pub static LOCALES: &[Locale] = &[\n    Locale::new("en", &[]),\n];');
    });

    it("refuses $t without locale files, a default message, and a modifier vue-i18n does not define", () => {
      expect(() => compile(island(translating("$t('a')")))).toThrow(/`t\(\)` needs `i18n` in ferrovue\.config\.json/);
      expect(() => withLocales(island(translating("$t('a', 'fallback')")), { a: "x" })).toThrow(/a default message given to `t\(\)` is not supported/);
      expect(() => withLocales(island(translating("$t('a')")), { a: "@.shout:b", b: "x" })).toThrow(/the modifier `shout`, which vue-i18n does not define/);
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
      expect(out).toContain("fv::core::escape_into(out, crate::helpers::plural(props.n));");
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

  describe("Rust twins", () => {
    const config = {
      ...CONFIG,
      twins: {
        VBtn: { rust: "crate::ui::v_btn", props: { label: "string" as const, size: "int?" as const, block: "bool" as const }, slots: ["default", "prepend"] },
        VIcon: { rust: "crate::ui::v_icon" },
      },
    };
    const using = (template: string, script = 'import { VBtn, VIcon } from "vuetify/components";') => `<script setup lang="ts">
${script}
defineProps<{ label: string }>();
</script>
<template>${template}</template>`;

    it("calls the twin with its props, slots and attributes", () => {
      const out = generate(island(using(`<VBtn :label="label" block class="wide"><b>{{ label }}</b></VBtn>`)), config).get("x.rs")!;
      expect(out).toContain("crate::ui::v_btn(out, &super::twins::VBtnProps { label: &props.label, size: None, block: true }, super::twins::VBtnSlots {");
      expect(out).toContain("default: Some(fv::render::Slot::new(&|out: &mut String| {");
      expect(out).toContain("prepend: None,");
      expect(out).toContain('}, &fv::attrs::Attrs::merged(&[&[("class", fv::attrs::Attr::str("wide"))]], ""));');
    });

    it("finds a twin the template resolves by name, as `<v-icon>`", () => {
      const out = generate(island(using("<p><v-icon /></p>", "")), config).get("x.rs")!;
      expect(out).toContain("crate::ui::v_icon(out, &super::twins::VIconProps {}, &fv::attrs::Attrs::NONE);");
    });

    it("writes the props, the slots and the signature each twin is held to", () => {
      const twins = generate(island(using("<p />")), config).get("twins.rs")!;
      expect(twins).toContain("pub struct VBtnProps<'a> {\n    pub label: &'a str,\n    pub size: Option<i64>,\n    pub block: bool,\n}");
      expect(twins).toContain("pub struct VBtnSlots<'s> {\n    /// `#default`\n    pub default: Option<fv::render::Slot<'s>>,\n    /// `#prepend`\n    pub prepend: Option<fv::render::Slot<'s>>,\n}");
      expect(twins).toContain("pub type VBtnRender = fn(&mut String, &VBtnProps<'_>, VBtnSlots<'_>, &fv::attrs::Attrs<'_>);\n\nconst _: VBtnRender = crate::ui::v_btn;");
      expect(twins).toContain("pub struct VIconProps {\n}");
      expect(twins).toContain("pub type VIconRender = fn(&mut String, &VIconProps, &fv::attrs::Attrs<'_>);");
      expect(generate(island(using("<p />")), config).get("mod.rs")).toContain("pub mod twins;");
      expect(compile(island(using("<p />", ""))).has("twins.rs")).toBe(false);
    });

    it("refuses a missing prop, a slot it does not name, and `v-bind` of an object", () => {
      expect(() => generate(island(using("<VBtn />")), config)).toThrow(/VBtn requires `label`/);
      expect(() => generate(island(using(`<VBtn :label="label"><template #append>a</template></VBtn>`)), config)).toThrow(/VBtn has no slot `append`/);
      expect(() => generate(island(using(`<VBtn v-bind="$props" />`)), config)).toThrow(/the props of VBtn, a Rust twin, are attributes or an object literal/);
      const nullable = using(`<VBtn :label="label" :size="count" />`).replace("defineProps<{ label: string }>", "defineProps<{ label: string; count: number | null }>");
      expect(() => generate(island(nullable), config)).toThrow(/a value that may be `null` where <VBtn>'s prop `size` takes .*write `\?\? undefined` after it/);
    });

    it("refuses a twin named after a component ferrovue compiles, and a twin without a function", () => {
      expect(() => generate(island(using("<p />", "")), { ...config, twins: { X: { rust: "crate::x" } } })).toThrow(/`twins\.X` in ferrovue\.config\.json names components\/X\.vue, which ferrovue compiles/);
      expect(() => generate(island(using("<p />", "")), { ...CONFIG, twins: { VBtn: { rust: "v_btn" } } })).toThrow(/`twins\.VBtn` in ferrovue\.config\.json needs `rust`/);
      expect(() => generate(island(using("<p />", "")), { ...CONFIG, twins: { "v-btn": { rust: "crate::v_btn" } } })).toThrow(/in PascalCase/);
    });
  });
});
