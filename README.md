# ferrovue

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
| `packages/ferrovue` | The compiler and the `ferrovue` command (TypeScript, runs on Node) | npm: `ferrovue` |
| `crates/ferrovue` | The runtime the generated Rust calls: escaping, slots, islands, `<RouterLink>` matching | crates.io: `ferrovue` |

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
| `routes` | no | JSON file listing the app's routes: each a vue-router path, or `{ "path", "name" }`. Needed for `<RouterLink>`, `<RouterView>` and `useRoute()` |
| `router` | no | Instead of `routes`: `{ routes, base?, linkActiveClass?, linkExactActiveClass? }`, matching `createWebHistory(base)` and `createRouter`'s options |
| `stores` | no | Directory of Pinia option stores whose state components may read |
| `trustedHtml` | no | Rust type of a `TrustedHtml` prop, e.g. `crate::html::Sanitised` (needed for `v-html`) |
| `helpers` | no | `{ module, functions }`: functions a template may call, each mapped to a Rust twin |
| `clientDirectives` | no | Custom directives with no server output (no `getSSRProps`), by name without `v-`: `["focus"]` |

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

let props = Props { name: "Ada".into(), unread: 3, note: None };

// The markup alone:
let html: String = greeting::html(&props).into_string();

// …or as an island the client hydrates: wrapped in
// <div data-island="Greeting" data-props="{…}">…</div>
let island = greeting::island(&props).into_string();

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
| Prop types | `string`, `number` (integers, `i64`), `boolean`, string-literal unions (`"sm" \| "md"`), `T \| undefined`, arrays (`T[]`, `Array<T>`, `readonly T[]`), interfaces and object type aliases (recursive ones too), another component's exported `Props`, `TrustedHtml` |
| Shared types | Interfaces and type aliases imported from `.ts` files (generated once, into `types.rs`), from a store's file, or from another component's `.vue` file; objects of a shared type can be passed between components |
| Props | `withDefaults`, destructured props with defaults (`const { size = "md" } = defineProps<…>()`), optional booleans (Vue casts an absent one to `false`), `defineModel` (named, required, with defaults), components with no props |
| Setup | `ref`/`shallowRef`, `computed` (an expression or a single `return`), plain `const`/`let`, `.value` in script code, helpers with Rust twins, a plain `<script>` block beside setup. Lifecycle hooks, `watch` (not `immediate`), `defineEmits`, `defineSlots`, `defineOptions`, `defineExpose`, `provide`, template refs (`ref(null)`, `useTemplateRef`) and functions are client-only. The template may name them only from event handlers, which the server drops |
| Text | `{{ }}` of strings, integers and booleans; `+`, `-`, `*`, `%` (literal divisor); `<`, `>`, `<=`, `>=`, `===`, `!==`; unary `-`, `!`; `??`, `\|\|`, `&&`, `?:`; template literals; optional chaining `a?.b`; `.length`; string `.trim()`, `.trimStart()`, `.trimEnd()`, `.toUpperCase()`, `.toLowerCase()`, `.includes()`, `.startsWith()`, `.endsWith()`; list `.includes()`, `.join()`; `String()`, `.toString()`, `Math.max`/`min`/`abs`; array literals |
| Conditions | `v-if` / `v-else-if` / `v-else`, with optional values narrowed inside the branch as TypeScript narrows them |
| Lists | `v-for` over arrays (of strings, numbers, objects or child props), array literals and number ranges (`n in 5`); with an index; with destructured items (`{ id, name } in rows`); nested; on `<template>` |
| Attributes | static and bound attributes, boolean attributes, `:hidden`, `data-*` and `aria-*`, `v-bind` objects |
| `class` | strings, arrays, objects (`{ active: on }`, computed keys), `cond && "x"`, `cond ? "x" : null`, merged with a static `class` |
| `style` | objects (camelCase or kebab-case keys, `--custom` properties), arrays of objects, strings, merged with a static `style`, and `v-show`; later values override earlier ones as in Vue. A global `<style>` block is allowed |
| Components | imported child components, `v-bind` of a child's own `Props`, `v-model` on a child's `defineModel`, recursion |
| Slots | default and named slots, fallbacks, `$slots.name` tests, scoped slots (`<slot :item="x">` and `#item="{ item }"` or `v-slot="props"`), whose props a parent can hand to its own children |
| Forms | `v-model` on text inputs, checkboxes, radios, `<select>` and `<textarea>` (renders the initial state) |
| Built-ins | `<Transition>`, `<TransitionGroup>`, `<KeepAlive>`, `<Suspense>` (synchronous content), `v-text`, `v-once`, `v-pre`, `v-memo`, custom directives listed in `clientDirectives` |
| Vue Router | `<RouterLink>` (resolved by name or imported) with a string `to` or `{ name, params, query, hash }` / `{ path, query, hash }`, `active-class`, `exact-active-class`, `aria-current-value`, `replace`; vue-router's own encoding and active-link matching; a history base. `useRoute()` and `$route`: `path`, `hash`, `name`, `params`. `<RouterView>` at the top level |
| Pinia | option stores with a typed `state`, read through `useX()` or `storeToRefs`, in the template or in `computed`; getters that are an expression of the state |
| `v-html` | only on a `TrustedHtml` prop (`import type { TrustedHtml } from "ferrovue/types"`) |

Refused at compile time, each with an error that names the construct:

- `<style scoped>`, `<style module>`, and `v-bind()` in CSS
- `<Teleport>` and `<component :is>`
- `<RouterLink custom>`, slot props that are array literals, defaults in destructured slot props, and outlets of one slot that pass different props
- custom directives not listed in `clientDirectives`
- `watchEffect`, `watch` with `immediate`, `onServerPrefetch`, top-level `await`, and statements in setup that change state
- `route.query` and `route.fullPath`, and setup stores
- Pinia getters that read `this` or return a function
- `/` and fractions, ordering comparisons of strings
- `null`
- any method call without a Rust twin

An object prop handed to a child component is cloned. Its strings are `Cow`s, so borrowed ones
cost nothing to copy.

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
packages/ferrovue/           the compiler (npm package)
  src/compiler.ts            .vue → Rust
  src/cli.ts                 the `ferrovue` command
  src/client.ts              browser-side helpers
  src/testing.ts             utilities for a project's own conformance suite
  test/                      compiler, CLI, router, vector and conformance tests
```

## Development

```sh
pnpm install
pnpm test          # compiler, CLI and the Vue half of the conformance suite
pnpm typecheck
cargo test --all-features
```

[TESTING.md](TESTING.md) explains how the suite fits together and how to add a case.

## Licence

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT licence](LICENSE-MIT),
at your option. Unless you explicitly state otherwise, any contribution you intentionally submit for
inclusion in this work, as defined in the Apache-2.0 licence, is dual-licensed as above, without any
additional terms or conditions.
