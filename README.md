# ferrovue

[![crates.io](https://img.shields.io/crates/v/ferrovue.svg)](https://crates.io/crates/ferrovue)
[![docs.rs](https://img.shields.io/docsrs/ferrovue)](https://docs.rs/ferrovue)
[![npm](https://img.shields.io/npm/v/ferrovue.svg)](https://www.npmjs.com/package/ferrovue)
[![CI](https://github.com/Kinsmir/ferrovue/actions/workflows/ci.yml/badge.svg)](https://github.com/Kinsmir/ferrovue/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#licence)

Vue single-file components compiled to Rust render functions. With them, a Rust server renders a
component's HTML with no JavaScript at run time, and the browser hydrates the result with the same
`.vue` file.

```text
 Button.vue ──(ferrovue compiler, Node)──▶ button.rs ──(your Rust server)──▶ HTML ──▶ Vue hydrates it
```

ferrovue doesn't interpret templates. It takes what `@vue/compiler-sfc` compiles a template to for
server rendering (straight-line `_push` calls plus a few `@vue/server-renderer` helpers) and
translates that small, closed vocabulary into Rust that writes **the same bytes**. Vue still decides
element structure, attribute order, whitespace and fragment markers. If a single byte differed, the
browser would report a hydration mismatch, so anything outside that vocabulary is a compile error
that names the component and the construct. ferrovue never guesses.

The project has two halves:

| | What it is | Published as |
|---|---|---|
| `packages/ferrovue` | The compiler and the `ferrovue` command (TypeScript, runs on Node) | npm: [`ferrovue`](https://www.npmjs.com/package/ferrovue) |
| `crates/ferrovue` | The runtime the generated Rust calls: escaping, slots, islands, `<RouterLink>` matching. The router, vue-i18n and the escaping and number primitives they share are crates of their own (`crates/ferrovue-router`, `ferrovue-i18n`, `ferrovue-core`), which `ferrovue` re-exports | crates.io: [`ferrovue`](https://crates.io/crates/ferrovue) ([API docs](https://docs.rs/ferrovue)) |

## Quick start

### 1. Install both halves

```sh
pnpm add -D ferrovue          # or npm / yarn
cargo add ferrovue serde --features serde/derive
cargo add --dev serde_json    # the generated conformance helper uses it under cfg(test)
```

ferrovue supports the latest stable Rust, currently **1.99**. Generated code uses let-chains, so the
crate that includes it needs **edition 2024**.

### 2. Configure

`ferrovue.config.json` at your project root:

```json
{
  "components": "client/components",
  "out": "src/generated"
}
```

| Key | Required | Meaning |
|---|---|---|
| `components` | yes | Directory of `.vue` files to compile |
| `out` | yes | Directory the Rust modules are written to. **Everything in it is replaced.** |
| `routes` | no | JSON file listing the app's routes: each a vue-router path, or `{ "path", "name", "children" }`. Needed for `<RouterLink>`, `<RouterView>` and `useRoute()` |
| `router` | no | Instead of `routes`: `{ routes, base?, linkActiveClass?, linkExactActiveClass? }`, matching `createWebHistory(base)` and `createRouter`'s options |
| `stores` | no | Directory of Pinia option stores whose state components may read |
| `trustedHtml` | no | Rust type of a `TrustedHtml` prop, e.g. `crate::html::Sanitised` (needed for `v-html`) |
| `helpers` | no | `{ module, functions }`: functions a template may call, each mapped to a Rust twin |
| `i18n` | no | vue-i18n: `{ messages, locale?, fallbackLocale? }`, the directory of locale files (`en.json`, `nl.json`), the default locale and the fallbacks |
| `clientDirectives` | no | Custom directives with no server output (no `getSSRProps`), by name without `v-`: `["focus"]` |
| `scopeId` | no | How a `<style scoped>` id is hashed, as `@vitejs/plugin-vue` hashes it: `"filepath-source"` (the default, the plugin's in a production build) or `"filepath"`. See [Scoped styles](#scoped-styles) |
| `viteRoot` | no | Vite's root, relative to this file's directory, from which a component's path is hashed (default `.`) |

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
npx ferrovue init       # a starter ferrovue.config.json and components/Hello.vue
npx ferrovue            # writes src/generated/{greeting.rs, mod.rs}
npx ferrovue --check    # in CI: exits 1 if the committed modules are stale
npx ferrovue --check --diff   # …and shows what differs, as `diff -u` does
npx ferrovue --watch    # regenerates when components or configs change
```

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
// `data-props`. One that also takes slots, the route, stores, translations or teleports has `html()`,
// and the page's own app mounts it — see examples/fullstack.)

// …or straight into a buffer you already hold:
let mut page = String::from("<!doctype html><body>");
greeting::render(&mut page, &props);
```

With `routes` configured, the generated `route_table::router()` builds the router once. Resolve
each request's location with `router.at(path)` and pass the result to the components that take a
route.

The router and vue-i18n are features of the crate, `router` and `i18n`, both on by default. An
application with neither routes nor translations can leave them out, and build neither
`ferrovue-router` nor `ferrovue-i18n`: `ferrovue = { version = "0.4", default-features = false }`.

With the `maud` feature, `ferrovue::Html` implements `maud::Render`, so `(greeting::html(&props))` can go
straight into a `maud::html!` page.

With the `axum` feature, `Html` is an `IntoResponse`, and with `actix-web` a `Responder`: a handler
responds with the component, as `text/html; charset=utf-8`. `into_html(props)` and
`into_island(props)` take the props by value, so a handler that builds them returns the page:

```rust
async fn hello(Path(name): Path<String>) -> impl IntoResponse {
    greeting::into_html(greeting::Props::new(name, 0))
}
```

With the `dioxus` feature, a component goes into a Dioxus 0.7 page (`dioxus-ssr` or fullstack):
`{greeting::island(&props)}` in `rsx!` is the island element itself, with exactly the markup Vue
hydrates inside it. See `examples/dioxus` and the crate guide's
[Dioxus page](crates/ferrovue/docs/guide/dioxus.md).

## What a component may use

ferrovue compiles `<script setup lang="ts">` components. Props are declared by type, with
`defineProps<{ … }>()`, an interface, or a type alias.

| Area | Supported |
|---|---|
| Prop types | `string`, `number` (integers, `i64`, written and computed as JavaScript does — exact within ±2⁵³), `Float` from `ferrovue/types` (fractions, `f64`), `boolean`, string-literal unions (`"sm" \| "md"`), `T \| undefined`, arrays (`T[]`, `Array<T>`, `readonly T[]`), interfaces and object type aliases (recursive ones too), dictionaries (`Record<string, T>`, `{ [key: string]: T }`, `ferrovue::Record` in Rust, which keeps JavaScript's order of keys), another component's exported `Props`, `TrustedHtml` |
| Shared types | Interfaces and type aliases imported from `.ts` files (generated once, into `types.rs`), from a store's file, or from another component's `.vue` file; objects of a shared type can be passed between components |
| Props | `withDefaults`, destructured props with defaults (`const { size = "md" } = defineProps<…>()`), optional booleans (Vue casts an absent one to `false`), `defineModel` (named, required, with defaults), components with no props |
| Setup | `ref`/`shallowRef`, `computed` (an expression or a single `return`), plain `const`/`let`, `.value` in script code, helpers with Rust twins, a plain `<script>` block beside setup. Lifecycle hooks, `watch` (not `immediate`), `defineEmits`, `defineSlots`, `defineOptions`, `defineExpose`, `provide`, template refs (`ref(null)`, `useTemplateRef`) and functions are client-only. The template may name them only from event handlers, which the server drops |
| Text | `{{ }}` of strings, integers and booleans; `+`, `-`, `*`, `/`, `%`, with integers and fractions as JavaScript computes them; `<`, `>`, `<=`, `>=` (between numbers, or between strings by UTF-16 code unit), `===`, `!==`; unary `-`, `!`; `??`, `\|\|`, `&&`, `?:`; template literals; optional chaining `a?.b`; `.length`; `String()`, `.toString()`, `.toFixed()`, `Math.max`/`min`/`abs`/`round`/`floor`/`ceil`/`trunc`; `Number()`, `parseInt()` (no radix, 10 or 16), `parseFloat()`; `JSON.stringify()` of strings, numbers, booleans and lists of those; array literals |
| Strings | `.trim()`, `.trimStart()`, `.trimEnd()`, `.toUpperCase()`, `.toLowerCase()`, `.includes()`, `.startsWith()`, `.endsWith()`, `.indexOf()`, `.lastIndexOf()`, `.slice()`, `.substring()`, `.at()`, `.charAt()`, `.split()`, `.replace()` and `.replaceAll()` with string patterns (`$&`, `` $` ``, `$'`, `$$` read as JavaScript reads them), `.padStart()`, `.padEnd()`, `.repeat()`; indices and lengths count UTF-16 code units, as JavaScript's do (see [Strings](#strings)) |
| Conditions | `v-if` / `v-else-if` / `v-else`, `?:`, `&&` and `||`, with optional values narrowed as TypeScript narrows them: `v-if="user"`, `user !== undefined`, and `!user` or `user === undefined` for the `v-else` |
| Lists | `v-for` over arrays (of strings, numbers, objects or child props), array literals and number ranges (`n in 5`); with an index; with destructured items (`{ id, name } in rows`); nested; on `<template>`. `.includes()` (a number looked for in a list of numbers whether either is a `number` or a `Float`, as JavaScript compares them), `.join()`, and `.filter()`, `.map()`, `.some()`, `.every()`, `.find()`, `.findIndex()` with an arrow function of the item (a name, or destructured) and its index, whose body is an expression, narrowing inside as outside; `.slice()`; chained and nested; a computed list read by `v-for`, `.join()`, `.length`, `.includes()`, kept by `computed`, or handed to a child |
| Dictionaries | `v-for="(value, key, index) in r"` over a `Record<string, T>`, and `([key, value], index) in Object.entries(r)`, in JavaScript's order: keys that are array indices first, in numeric order, then the others as the props give them; `Object.keys(r)`, `Object.values(r)`, `Object.entries(r).length`; handed to a child |
| Attributes | static and bound attributes, boolean attributes, `:hidden`, `data-*` and `aria-*`, `v-bind` objects |
| `class` | strings, arrays, objects (`{ active: on }`, computed keys), `cond && "x"`, `cond ? "x" : null`, merged with a static `class` |
| `style` | objects (camelCase or kebab-case keys, `--custom` properties), arrays of objects, strings, merged with a static `style`, and `v-show`; later values override earlier ones as in Vue. A global `<style>` block is allowed |
| Scoped styles | `<style scoped>`: the id on every element, on child components' roots (a root that is itself a component, fragments, recursion and `inheritAttrs: false` as Vue renders them) and, from a component with `:slotted()` rules, on the slot content it is given, forwarded slots included; inside `<Transition>`, `<KeepAlive>`, `<Teleport>` and `v-if`; on `<RouterLink>` and what it holds, as vue-router renders them |
| Components | imported child components, `v-bind` of a child's own `Props`, `v-model` on a child's `defineModel`, recursion; props named in `kebab-case` or `camelCase` |
| Fallthrough attributes | what a parent passes a child beyond its props (static and bound attributes, `class`, `style`, `data-*`, `aria-*`, booleans, `undefined`): onto its single root, merged with the root's own class and style and replacing its other attributes where they stand, as Vue's `mergeProps` merges them; none for two roots; on through a root that is a component, or a `<RouterLink>`; with `inheritAttrs: false`, onto the elements or components that bind `v-bind="$attrs"` or a `useAttrs()` binding, before or after their own; beside scope ids. Listeners are dropped, as Vue's server drops them. See the crate's [`generated_code`](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#fallthrough-attributes) guide |
| Slots | default and named slots, fallbacks, `$slots.name` tests, scoped slots (`<slot :item="x">` and `#item="{ item }"` or `v-slot="props"`), whose props a parent can hand to its own children |
| Forms | `v-model` on text inputs, checkboxes, radios, `<select>` and `<textarea>` (renders the initial state) |
| Built-ins | `<Transition>`, `<TransitionGroup>`, `<KeepAlive>`, `<Suspense>` (synchronous content), `<Teleport>` (to any target, nested, disabled: see below), `v-text`, `v-once`, `v-pre`, `v-memo`, custom directives listed in `clientDirectives` |
| Vue Router | `<RouterLink>` (resolved by name or imported) with a string `to` or `{ name, params, query, hash }` / `{ path, query, hash }`, `active-class`, `exact-active-class`, `aria-current-value`, `replace`; vue-router's own encoding and active-link matching, nested routes included (a parent link is active on its children's pages, exact only on its own); a history base. `useRoute()` and `$route`: `path`, `fullPath`, `hash`, `name`, `params`, and `query` (a value written once, without `=`, or repeated, exactly as vue-router parses it; `typeof route.query.q === "string"` narrows one to a single string). `<RouterView>`, at the top and in nested route components: each takes the page it shows as a slot |
| Pinia | option stores with a typed `state`, and setup stores (`defineStore(id, () => { … })`) whose returned refs are typed by `ref<T>()` or their initial literal; read through `useX()` or `storeToRefs`, in the template or in `computed`; getters that are an expression of the state, and a setup store's computeds, which may read each other |
| vue-i18n | `$t` and `useI18n()`'s `t` and `locale`: named and list values, plurals by vue-i18n's rule, literals, linked messages with `upper`/`lower`/`capitalize`, nested and flat keys, fallback locales, a missing key shown as itself. Messages are parsed at build time by vue-i18n's own compiler |
| `v-html` | only on a `TrustedHtml` prop (`import type { TrustedHtml } from "ferrovue/types"`) |

Refused at compile time, each with an error that names the construct:

- `<style module>`, and `v-bind()` in CSS
- `<RouterView>` in a component with `<style scoped>`, which would give the page that component's
  id; and, since vue-router renders a link from virtual nodes, a `<slot>` inside a `<RouterLink>`
  that takes scope ids, or an element inside one in slot content given a `:slotted()` id
- `<component :is>`
- `<RouterLink custom>`, slot props that are array literals, defaults in destructured slot props, and outlets of one slot that pass different props
- custom directives not listed in `clientDirectives`
- `watchEffect`, `watch` with `immediate`, `onServerPrefetch`, top-level `await`, and statements in setup that change state
- `route.meta` and `route.matched`
- Pinia getters that read `this` or return a function
- ordering comparisons between a string and a number, which JavaScript makes numeric
- regular expressions (`.replace(/x/g, …)`, `.split(/,/)`), replacement functions, a search's
  starting position or a split's limit (`.includes(x, 3)`, `.split(",", 2)`), `.toLocaleUpperCase()`
  and `.toLocaleLowerCase()` (the server's locale is not the browser's), `parseInt` with another radix
  or of a number, `.repeat()` by a negative literal
- array methods given anything but an arrow function whose body is an expression (`.filter(Boolean)`,
  `x => { return … }`), `.map()` to optional values, a computed list as a slot prop
- a dictionary's field read by name (`r.key`, `r[key]`), which may be absent although TypeScript says
  it is not; `Object.entries()` anywhere but as a `v-for`'s source; dictionaries of optional values
- two strings that may each hold half of a surrogate pair compared, searched or joined (see
  [Strings](#strings))
- `null`
- an attribute (`class` and `style` aside) bound to a value that may be neither a string, a number
  nor a boolean: a list, an object, or a `route.query` value, which is an array when its key is
  repeated. Vue's server renderer leaves the attribute out and hydration then sets it, silently;
  join a list (`.join(",")`), or narrow a query value with `typeof route.query.q === "string"`
- any method call without a Rust twin
- a value read from `$attrs` or `useAttrs()` (`$attrs.title`), which has no type; an attribute a
  component is passed that would reach a prop of the component (or `<RouterLink>`) its root passes it
  on to; `$attrs` in a component that is the root of one that may be handed scope ids, where it would
  hold them; an attribute named by a number, or bound to a `$route.query` value; a class merged by
  `v-bind` with a string that may equal the class before it, which Vue would write once; attributes
  passed to a component whose root is a `<Transition>` or `<KeepAlive>` around a `v-if`, which Vue's
  server drops but its client keeps

An object prop handed to a child component is cloned. Its strings are `Cow`s, so borrowed ones
cost nothing to copy.

### Scoped styles

A `<style scoped>` component's elements carry `data-v-<id>`, and its CSS is rewritten by the client
build to select them. The server has to write the id the client build chose, which is not something
the browser checks when it hydrates: a wrong id hydrates cleanly and leaves the styles unapplied. So
ferrovue computes it as `@vitejs/plugin-vue` does — the first 8 hex digits of a SHA-256 of the
`.vue` file's path from Vite's root, followed by its source unless only the path is hashed — and the
two must be configured alike:

| `@vitejs/plugin-vue` | `ferrovue.config.json` |
|---|---|
| `vite build` with the default options | `"scopeId": "filepath-source"` (the default) |
| `features: { componentIdGenerator: "filepath" }` (any mode), or the dev server | `"scopeId": "filepath"` |

Set `viteRoot` when Vite's root is not the directory holding `ferrovue.config.json`. The Vite
plugin (`ferrovue/vite`) compares the two when a component has scoped styles: a build in which they
differ fails, and the dev server warns.

The default is the plugin's production behaviour because the production build is the one readers
get: with every option left alone, its styles apply. But plugin-vue hashes the path alone in its dev
server, so with the default a page rendered during development carries other ids than the dev
client and shows unstyled. The recommended setup is `componentIdGenerator: "filepath"` with
`"scopeId": "filepath"`, as [`examples/fullstack`](examples/fullstack) does: the ids are then the
same in development and production, and do not change, nor change the generated Rust, whenever a
component's source does.

A component a parent may hand ids to has a `render_scoped(…, attrs)` beside `render`, which
generated parents call (for one a parent also passes attributes to, `attrs` is an `fv::Attrs`
holding them and the ids). A component whose outlets pass a slot scope id (`:slotted()`) takes slot
content that is given it: `Slot::slotted` for a slot, a third `&str` parameter for a scoped slot's
closure. `render`, and content from Rust, need none of it: markup written from Rust carries no ids.

Where Vue's own server render gives other ids than its client render, ferrovue writes the server's:
a `:slotted()` component's slot fallback, which only the client gives the slot scope id, and a
component with `inheritAttrs: false` that is another component's root, whose root only the client
gives the ids that other component inherits.

### Strings

String methods count as JavaScript counts: in UTF-16 code units, so `"🦀".length` is 2 and
`"🦀 crab".slice(3)` is `"crab"`. Strings are ordered by code unit too, which puts every character
from U+E000 to U+FFFF after one beyond U+FFFF. Each runtime routine is held to vectors recorded from
JavaScript (`crates/*/tests/vectors/`).

A JavaScript string can hold half of a surrogate pair — `"🦀".slice(0, 1)`, `.charAt(1)`,
`.split("")` — and a Rust string cannot. ferrovue writes U+FFFD in its place, which is exactly what
the page carries anyway: a server sends Vue's string as UTF-8, and UTF-8 writes each half as U+FFFD
(`res.end`, `Buffer.from` and `TextEncoder` all do). Its length is the same. Where the half itself
would decide the result, ferrovue refuses at compile time: two strings that may each hold a half
compared or ordered, side by side (`a.slice(0, 1) + b.slice(1)`, a `.join("")`, a class object's
names), one searched for in another (`.includes(a.charAt(0))`), repeated or padded where halves
would join, ordered against anything but a literal below U+D800, or written by `JSON.stringify`
(which escapes it) or into a `<RouterLink>` (whose encoding throws). Three corners remain, by design:

- a string holding U+FFFD in the props compares equal to a half, or finds one, where JavaScript
  would tell them apart;
- a half handed to a child component or a helper is U+FFFD there, which matters only if that
  component then compares or joins it as above;
- Vue itself cannot hydrate such text cleanly: the browser reads U+FFFD where its own render holds
  the half, and reports a mismatch.

Where JavaScript throws, the generated code panics, as Vue's render rejects: a negative or infinite
`.repeat()` count, and a `.repeat()`, `.padStart()` or `.padEnd()` past the longest string V8 makes
(2²⁹ − 24 code units).

### Dictionaries

A `Record<string, T>` prop is a `ferrovue::Record`, built from pairs —
`[("b", 1), ("10", 2)].into_iter().collect()` — or read from JSON. It holds its keys in the order a
JavaScript object does, array indices (`"0"` to `"4294967294"`) first in numeric order, so `v-for`
walks them as Vue does, and it is written back as JSON in that order, which the browser reads back
the same.

### Translating

With `i18n` configured, the generated `i18n` module holds every locale's messages. Build an `I18n` per
request, in the reader's locale, and pass it to the components that translate:

```rust
let i18n = generated::i18n::i18n("nl"); // falls back as configured
page::render(&mut out, &props, &i18n);
```

### Teleports

A component that renders a `<Teleport>` takes a `ferrovue::Teleports`. After rendering the page body,
write what was teleported where each target is, as Vue's `ssrContext.teleports` is written:

```rust
let teleports = ferrovue::Teleports::new();
page::render(&mut body, &props, &teleports);
let modals = teleports.get("#modals").unwrap_or_default(); // inside <div id="modals">
```

As Vue recommends, teleport to a dedicated element (`#modals`) rather than `body`: the browser hydrates
a target from its first node, and `body` also holds the app.

### Scoped slots from Rust

A scoped slot's `Slots` field takes a closure that receives the props its outlet passes, as a
generated `…SlotProps` struct borrowed for the render. The closure returns whether it wrote content;
returning `false` shows the slot's fallback, as empty content does in Vue.

```rust
let row = |out: &mut String, p: &data_list::RowSlotProps<'_>| {
    ferrovue::escape_into(out, p.label);
    true
};
data_list::render(&mut page, &props, data_list::Slots { row: Some(&row), ..Default::default() });
```

### Hydrating islands

`mountIslands` from `ferrovue` hydrates every `data-island` element on the page with the
component of that name, from the props the server wrote. With the Vite plugin, `ferrovue/islands`
gives it every island there is, so nothing has to be listed by hand:

```ts
import { hydrateState, mountIslands } from "ferrovue";
import islands from "ferrovue/islands"; // written by `ferrovue()` from `ferrovue/vite`

hydrateState(pinia);
await mountIslands(islands, { pinia, router }); // one Pinia and one router for every island
```

The islands are exactly the components that have an `island()`: those that render from their props
alone, as the compiler finds while it generates them. That is the only set the server can write
`data-island` for, so it needs no folder convention or list to keep in step, and making a component
an island is a matter of the server calling its `island()`. Each is keyed by its `NAME`, the file
name without `.vue`, which is what `data-island` carries.

Each entry is a lazy `import()`, so the bundler gives every island a chunk of its own and a page
fetches the code of the islands it holds and no more. `mountIslands` takes such loaders and
components alike, so a hand-written island can join them: `mountIslands({ ...islands, Chart })`.
An island whose name is not among them is left as the server rendered it, with a warning naming it
(`onError` to handle it otherwise), as is one whose component fails to load.

An island's `<style>` goes into its chunk too, and Vite links it only once the island's script has
loaded, after the server's markup is on screen. Link those stylesheets from the page up front: a
server reading Vite's manifest takes the `css` of the entry's `dynamicImports` as well as its own
(`examples/fullstack/src/assets.rs`).

### Hydrating Pinia state

```rust
ferrovue::state_script_into(&mut page, "__pinia", &stores);   // a <script type="application/json">
```

```ts
import { hydrateState } from "ferrovue";
hydrateState(pinia); // before app.mount(): every store starts from what the server rendered
```

### Streaming with holes

`ferrovue::hole()` is a slot whose content you write later. Render a layout with holes,
`split_holes` the output, and stream the pieces with each hole's content between them, in whatever
order the content is ready. With the `axum` or `actix-web` feature, `ferrovue::HtmlStream` is that
streamed response, from the render and a future for each hole's content:

```rust
let body = ferrovue::HtmlStream::new(page).hole(async move { reviews_of(&id).await });
```

## Performance

Time to render one component to an HTML string. On the left is Vue's `renderToString` on Node, and
on the right is the Rust that ferrovue generated from the same `.vue` file. Both get the same props,
and both write the same bytes: each side checks its output against
`crates/ferrovue/benches/expected/<scenario>.html` before anything is timed.

| Scenario | What renders | Output | Vue `renderToString` | ferrovue | Speed-up |
|---|---|---|---|---|---|
| `small` | `Nav`: two `<RouterLink>`s resolved against the current route | 206 B | 34.57 µs | 0.950 µs | 36.4× |
| `list` | `Lists`: 1,000 words, 1,000 numbers, 100 groups of 10 members | 102 KiB | 368.1 µs | 45.95 µs | 8.0× |
| `tree` | `Tree`: a recursive component, binary tree 8 levels deep (255 nodes) | 9.5 KiB | 484.6 µs | 3.72 µs | 130.2× |
| `page` | `Dashboard`: 22 `Panel`s with named slots, a `Text`, 20 `Frame`s holding loops | 8.0 KiB | 181.6 µs | 4.45 µs | 40.9× |

These are mean times per render. The Vue column is tinybench's mean, with 5 s per scenario after
a 1 s warm-up. The ferrovue column is criterion's mean point estimate, using its defaults of a 3 s
warm-up and 100 samples.

What each side measures:

- **Vue**: one awaited `renderToString(app)`. Vue is the production build (`NODE_ENV=production`).
  Each component uses the `ssrRender` its SSR build would have. The app is created once outside
  the loop, along with its Pinia instance and, for `small`, a vue-router already at `/users/me`.
- **ferrovue**: a new `String` plus one call of the generated `render`, built with the release
  profile. The props, the router and the `Route` are built once outside the loop.

Measured on an AMD Ryzen 5 3600XT (6 cores / 12 threads, up to 3.8 GHz) with 62 GiB of RAM, running
Linux 7.2.8-2-cachyos (CachyOS, x86_64). Software: Node 26.10.0, Vue 3.5.43, rustc 1.99.0. The
machine was lightly loaded (a load average of about 1) but not idle, so treat the numbers as
indicative.

The speed-up says as much about Vue as about ferrovue. Most of Vue's time goes on component
instances and their virtual nodes, of which `tree` has 255 and `list` one: per byte written, Vue
renders `list` some fourteen times faster than `tree`, while ferrovue writes the two at a similar
rate.

To reproduce:

```sh
pnpm bench          # both halves: pnpm bench:rust, then pnpm bench:js
pnpm bench:rust     # cargo bench -p ferrovue --bench render   (crates/ferrovue/benches/render.rs)
pnpm bench:js       # Vue's renderToString with tinybench      (packages/ferrovue/bench/ssr.bench.ts)
pnpm bench:record   # rewrite benches/expected/*.html from Vue, after changing a scenario
```

The benchmarks are not part of `pnpm test`. CI runs both in a short mode only to check that they
still build, run and agree on the HTML. It never compares their timings.

## Versions

Byte-identical output depends on Vue's own SSR compiler, so ferrovue compiles with an exact
`@vue/compiler-sfc` (currently 3.5.43), and its conformance fixtures are recorded from one version
of Vue and of each integration. Your project may use any later patch of the same minor:

| Peer | Supported | Recorded from |
|---|---|---|
| `vue` | `~3.5.43` (3.5.43 and later 3.5 patches) | 3.5.43 |
| `vue-router` (optional) | `~5.3.1` | 5.3.1 |
| `pinia` (optional) | `~4.0.3` | 4.0.3 |
| `vue-i18n` (optional) | `~11.4.13` | 11.4.13 |

A new minor of any of them (Vue 3.6, vue-router 5.4, …) needs a ferrovue release that re-records
the fixtures from it. A weekly CI job re-records them from the newest patch each range allows and
hydrates the committed HTML with it, so a patch that changes what Vue writes or hydrates is caught
before it reaches you; a ferrovue patch follows when one does.

## Repository layout

```text
crates/ferrovue/             the Rust runtime crate, which generated code calls
  src/                       a module per part (`Html`, slots, class and style, the state script,
                             strings, teleports, fallthrough attributes), each module's unit tests
                             beside it in <module>/tests.rs; lib.rs re-exports them all, and the
                             three crates below
  tests/conformance/         components, fixtures, recorded HTML, generated Rust
  tests/vectors/             vectors recorded from JavaScript and Vue
  tests/properties.rs        property-based tests of the runtime
  benches/                   criterion benchmarks of generated renderers (see Performance)
crates/ferrovue-core/        escaping and JavaScript's numbers, which the other crates share
  tests/vectors/             vectors recorded from escapeHtml, String(n), Math and toFixed
crates/ferrovue-router/      vue-router's matching and links (the `router` feature)
  tests/vectors/             vectors recorded from vue-router
crates/ferrovue-i18n/        vue-i18n's t() (the `i18n` feature)
packages/ferrovue/           the compiler (npm package)
  src/index.ts               `ferrovue`: the browser API, `mountIslands`, `hydrateState` and the types
  src/compiler.ts            `ferrovue/compiler`: `generate`, `write`
  src/component.ts, script.ts, typescript.ts
                             a `.vue` file read, <script setup>, TypeScript types
  src/template.ts, children.ts, slots.ts, loops.ts
                             the compiled template: statements, child components, slots, v-for
  src/expr.ts, strings.ts, numbers.ts, narrowing.ts, calls.ts, lists.ts
                             expressions: operators, strings, numbers, narrowing, calls, lists
  src/attrs.ts, classes.ts, styles.ts, fallthrough.ts
                             attributes, class and style, attributes a parent passes on
  src/plugin.ts              the plugin interface (see CONTRIBUTING.md)
  src/plugins/               vue-router, Pinia, vue-i18n, scoped styles, <Teleport>, shared types
  src/rust.ts, emitter.ts    the Rust source written out
  src/cli.ts, vite.ts        the `ferrovue` command and the Vite plugin
  src/client.ts              browser-side helpers: `mountIslands`, `hydrateState`
  src/islands.ts             `ferrovue/islands`, which the Vite plugin writes: every island, loaded lazily
  src/testing.ts             utilities for a project's own conformance suite
  src/types.ts               `ferrovue/types`: `TrustedHtml`, `Float`
  test/                      compiler, CLI, router, vector, island, Vite and conformance tests
  browser/                   conformance fixtures hydrated in real browsers (`pnpm test:browser`)
  bench/                     Vue renderToString benchmarks, the other half of Performance
  fuzz/                      the randomised differential tester (`pnpm fuzz`)
examples/greeting/           the smallest setup: one component rendered from Rust
examples/fullstack/          axum + Vite: islands, Pinia state, routes and streaming
examples/dioxus/             a Dioxus page, rendered with dioxus-ssr, with an island in it
scripts/release.ts           the release version bump (see RELEASING.md)
```

## Development

```sh
pnpm install
pnpm test          # compiler, CLI and the Vue half of the conformance suite
pnpm typecheck
cargo test --all-features
```

[TESTING.md](TESTING.md) explains how the suite fits together and how to add a case,
[CONTRIBUTING.md](CONTRIBUTING.md) how to add support for a Vue construct, and
[RELEASING.md](RELEASING.md) how a release is cut.

[`examples/fullstack`](examples/fullstack/README.md) is a complete app to copy: an axum server, a Vite client, islands, Pinia, vue-router and streaming, with a test that it hydrates.

## Licence

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT licence](LICENSE-MIT),
at your option. Unless you explicitly state otherwise, any contribution you intentionally submit for
inclusion in this work, as defined in the Apache-2.0 licence, is dual-licensed as above, without any
additional terms or conditions.
