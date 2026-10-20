# ferrovue

[![crates.io](https://img.shields.io/crates/v/ferrovue.svg)](https://crates.io/crates/ferrovue)
[![npm](https://img.shields.io/npm/v/ferrovue.svg)](https://www.npmjs.com/package/ferrovue)
[![docs.rs](https://img.shields.io/docsrs/ferrovue)](https://docs.rs/ferrovue)
[![CI](https://github.com/Kinsmir/ferrovue/actions/workflows/ci.yml/badge.svg)](https://github.com/Kinsmir/ferrovue/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#licence)

Vue single-file components compiled to Rust render functions. A Rust server renders a component's
HTML with no JavaScript runtime, and the browser hydrates that HTML with the same `.vue` file.

- **No Node on the server.** The compiler runs at build time; the server is your Rust binary, and a
  render is a function call that writes into a `String`, 7.7 to 135 times faster than Vue's
  `renderToString` in the benchmarks (see [Performance](#performance)).
- **Byte-identical to Vue.** The generated Rust writes exactly the bytes Vue's `renderToString`
  writes for the same props, so Vue hydrates the page without a mismatch. Every supported construct
  is held to fixtures recorded from Vue.
- **Exact or refused.** What ferrovue cannot reproduce exactly is a compile error that names the
  file, line and construct. A component that compiles renders as Vue renders it.

```text
 Button.vue ──(ferrovue compiler, Node)──▶ button.rs ──(your Rust server)──▶ HTML ──▶ Vue hydrates it
```

ferrovue doesn't interpret templates. It takes what `@vue/compiler-sfc` compiles a template to for
server rendering (straight-line `_push` calls plus a few `@vue/server-renderer` helpers) and
translates that small, closed vocabulary into Rust that writes **the same bytes**. Vue still decides
element structure, attribute order, whitespace and fragment markers.

| | What it is | Published as |
|---|---|---|
| `packages/ferrovue` | The compiler, the `ferrovue` command, the Vite plugin and the browser client (TypeScript) | npm: [`ferrovue`](https://www.npmjs.com/package/ferrovue) |
| `crates/ferrovue` | The runtime the generated Rust calls: escaping, slots, islands, `<RouterLink>` matching. It re-exports `ferrovue-router`, `ferrovue-i18n` and `ferrovue-core`, released with it | crates.io: [`ferrovue`](https://crates.io/crates/ferrovue) ([API docs](https://docs.rs/ferrovue)) |

## Quick start

### 1. Install both halves

```sh
pnpm add -D ferrovue
cargo add ferrovue serde --features serde/derive
cargo add --dev serde_json    # the generated conformance helper uses it under cfg(test)
```

ferrovue needs Rust **1.89** or later (CI tests that and the latest stable). Generated code uses
let-chains, so the crate that includes it needs **edition 2024**.

### 2. Configure

`pnpm ferrovue init` writes a starter `ferrovue.config.json` and `components/Hello.vue`. Or write
the configuration at your project root yourself:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/ferrovue@0.8.0/schema.json",
  "components": "client/components",
  "out": "src/generated"
}
```

`$schema` points an editor at the configuration's JSON Schema, published with each version of the
npm package, so VS Code and other JSON editors complete the keys, describe them on hover and flag a
misspelt one. Name the version of `ferrovue` you use; `ferrovue init` writes it. ferrovue does not
read `$schema`. Offline, the copy in the installed package works as well:
`"$schema": "./node_modules/ferrovue/schema.json"`.

| Key | Required | Meaning |
|---|---|---|
| `components` | yes | Directory of `.vue` files to compile |
| `out` | yes | Directory the Rust modules are written to. **Every module ferrovue wrote there is replaced**, and one no component produces any more is removed; a `.rs` file without ferrovue's `// @generated` header is left alone, and `--check` reports it |
| `routes` | no | JSON file listing the app's routes: each a vue-router path, or `{ "path", "name", "children" }`. Or `{ "pages": "client/pages" }`: a folder of pages, whose file names give the routes as vue-router's file-based routing reads them (`index.vue`, `[id].vue`, `[[id]].vue`, `[...path].vue`, `(group)` folders, a `name.vue` beside `name/` as its layout), each page compiled as a component. Needed for `<RouterLink>`, `<RouterView>` and `useRoute()` |
| `router` | no | Instead of `routes`: `{ routes, base?, linkActiveClass?, linkExactActiveClass? }`, matching `createWebHistory(base)` and `createRouter`'s options |
| `stores` | no | Directory of Pinia option stores whose state components may read |
| `trustedHtml` | no | Rust type of a `TrustedHtml` prop (needed for `v-html`): `ferrovue::BasicHtml` (text with a few formatting tags, built in), `ferrovue::InlineHtml` (inline formatting tags only, built in, which makes every `TrustedHtml` prop inline HTML), `ferrovue::Sanitised` (HTML cleaned by ammonia, the `ammonia` feature), or a type of your own such as `crate::html::CleanHtml` |
| `dateType` | no | Rust type of a `Date` prop: `ferrovue::JsDate` (the default), `chrono::DateTime<chrono::Utc>` (the `chrono` feature), or a type of your own that implements `ferrovue::JsTime`. See [`dates_and_prices`](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html#date-props) |
| `helpers` | no | `{ module, functions }`: functions a template may call, each mapped to a Rust twin |
| `twins` | no | Components ferrovue does not compile, each rendered by a Rust function of yours: `{ "VBtn": { "rust": "crate::ui::v_btn", "props": { "label": "string" }, "slots": ["default"] } }`. See [Rust twins](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#rust-twins) |
| `i18n` | no | vue-i18n: `{ messages, locale?, fallbackLocale? }`, the directory of locale files (`en.json`, `nl.json`), the default locale and the fallbacks |
| `clientDirectives` | no | Custom directives with no server output (no `getSSRProps`), by name without `v-`: `["focus"]` |
| `scopeId` | no | How a `<style scoped>` id is hashed, as `@vitejs/plugin-vue` hashes it: `"filepath-source"` (the default, the plugin's in a production build) or `"filepath"`. See [`scoped_styles`](https://docs.rs/ferrovue/latest/ferrovue/guide/scoped_styles/index.html) |
| `viteRoot` | no | Vite's root, relative to this file's directory, from which a component's path is hashed (default `.`) |
| `isProduction` | no | Whether `@vitejs/plugin-vue` compiles for production, as Vite's `isProduction`: `true` (the default) for `vite build`, `false` for the dev server. It names the variables `v-bind()` in `<style>` sets. See [`scoped_styles`](https://docs.rs/ferrovue/latest/ferrovue/guide/scoped_styles/index.html) |
| `cssModules` | no | `{ generateScopedName, hashPrefix?, context? }`, as Vite's `css.modules` names CSS module classes: needed for `<style module>`. `context` is the directory Vite runs in (default `viteRoot`). See [`scoped_styles`](https://docs.rs/ferrovue/latest/ferrovue/guide/scoped_styles/index.html) |
| `builders` | no | `false` leaves out each props struct's and shared type's `new()` and setters, for an app that builds its props as struct literals (default `true`) |

### 3. Write a component

```vue
<!-- client/components/Greeting.vue -->
<script setup lang="ts">
defineProps<{ name: string; unread: number; note?: string }>();
</script>

<template>
  <p class="greeting">Hello, {{ name }}!<b v-if="unread">{{ unread }} new</b><i v-if="note">{{ note }}</i></p>
</template>
```

### 4. Generate and render

```sh
pnpm ferrovue           # writes src/generated/{greeting.rs, mod.rs}
pnpm ferrovue --check   # in CI: exits 1 if the committed modules are stale
pnpm ferrovue --check --diff  # …and shows what differs, as `diff -u` does
pnpm ferrovue --check --format json  # errors as JSON, for an editor or CI annotations
pnpm ferrovue --watch   # regenerates when components or configs change
```

`-c, --config <path>` reads another configuration file. `--watch` regenerates on a change to what a
run reads (the configuration, the components, stores, locale messages, pages or routes file, and
the `.ts` files components import types from). A Vite project can use the plugin instead, which
does the same in its dev server and before a build:

```ts
// vite.config.ts
import ferrovue from "ferrovue/vite";

export default { plugins: [ferrovue({ config: "config/ferrovue.json" })] };
```

`root` is the project root the configuration's paths are relative to (Vite's working directory by
default), and `config` the configuration file in it, as `--config` takes it (`ferrovue.config.json`
by default).

Every error carries a stable code, as `error[FV1805]: components/Card.vue:4:17: …`, documented in
the [`error_codes`](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html) guide.
`--format json` writes the same errors as JSON with the exit status unchanged; the
[quick start](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html#editor-and-ci-diagnostics)
has a VS Code problem matcher that puts them in the Problems panel.

```rust
#[rustfmt::skip]
mod generated;

use generated::greeting::{self, Props};

// `new` takes the required props; each optional one has a setter.
let props = Props::new("Ada", 3).note("welcome back");

// The markup alone:
let html: String = greeting::html(&props).into_string();

// …or as an island the client hydrates: wrapped in
// <div data-island="Greeting" data-props="{…}">…</div>
let island = greeting::island(&props).into_string();

// (`island()` exists for a component that renders from its props alone: the client rebuilds it from
// `data-props`. One that also takes slots, the route, stores, translations, teleports, provided
// values or the page head has `html()`, and the page's own app mounts it; see examples/fullstack.)

// …or straight into a buffer you already hold:
let mut page = String::from("<!doctype html><body>");
greeting::render(&mut page, &props);
```

On the client, `mountIslands(islands)` from `ferrovue`, with `islands` from `ferrovue/islands`
(written by the Vite plugin), hydrates every island on the page; see
[islands and hydration](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html).
With `routes` configured, the generated `route_table::router()` builds the router once. Resolve
each request's location with `router.at(path)` and pass the result to the components that take a
route.

The crate's features:

- `router` and `i18n`, both on by default: vue-router and vue-i18n. An application with neither
  routes nor translations can leave them out, and build neither `ferrovue-router` nor
  `ferrovue-i18n`: `ferrovue = { version = "0.8", default-features = false }`.
- `axum` and `actix-web`: `Html` is an `IntoResponse` or a `Responder`, so a handler responds with
  the component as `text/html; charset=utf-8`. `into_html(props)` and `into_island(props)` take the
  props by value, so a handler that builds them returns the page:

  ```rust
  async fn hello(Path(name): Path<String>) -> impl IntoResponse {
      greeting::into_html(greeting::Props::new(name, 0))
  }
  ```

- `stream`, which `axum` and `actix-web` turn on: `HtmlStream`, a page sent in the order its parts
  are ready.
- `maud`: `ferrovue::Html` implements `maud::Render`, so `(greeting::html(&props))` goes straight
  into a `maud::html!` page.
- `dioxus`: `{greeting::island(&props)}` in a Dioxus 0.7 `rsx!` is the island element itself, with
  exactly the markup Vue hydrates inside it (`examples/dioxus`).
- `ammonia`: `ferrovue::Sanitised`, HTML cleaned by [ammonia](https://docs.rs/ammonia), for
  `v-html`. `ferrovue::BasicHtml` and `ferrovue::InlineHtml` are built in; the
  [`escaping`](https://docs.rs/ferrovue/latest/ferrovue/guide/escaping/index.html) guide describes
  all three.

The crate's [feature flags](https://docs.rs/ferrovue/latest/ferrovue/index.html#feature-flags) list
what each adds.

### 5. Diagnostics in your editor

`ferrovue/volar` is a plugin for Vue's language tools, which the Vue (Official) extension for VS Code
and Vue support in other editors run. It compiles the project as you type and underlines what
ferrovue refuses in the open component, with the error's code linked to its documentation. Name it
in the `tsconfig.json` that includes your components, then run **Vue: Restart Vue and TS servers**:

```json
{
  "include": ["components/**/*.vue", "components/**/*.ts"],
  "vueCompilerOptions": { "plugins": ["ferrovue/volar"] }
}
```

The [quick start](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html#diagnostics-in-your-editor)
has the details; `examples/fullstack/tsconfig.json` enables it.

## What a component may use

ferrovue compiles `<script setup lang="ts">` components, and components with no script at all
(an icon, a divider), which take no props. Props are declared by type, with
`defineProps<{ … }>()`, an interface, or a type alias.

| Area | Supported |
|---|---|
| Prop types | `string`, `number` (integers, `i64`, written and computed as JavaScript does, exact within ±2⁵³), `Float` from `ferrovue/types` (fractions, `f64`), `boolean`, string-literal unions (`"sm" \| "md"`), `T \| undefined`, `T \| null` (an `Option` written as `null`), arrays (`T[]`, `Array<T>`, `readonly T[]`), interfaces and object type aliases (recursive ones too), dictionaries (`Record<string, T>`, `{ [key: string]: T }`, `ferrovue::Record` in Rust, which keeps JavaScript's order of keys), another component's exported `Props`, `TrustedHtml`, `InlineHtml`, `Date` (a component's own prop, optional or nullable too: `ferrovue::JsDate`, or `chrono::DateTime<Utc>` with the `chrono` feature) |
| Shared types | Interfaces and type aliases imported from `.ts` files (generated once, into `types.rs`), from a store's file, or from another component's `.vue` file; objects of a shared type can be passed between components. A TypeScript `enum` whose members are literals is the type of its values: a string, or a number |
| Constants | Constants imported from `.ts` files and `enum`s (imported, or declared in the component), evaluated when the component is compiled: strings, numbers, booleans, `null`, lists of them, objects of them read field by field (`LABELS.save`, `Tone.Loud`, `Rank[5]`), and lists of objects of them, which become a `const` in `types.rs` (`{ value, label }` items get a type named after the constant, `OptionsItem`, unless the constant is typed with an interface: `OPTIONS: Option[]`; a field that is `null` in some items is `T | null`). See the crate's [`props`](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#constants) guide |
| Props | `withDefaults`, destructured props with defaults (`const { size = "md" } = defineProps<…>()`), the props object (`const props = defineProps<…>()`, then `props.label` in the template or in script code), optional booleans (Vue casts an absent one to `false`), `defineModel` (named, required, with defaults), components with no props. A generic component (`<script setup generic="T extends Item">`) renders each type parameter as its constraint, which is all the template can rely on |
| Setup | `ref`/`shallowRef`, `computed` (an expression or a single `return`; one that may throw, through `.repeat()`, `.padStart()`, a date, `$t` or a helper, is evaluated where the render first reads it, once, as Vue does), refs that start empty, typed by their type argument (`ref<Row[]>([])`, `ref<Row>()`, `ref<string \| undefined>(undefined)`), plain `const`/`let`, `.value` in script code, helpers with Rust twins, a plain `<script>` block beside setup. Lifecycle hooks, `watch` (not `immediate`), `defineEmits`, `defineSlots`, `defineOptions`, `defineExpose`, template refs (`ref(null)`, `useTemplateRef`) and functions are client-only. The template may name them only from event handlers, which the server drops |
| Provide and inject | `provide` and `inject` resolved through the component tree, slot content seeing the providers of the component that renders it, as Vue does: keys that are string literals or `InjectionKey` symbols exported from `.ts` files; values that are props, refs, `computed`s, constants or objects of them (an interface's fields, `reactive()` unwrapping refs); defaults, factory defaults (`inject(k, () => …, true)`), object defaults built as the key's interface (`inject(k, { size: "md" })`), and keys holding functions, which only event handlers may call. A page rendered from Rust passes the generated `Provides`, empty or holding what the client app gives `app.provide`. See the crate's [`provide_inject`](https://docs.rs/ferrovue/latest/ferrovue/guide/provide_inject/index.html) guide |
| Text | `{{ }}` of strings, integers and booleans; `+`, `-`, `*`, `/`, `%`, with integers and fractions as JavaScript computes them; `<`, `>`, `<=`, `>=` (between numbers, or between strings by UTF-16 code unit), `===`, `!==`; unary `-`, `!`; `??`, `\|\|`, `&&`, `?:` (whose branches may differ in type where the value is only written out: in `{{ }}`, a string-valued attribute and a template literal, each branch is written as JavaScript writes it, `{{ n > 0 ? n : "none" }}`); template literals and `String()` of strings, numbers, booleans, values that may be absent (`undefined` or `null`, as JavaScript writes them) and lists (their items joined by `,`); `typeof`; optional chaining `a?.b`, `a?.[i]` and chains that go on past it (`a?.b.c`, `s?.trim().length`, `list?.at(-1)?.name`), with every property and method the value has when present, `undefined` as a whole once `a` is absent; `.length`; `.toString()`, `.toFixed()`, `.toPrecision()` and `.toExponential()` (with no argument or a literal one), `Math.max`/`min` (of a spread list too, `Math.max(...xs)`)/`abs`/`round`/`floor`/`ceil`/`trunc`/`sqrt`/`sign`, the constants of `Math` and `Number`, `**` and `Math.pow()` of an integer and a whole exponent known when compiling, exact within ±2⁵³; `Number()`, `parseInt()` (no radix, 10 or 16), `parseFloat()`; `Number.isNaN()`, `Number.isFinite()`, `Number.isInteger()` and `Number.isSafeInteger()` of a number, present or optional, and `isNaN()` and `isFinite()` of a present number; `JSON.stringify()` of strings, numbers, booleans and lists of those; `encodeURIComponent()` and `encodeURI()`; array literals |
| Strings | `.trim()`, `.trimStart()`, `.trimEnd()`, `.trimLeft()`, `.trimRight()`, `.toUpperCase()`, `.toLowerCase()`, `.includes()`, `.startsWith()`, `.endsWith()`, `.indexOf()` and `.lastIndexOf()`, with a position or without, `.slice()`, `.substring()`, `.substr()`, `.at()`, `.charAt()`, `.charCodeAt()`, `.codePointAt()`, `.concat()`, `.split()` with a limit or without, `.replace()` and `.replaceAll()` with string patterns (`$&`, `` $` ``, `$'`, `$$` read as JavaScript reads them), `.padStart()`, `.padEnd()`, `.repeat()`; indices and lengths count UTF-16 code units, as JavaScript's do (see the crate's [`strings`](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html) guide) |
| Dates | `new Date(s)` and `Date.parse(s)` of an ISO string (a date alone, or a date and time with a `Z` or an offset, as ECMAScript's date time string format specifies), `new Date(ms)`, `Date.UTC(…)` of one to seven parts, `.toISOString()`, `.toUTCString()`, `.toJSON()`, `JSON.stringify()`, `.getTime()`, `.valueOf()` and the `.getUTC…()` methods, and `<`, `<=`, `>` and `>=` between two dates, invalid dates included, as JavaScript computes them, a date's validity tested with `Number.isNaN(d.getTime())`, and dates chosen with `?:`, `??` and `||` (a date is always truthy, an invalid one too), of a date built in the template or of a `Date` prop, which an island's `data-props` carries as its ISO string and the client turns back into a `Date` before hydrating, and which may be handed to a child's `Date` prop. Prices and formatted dates are written in Rust and passed as strings, or filled into a `$t` message. See the crate's [`dates_and_prices`](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html) guide |
| Conditions | `v-if` / `v-else-if` / `v-else`, `?:`, `&&` and `||`, with optional and nullable values narrowed as TypeScript narrows them: `v-if="user"`, `user !== undefined`, `user !== null`, `user != null`, `typeof user !== "undefined"`, and `!user`, `user === undefined` or `user === null` for the `v-else` |
| Lists | `v-for` over arrays (of strings, numbers, objects or child props), array literals and number ranges (`n in 5`); with an index; with destructured items (`{ id, name } in rows`); nested; on `<template>`. `.includes()` (a number looked for in a list of numbers whether either is a `number` or a `Float`, as JavaScript compares them), `.join()`, and `.filter()`, `.map()`, `.some()`, `.every()`, `.find()`, `.findIndex()`, `.findLast()`, `.findLastIndex()` with an arrow function of the item (a name, or destructured) and its index, whose body is an expression, narrowing inside as outside, or with `Boolean`; `.filter(Boolean)` of a list or an array literal whose items may be `null` or `undefined`, which keeps the ones present and truthy as a list of the values (`[name, title, city].filter(Boolean).join(" · ")`); `Boolean(x)`; `.slice()`; an item by its index, `list[i]` with an integer `i` and `list.at(i)` (from the end when negative), `undefined` outside the list and narrowed as other optional values are (`v-if="rows[0]"`); `.indexOf()` and `.lastIndexOf()` of a string, number or boolean, compared with `===` (`NaN` found nowhere, `-0` found as `0`); `.concat()` of lists of one item type (numbers whether `number` or `Float`); `.reduce()` and `.reduceRight()` with an initial value, into a string, a number or a boolean; `.toReversed()`, and `.toSorted()` by `String(x)` as JavaScript sorts without a comparator (`[10, 9, 1]` to `[1, 10, 9]`) or by a comparator `(a, b) => a - b`, `a.k - b.k` of integers or `?:` over `<` and `>` of integers or strings, stable as JavaScript's; `[...list].sort(…)` and `[...list].reverse()`; spread in array literals (`[...a, x, ...b]`) of one item type; chained and nested; a computed list read by `v-for`, `.join()`, `.length`, `.includes()`, kept by `computed`, or handed to a child |
| Dictionaries | `v-for="(value, key, index) in r"` over a `Record<string, T>`, and `([key, value], index) in Object.entries(r)`, in JavaScript's order: keys that are array indices first, in numeric order, then the others as the props give them; `Object.keys(r)`, `Object.values(r)`, `Object.entries(r).length`; handed to a child |
| Attributes | static and bound attributes, boolean attributes, `:hidden`, `data-*` and `aria-*`, `v-bind` objects |
| `class` | strings, arrays, objects (`{ active: on }`, computed keys), `cond && "x"`, `cond ? "x" : null`, merged with a static `class` |
| `style` | objects (camelCase or kebab-case keys, `--custom` properties), arrays of objects, strings, merged with a static `style`, and `v-show`; later values override earlier ones as in Vue. A global `<style>` block is allowed |
| Scoped styles | `<style scoped>`: the id on every element, on child components' roots (a root that is itself a component, fragments, recursion and `inheritAttrs: false` as Vue renders them) and, from a component with `:slotted()` rules, on the slot content it is given, forwarded slots included; inside `<Transition>`, `<KeepAlive>`, `<Teleport>` and `v-if`; on `<RouterLink>` and what it holds, as vue-router renders them |
| `v-bind()` in `<style>` | variables bound to props, setup values, `computed`s and constants, quoted expressions included (`v-bind('size + "px"')`), in a scoped or global `<style>`: written into the root's `style` after its own and what a parent passes, on each root of a fragment, and handed to a root that is a component, as Vue's server writes them; `undefined` and `null` as `initial`, an empty string as a space; named as plugin-vue names them for production or development (`isProduction`) |
| CSS modules | `<style module>` and `<style module="name">`, read as `$style.x`, `name.x`, `$style['x-y']` and through `useCssModule()`, each class a constant in the generated code, when `cssModules` mirrors Vite's `css.modules.generateScopedName`: computed as postcss-modules computes it in Vite (`[local]`, `[name]`, `[hash:base64:5]`, `[path]` and the rest), composed classes, `@value`s and keyframes included |
| Components | imported child components, `v-bind` of a child's own `Props`, listeners in any form (`@x`, `v-on="obj"`, `@[name]`), which the server skips, `v-model` on a child's `defineModel`, recursion; props named in `kebab-case` or `camelCase`; `defineAsyncComponent(() => import("./X.vue"))` (or `{ loader: … }`), rendered as the component it loads, which Vue's server renderer waits for |
| `<component :is>` | over a closed set of choices, compiled to a `match`: an imported component (`:is="Card"`), an HTML element's name (`is="h2"`), a `computed` or `?:` choosing among them, a prop typed as a union of string literals (`as: "h1" \| "h2"`), and an object of imported components (or element names) declared in setup or imported from a `.ts` file, read by such a prop (`ICONS[name]`); props, fallthrough attributes, slots and scope ids reach each choice as they reach a static child; also inside `<KeepAlive>` and `<Transition>`. See the crate's [`generated_code`](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#component-is) guide |
| Escape hatches | `<ClientOnly>` from `ferrovue/client`, whose default slot the server never renders, so anything may go in it; components listed in `twins`, rendered by Rust functions of yours. See the crate's [`errors_and_limits`](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#client-only-content) guide |
| Fallthrough attributes | what a parent passes a child beyond its props (static and bound attributes, `class`, `style`, `data-*`, `aria-*`, booleans, `undefined`): onto its single root, merged with the root's own class and style and replacing its other attributes where they stand, as Vue's `mergeProps` merges them; none for two roots; on through a root that is a component, or a `<RouterLink>`; with `inheritAttrs: false`, onto the elements or components that bind `v-bind="$attrs"` or a `useAttrs()` binding, before or after their own; beside scope ids. Listeners are dropped, as Vue's server drops them. See the crate's [`generated_code`](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#fallthrough-attributes) guide |
| Slots | default and named slots, fallbacks, `$slots.name` tests and the same through `useSlots()`, scoped slots (`<slot :item="x">` and `#item="{ item }"` or `v-slot="props"`), whose props a parent can hand to its own children |
| Forms | `v-model` on text inputs, checkboxes, radios, `<select>` and `<textarea>` (renders the initial state) |
| Built-ins | `<Transition>`, `<TransitionGroup>`, `<KeepAlive>`, `<Suspense>` (synchronous content), `<Teleport>` (to any target, nested, disabled: see below), `v-text`, `v-once`, `v-pre`, `v-memo`, custom directives listed in `clientDirectives` |
| Vue Router | `<RouterLink>` (resolved by name or imported) with a string `to` or `{ name, params, query, hash }` / `{ path, query, hash }`, `active-class`, `exact-active-class`, `aria-current-value`, `replace`; vue-router's own encoding and active-link matching, nested routes included (a parent link is active on its children's pages, exact only on its own); a history base; optional parameters (`:id?`); routes built from a folder of pages, which the Vite plugin also gives the client as `ferrovue/routes`. `useRoute()` and `$route`: `path`, `fullPath`, `hash`, `name`, `params`, and `query` (a value written once, without `=`, or repeated, exactly as vue-router parses it; `typeof route.query.q === "string"` narrows one to a single string). `<RouterView>`, at the top and in nested route components: each takes the page it shows as a slot |
| Pinia | option stores with a typed `state`, and setup stores (`defineStore(id, () => { … })`) whose returned refs are typed by `ref<T>()` or their initial literal; read through `useX()` or `storeToRefs`, in the template or in `computed`; getters that are an expression of the state, and a setup store's computeds, which may read each other |
| vue-i18n | `$t` and `useI18n()`'s `t` and `locale`: named and list values, plurals by vue-i18n's rule, literals, linked messages with `upper`/`lower`/`capitalize`, nested and flat keys, fallback locales, a missing key shown as itself. Messages are parsed at build time by vue-i18n's own compiler |
| `v-html` | only on a `TrustedHtml` prop (`import type { TrustedHtml } from "ferrovue/types"`), or an `InlineHtml` one (inline tags only, `ferrovue::InlineHtml` on the server, with no `trustedHtml` needed), the only HTML it may write inside a `<p>`; never on a table's structure, a `<select>` or `<optgroup>`, or an SVG or MathML element that holds no HTML. See the crate's [`escaping`](https://docs.rs/ferrovue/latest/ferrovue/guide/escaping/index.html#where-v-html-may-go) guide |
| Page head | `useHead` (and `useServerHead`) from `@unhead/vue` 3: `title`, `titleTemplate`, `base`, `meta`, `link`, `script`, `style`, `noscript`, `htmlAttrs` and `bodyAttrs`, with values the server computes (props, setup bindings, getters such as `() => props.title`, `list.map(x => ({ … }))` for a list of tags), `key`, `tagPosition`, `tagPriority` and `tagDuplicateStrategy`; `useSeoMeta` (and `useServerSeoMeta`) of string, number, boolean and `null` values. Collected into a `ferrovue::Head` in the order Vue's server runs them, and written as unhead's `renderSSRHead` writes them: its tag order, deduplication, title template and escaping. See the crate's [`head`](https://docs.rs/ferrovue/latest/ferrovue/guide/head/index.html) guide |

Anything else is refused at compile time, with an error that names the file, line and column,
quotes the line and puts a caret under the construct. The
[`errors_and_limits`](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#refused-at-compile-time)
guide lists what is refused and why, and
[`error_codes`](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html) every code.

## Guides

The crate's guide, `ferrovue::guide` on docs.rs, covers each topic in depth:

- [Quick start](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html) and
  [the generated code](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html):
  what the compiler writes, and a component's `Props`, `render`, `html` and `island`
- [Props](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html): TypeScript types in
  Rust, dictionaries, shared types and [constants](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#constants)
- [Slots](https://docs.rs/ferrovue/latest/ferrovue/guide/slots/index.html), scoped slots from Rust
  included
- [Scoped styles](https://docs.rs/ferrovue/latest/ferrovue/guide/scoped_styles/index.html):
  `<style scoped>` ids that match `@vitejs/plugin-vue`, `v-bind()` in `<style>`, CSS modules
- [Routing](https://docs.rs/ferrovue/latest/ferrovue/guide/routing/index.html),
  [translating with vue-i18n](https://docs.rs/ferrovue/latest/ferrovue/guide/i18n/index.html),
  [Pinia](https://docs.rs/ferrovue/latest/ferrovue/guide/pinia/index.html) and
  [provide and inject](https://docs.rs/ferrovue/latest/ferrovue/guide/provide_inject/index.html)
- [Teleports](https://docs.rs/ferrovue/latest/ferrovue/guide/teleports/index.html) and
  [the page head](https://docs.rs/ferrovue/latest/ferrovue/guide/head/index.html) (`useHead`,
  `useSeoMeta`)
- [Islands and hydration](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html):
  islands, lazy hydration, a page hydrated whole, navigating between pages
- [Streaming](https://docs.rs/ferrovue/latest/ferrovue/guide/streaming/index.html) with holes,
  [web frameworks](https://docs.rs/ferrovue/latest/ferrovue/guide/web_frameworks/index.html) (axum,
  actix-web) and [Dioxus](https://docs.rs/ferrovue/latest/ferrovue/guide/dioxus/index.html)
- [Numbers](https://docs.rs/ferrovue/latest/ferrovue/guide/numbers/index.html),
  [strings](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html) and
  [dates and prices](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html):
  JavaScript's semantics in Rust
- [Escaping](https://docs.rs/ferrovue/latest/ferrovue/guide/escaping/index.html) and
  [security](https://docs.rs/ferrovue/latest/ferrovue/guide/security/index.html)
- [Testing against Vue](https://docs.rs/ferrovue/latest/ferrovue/guide/testing/index.html): your
  own components held to Vue with fixtures and two calls
- [Errors and limits](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html),
  with helpers, `<ClientOnly>` and Rust twins, and every
  [error code](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html)
- [Porting an existing app](https://docs.rs/ferrovue/latest/ferrovue/guide/porting/index.html)
  from a Node server that renders with Vue, and the
  [support policy](https://docs.rs/ferrovue/latest/ferrovue/guide/support/index.html): supported
  versions, fixes, deprecations and where to report a problem
- Upgrading a project [from 0.8 to 0.9](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_9/index.html)
  and [from 0.7 to 0.8](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_8/index.html)

[`examples/fullstack`](https://github.com/Kinsmir/ferrovue/blob/main/examples/fullstack/README.md)
is a complete app to copy: an axum server, a Vite client, islands, Pinia, vue-router and streaming,
with a test that it hydrates. [CONTRIBUTING.md](https://github.com/Kinsmir/ferrovue/blob/main/CONTRIBUTING.md)
describes the repository and how to work on it.

## Performance

Time to render one component to an HTML string: Vue's `renderToString` on Node, and the Rust that
ferrovue generated from the same `.vue` file, given the same props. Each side checks its output
against `crates/ferrovue/benches/expected/<scenario>.html` before anything is timed.

| Scenario | What renders | Output | Vue `renderToString` | ferrovue | Speed-up |
|---|---|---|---|---|---|
| `small` | `Nav`: two `<RouterLink>`s resolved against the current route | 206 B | 36.41 µs | 0.989 µs | 36.8× |
| `list` | `Lists`: 1,000 words, 1,000 numbers, 100 groups of 10 members | 102 KiB | 355.8 µs | 46.16 µs | 7.7× |
| `tree` | `Tree`: a recursive component, binary tree 8 levels deep (255 nodes) | 9.5 KiB | 522.2 µs | 3.86 µs | 135.2× |
| `page` | `Dashboard`: 22 `Panel`s with named slots, a `Text`, 20 `Frame`s holding loops | 8.0 KiB | 181.3 µs | 5.06 µs | 35.8× |

Mean times per render. Vue: tinybench's mean of one awaited `renderToString(app)`, 5 s per
scenario after a 1 s warm-up, the production build, each component with its SSR build's
`ssrRender`, the app, Pinia and (for `small`) a vue-router at `/users/me` created outside the loop.
ferrovue: criterion's mean point estimate (3 s warm-up, 100 samples) of a new `String` and one call
of the generated `render`, release profile, the props, router and `Route` built outside the loop.

Measured on an AMD Ryzen 5 3600XT (6 cores / 12 threads, up to 3.8 GHz) with 62 GiB of RAM, running
Linux 7.2.8-2-cachyos (CachyOS, x86_64), Node 26.10.0, Vue 3.5.43 and rustc 1.99.0, lightly loaded
(a load average of about 1): treat the numbers as indicative. Most of Vue's time goes on component
instances and their virtual nodes, of which `tree` has 255 and `list` one: per byte written, Vue
renders `list` some fourteen times faster than `tree`, while ferrovue writes the two at a similar
rate.

`pnpm bench` runs both halves (`pnpm bench:rust`, then `pnpm bench:js`), and `pnpm bench:record`
rewrites `benches/expected/*.html` from Vue after a scenario changes. CI runs both in a short mode
to check they build, run and agree on the HTML, and holds the instructions each scenario runs to
within 5% of a committed baseline, and the time ferrovue and `cargo build` take on a project of 500
components to a budget; [TESTING.md](https://github.com/Kinsmir/ferrovue/blob/main/TESTING.md#performance-budgets)
describes both.

## Versions

Byte-identical output depends on Vue's own SSR compiler, so ferrovue compiles with an exact
`@vue/compiler-sfc` (currently 3.5.44), and its conformance fixtures are recorded from one version
of Vue and of each integration. Your project may use any later patch of the same minor:

| Peer | Supported | Recorded from |
|---|---|---|
| `vue` | `~3.5.44` (3.5.44 and later 3.5 patches) | 3.5.44 |
| `vue-router` (optional) | `~5.4.0` | 5.4.0 |
| `pinia` (optional) | `~4.1.0` | 4.1.0 |
| `vue-i18n` (optional) | `~11.4.15` | 11.4.15 |
| `@unhead/vue` (optional) | `~3.4.3` | 3.4.3 |

A new minor of any of them (Vue 3.6, vue-router 5.5, …) needs a ferrovue release that re-records
the fixtures from it. A weekly CI job re-records them from the newest patch each range allows and
hydrates the committed HTML with it, so a patch that changes what Vue writes or hydrates is caught
before it reaches you; a ferrovue patch follows when one does.

### Upgrading

Until 1.0, versions are 0.MINOR.PATCH: raising MINOR (0.9.2 to 0.10.0) may change the
configuration, the generated code and the crates' API, and raising PATCH (0.10.0 to 0.10.1) breaks
none of them. The npm package and the crates share one version, so upgrade them together and
generate your components again. The
[CHANGELOG](https://github.com/Kinsmir/ferrovue/blob/main/CHANGELOG.md) lists what each release
changes, and the [guides](#guides) have an upgrade page for each MINOR release.

### Deprecations

What ferrovue stops supporting is deprecated for at least one minor release before it is removed:
in a later minor release before 1.0, and only in a major release from 1.0. A deprecated crate item carries `#[deprecated]`; a deprecated configuration key warns
with `warning[FV1117]` and a command-line option with `warning[FV1118]`, naming the replacement, and the JSON Schema marks a deprecated key for editors.
Each release's CHANGELOG lists what it deprecates under "Deprecated".

## Licence

Licensed under either of [Apache License, Version 2.0](https://github.com/Kinsmir/ferrovue/blob/main/LICENSE-APACHE) or [MIT licence](https://github.com/Kinsmir/ferrovue/blob/main/LICENSE-MIT),
at your option. Unless you explicitly state otherwise, any contribution you intentionally submit for
inclusion in this work, as defined in the Apache-2.0 licence, is dual-licensed as above, without any
additional terms or conditions.
