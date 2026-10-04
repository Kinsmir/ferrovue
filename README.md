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
| `crates/ferrovue` | The runtime the generated Rust calls: escaping, slots, islands, `<RouterLink>` matching | crates.io: [`ferrovue`](https://crates.io/crates/ferrovue) ([API docs](https://docs.rs/ferrovue)) |

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
npx ferrovue            # writes src/generated/{greeting.rs, mod.rs}
npx ferrovue --check    # in CI: exits 1 if the committed modules are stale
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

With the `maud` feature, `ferrovue::Html` implements `maud::Render`, so `(greeting::html(&props))` can go
straight into a `maud::html!` page.

## What a component may use

ferrovue compiles `<script setup lang="ts">` components. Props are declared by type, with
`defineProps<{ … }>()`, an interface, or a type alias.

| Area | Supported |
|---|---|
| Prop types | `string`, `number` (integers, `i64`, written and computed as JavaScript does — exact within ±2⁵³), `Float` from `ferrovue/types` (fractions, `f64`), `boolean`, string-literal unions (`"sm" \| "md"`), `T \| undefined`, arrays (`T[]`, `Array<T>`, `readonly T[]`), interfaces and object type aliases (recursive ones too), another component's exported `Props`, `TrustedHtml` |
| Shared types | Interfaces and type aliases imported from `.ts` files (generated once, into `types.rs`), from a store's file, or from another component's `.vue` file; objects of a shared type can be passed between components |
| Props | `withDefaults`, destructured props with defaults (`const { size = "md" } = defineProps<…>()`), optional booleans (Vue casts an absent one to `false`), `defineModel` (named, required, with defaults), components with no props |
| Setup | `ref`/`shallowRef`, `computed` (an expression or a single `return`), plain `const`/`let`, `.value` in script code, helpers with Rust twins, a plain `<script>` block beside setup. Lifecycle hooks, `watch` (not `immediate`), `defineEmits`, `defineSlots`, `defineOptions`, `defineExpose`, `provide`, template refs (`ref(null)`, `useTemplateRef`) and functions are client-only. The template may name them only from event handlers, which the server drops |
| Text | `{{ }}` of strings, integers and booleans; `+`, `-`, `*`, `/`, `%`, with integers and fractions as JavaScript computes them; `<`, `>`, `<=`, `>=`, `===`, `!==`; unary `-`, `!`; `??`, `\|\|`, `&&`, `?:`; template literals; optional chaining `a?.b`; `.length`; string `.trim()`, `.trimStart()`, `.trimEnd()`, `.toUpperCase()`, `.toLowerCase()`, `.includes()`, `.startsWith()`, `.endsWith()`; list `.includes()`, `.join()`; `String()`, `.toString()`, `.toFixed()`, `Math.max`/`min`/`abs`/`round`/`floor`/`ceil`/`trunc`; array literals |
| Conditions | `v-if` / `v-else-if` / `v-else`, `?:`, `&&` and `||`, with optional values narrowed as TypeScript narrows them: `v-if="user"`, `user !== undefined`, and `!user` or `user === undefined` for the `v-else` |
| Lists | `v-for` over arrays (of strings, numbers, objects or child props), array literals and number ranges (`n in 5`); with an index; with destructured items (`{ id, name } in rows`); nested; on `<template>` |
| Attributes | static and bound attributes, boolean attributes, `:hidden`, `data-*` and `aria-*`, `v-bind` objects |
| `class` | strings, arrays, objects (`{ active: on }`, computed keys), `cond && "x"`, `cond ? "x" : null`, merged with a static `class` |
| `style` | objects (camelCase or kebab-case keys, `--custom` properties), arrays of objects, strings, merged with a static `style`, and `v-show`; later values override earlier ones as in Vue. A global `<style>` block is allowed |
| Scoped styles | `<style scoped>`: the id on every element, on child components' roots (a root that is itself a component, fragments, recursion and `inheritAttrs: false` as Vue renders them) and, from a component with `:slotted()` rules, on the slot content it is given, forwarded slots included; inside `<Transition>`, `<KeepAlive>`, `<Teleport>` and `v-if` |
| Components | imported child components, `v-bind` of a child's own `Props`, `v-model` on a child's `defineModel`, recursion |
| Slots | default and named slots, fallbacks, `$slots.name` tests, scoped slots (`<slot :item="x">` and `#item="{ item }"` or `v-slot="props"`), whose props a parent can hand to its own children |
| Forms | `v-model` on text inputs, checkboxes, radios, `<select>` and `<textarea>` (renders the initial state) |
| Built-ins | `<Transition>`, `<TransitionGroup>`, `<KeepAlive>`, `<Suspense>` (synchronous content), `<Teleport>` (to any target, nested, disabled: see below), `v-text`, `v-once`, `v-pre`, `v-memo`, custom directives listed in `clientDirectives` |
| Vue Router | `<RouterLink>` (resolved by name or imported) with a string `to` or `{ name, params, query, hash }` / `{ path, query, hash }`, `active-class`, `exact-active-class`, `aria-current-value`, `replace`; vue-router's own encoding and active-link matching, nested routes included (a parent link is active on its children's pages, exact only on its own); a history base. `useRoute()` and `$route`: `path`, `fullPath`, `hash`, `name`, `params`, and `query` (a value written once, without `=`, or repeated, exactly as vue-router parses it). `<RouterView>`, at the top and in nested route components: each takes the page it shows as a slot |
| Pinia | option stores with a typed `state`, and setup stores (`defineStore(id, () => { … })`) whose returned refs are typed by `ref<T>()` or their initial literal; read through `useX()` or `storeToRefs`, in the template or in `computed`; getters that are an expression of the state, and a setup store's computeds, which may read each other |
| vue-i18n | `$t` and `useI18n()`'s `t` and `locale`: named and list values, plurals by vue-i18n's rule, literals, linked messages with `upper`/`lower`/`capitalize`, nested and flat keys, fallback locales, a missing key shown as itself. Messages are parsed at build time by vue-i18n's own compiler |
| `v-html` | only on a `TrustedHtml` prop (`import type { TrustedHtml } from "ferrovue/types"`) |

Refused at compile time, each with an error that names the construct:

- `<style module>`, and `v-bind()` in CSS
- `<RouterLink>` in a component with `<style scoped>`, or where one would hand it ids (its root, or
  `:slotted()` slot content), and `<RouterView>` in a scoped component: vue-router renders them as
  virtual nodes, which take ids by rules of their own
- `<component :is>`
- `<RouterLink custom>`, slot props that are array literals, defaults in destructured slot props, and outlets of one slot that pass different props
- custom directives not listed in `clientDirectives`
- `watchEffect`, `watch` with `immediate`, `onServerPrefetch`, top-level `await`, and statements in setup that change state
- `route.meta` and `route.matched`
- Pinia getters that read `this` or return a function
- ordering comparisons of strings
- `null`
- any method call without a Rust twin

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

Set `viteRoot` when Vite's root is not the directory holding `ferrovue.config.json`.

The default is the plugin's production behaviour because the production build is the one readers
get: with every option left alone, its styles apply. But plugin-vue hashes the path alone in its dev
server, so with the default a page rendered during development carries other ids than the dev
client and shows unstyled. The recommended setup is `componentIdGenerator: "filepath"` with
`"scopeId": "filepath"`, as [`examples/fullstack`](examples/fullstack) does: the ids are then the
same in development and production, and do not change, nor change the generated Rust, whenever a
component's source does.

A component a parent may hand ids to has a `render_scoped(…, attrs)` beside `render`, which
generated parents call. A component whose outlets pass a slot scope id (`:slotted()`) takes slot
content that is given it: `Slot::slotted` for a slot, a third `&str` parameter for a scoped slot's
closure. `render`, and content from Rust, need none of it: markup written from Rust carries no ids.

Where Vue's own server render gives other ids than its client render, ferrovue writes the server's:
a `:slotted()` component's slot fallback, which only the client gives the slot scope id, and a
component with `inheritAttrs: false` that is another component's root, whose root only the client
gives the ids that other component inherits.

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

### Hydrating Pinia state

```rust
ferrovue::state_script_into(&mut page, "__pinia", &stores);   // a <script type="application/json">
```

```ts
import { hydrateState } from "ferrovue/client";
hydrateState(pinia); // before app.mount(): every store starts from what the server rendered
```

### Streaming with holes

`ferrovue::hole()` is a slot whose content you write later. Render a layout with holes,
`split_holes` the output, and stream the pieces with each hole's content between them, in whatever
order the content is ready.

## Performance

Time to render one component to an HTML string. On the left is Vue's `renderToString` on Node, and
on the right is the Rust that ferrovue generated from the same `.vue` file. Both get the same props,
and both write the same bytes: each side checks its output against
`crates/ferrovue/benches/expected/<scenario>.html` before anything is timed.

| Scenario | What renders | Output | Vue `renderToString` | ferrovue | Speed-up |
|---|---|---|---|---|---|
| `small` | `Nav`: two `<RouterLink>`s resolved against the current route | 206 B | 37.99 µs | 0.948 µs | 40.1× |
| `list` | `Lists`: 1,000 words, 1,000 numbers, 100 groups of 10 members | 102 KiB | 357.5 µs | 103.9 µs | 3.4× |
| `tree` | `Tree`: a recursive component, binary tree 8 levels deep (255 nodes) | 9.5 KiB | 478.4 µs | 4.68 µs | 102.3× |
| `page` | `Dashboard`: 22 `Panel`s with named slots, a `Text`, 20 `Frame`s holding loops | 8.0 KiB | 194.8 µs | 5.63 µs | 34.6× |

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
machine was not otherwise idle, so treat the numbers as indicative.

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

Byte-identical output depends on Vue's own SSR compiler, so the package pins **`vue`,
`@vue/compiler-sfc` and `@vue/server-renderer` to an exact version** (currently 3.5.43). Upgrading
Vue means re-running the conformance suite (see [TESTING.md](TESTING.md)) and releasing a new
ferrovue version.

## Repository layout

```text
crates/ferrovue/             the Rust runtime crate
  src/                       runtime + unit tests
  tests/conformance/         components, fixtures, recorded HTML, generated Rust
  tests/vectors/             string and router vectors shared with the TypeScript tests
  tests/properties.rs        property-based tests of the runtime
  benches/                   criterion benchmarks of generated renderers (see Performance)
packages/ferrovue/           the compiler (npm package)
  src/compiler.ts            .vue → Rust
  src/cli.ts                 the `ferrovue` command
  src/client.ts              browser-side helpers
  src/testing.ts             utilities for a project's own conformance suite
  test/                      compiler, CLI, router, vector and conformance tests
  bench/                     Vue renderToString benchmarks, the other half of Performance
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
