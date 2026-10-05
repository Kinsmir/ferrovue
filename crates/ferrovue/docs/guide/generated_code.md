What the compiler writes, and the API each component gets.

Generated code is ordinary Rust that calls this crate: there is no template engine and no
reflection at run time. Commit it, and let `npx ferrovue --check` in CI catch a stale copy.

# The output directory

Everything in the configured `out` directory is replaced on each run.

| File | Written when | Holds |
|---|---|---|
| `mod.rs` | always | One `pub mod` per file below, and a `#[cfg(test)]` `render_json` for a project's conformance tests |
| `<component>.rs` | one per `.vue` file | The component's types and renderers: `DataList.vue` becomes `data_list.rs` |
| `types.rs` | a component imports types from a `.ts` file | Those types, written once so components passing them to one another agree on them |
| `route_table.rs` | `routes` or `router` is configured | The routes and `router()`. See [`routing`](crate::guide::routing) |
| `stores.rs` | `stores` is configured | A struct per store's state and `Stores`, all of them. See [`pinia`](crate::guide::pinia) |
| `i18n.rs` | `i18n` is configured | Every locale's messages and `i18n(locale)`. See [`i18n`](crate::guide::i18n) |

Include the directory as one module. `#[rustfmt::skip]` keeps rustfmt from rewriting it:

```rust,ignore
#[rustfmt::skip]
mod generated;
```

The modules pass rustc's default warnings and `cargo clippy -- -D warnings`, so they can sit in a
crate that denies warnings. `mod.rs` allows one lint for all of them, at its top:

```rust,ignore
// The modules pass rustc's default warnings and clippy's default lints, with one exception:
// `dead_code`. Every component gets the whole of its API (`render`, `html`, `island`, their
// `into_` forms, `NAME`, a constructor and a setter per optional prop) and an app calls only what
// it needs.
#![allow(dead_code)]
```

The only other allow is on a props constructor that takes more than seven required props, which
allows `clippy::too_many_arguments` because it takes one argument per required field.

# A component's module

Every component module has, in this order:

| Item | What it is |
|---|---|
| `NAME` | The component's name, `"DataList"`: what `data-island` carries |
| One struct per local `interface` or object `type` | `Row` for `export interface Row { … }`, with the same derives and builder as `Props` |
| `Props<'a>` | The props, one field per prop. See [`props`](crate::guide::props) |
| `…SlotProps<'v>` and `…Slot<'s>` | For each scoped slot: what its outlet passes (with `<'v>` only when it borrows), and the closure type a parent supplies. See [`slots`](crate::guide::slots) |
| `Slots<'s>` | When the component renders a `<slot>` or `<RouterView>`: what a parent puts in each |
| `render` | Write the component into a buffer |
| `render_scoped` | Only for a component a parent may hand `<style scoped>` ids to: `render` with those ids last. Generated parents call it; it is `#[doc(hidden)]`. See [`scoped_styles`](crate::guide::scoped_styles) |
| `html` | The same render as an [`Html`](crate::Html) value |
| `island` | Only for a component that renders from its props alone: the render wrapped as a hydratable island |
| `into_html` and `into_island` | Beside `island`: `html` and `island` taking the props by value, so the `Html` holds them |

`Props` has no lifetime when none of its fields borrow (a component whose props are all numbers
and booleans has `Props`, not `Props<'a>`), and a component with no props has an empty `Props`.

# `render` and its parameters

`render` always takes the buffer first and the props second. After them come only the parameters
the component needs, always in this order:

```rust,ignore
pub fn render(
    out: &mut String,
    props: &Props<'_>,
    fv_slots: Slots<'_>,                          // renders <slot> or <RouterView>
    fv_route: &fv::Route<'_>,                     // <RouterLink>, useRoute() or $route
    fv_stores: &super::stores::Stores<'_>,        // reads a Pinia store
    fv_i18n: &fv::I18n,                           // $t or useI18n()
    fv_teleports: &fv::Teleports,                 // <Teleport>
)
```

A component needs a parameter when it uses the feature itself **or renders a child that does**: a
`Card` whose child `Badge` reads a store takes the stores too, and passes them on. Generated parents
call their children's `render` directly, so a page renders in one pass with no intermediate
strings. The `fv_` prefix keeps these names apart from anything a template names.

So, from the repository's own test components:

```rust,ignore
// Greeting.vue: props alone.
pub fn render(out: &mut String, props: &Props<'_>)
// Layout.vue: <RouterView> and two <RouterLink>s.
pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>, fv_route: &fv::Route<'_>)
// Card.vue: renders Badge, which reads a store.
pub fn render(out: &mut String, props: &Props<'_>, fv_stores: &super::stores::Stores<'_>)
// Modal.vue: <Teleport>.
pub fn render(out: &mut String, props: &Props<'_>, fv_teleports: &fv::Teleports)
```

A component that a parent may hand scope ids to (see [`scoped_styles`](crate::guide::scoped_styles))
also has a `render_scoped`, which takes the parameters of `render` and then `fv_attrs: &str`, the
ids its root carries besides its own. Its `render` calls it with `""`:

```rust,ignore
pub fn render(out: &mut String, props: &Props<'_>) {
    render_scoped(out, props, "");
}

/// [`render`], with the scope ids a parent hands the root: ` data-v-…` each.
#[doc(hidden)]
pub fn render_scoped(out: &mut String, props: &Props<'_>, fv_attrs: &str) {
    // …
}
```

A `render` or `render_scoped` that never reads its props, such as a component's that only passes
its slot on, names the parameter `_props`, so that the module compiles without warnings; it is
still the second parameter.

`render` appends to `out` and never reads or rewrites what is already there, so a page can be
assembled in one `String`: write the document's head, render the body's components into the same
buffer, write the tail. It first reserves an estimate of what it will write, from its literal
markup, the strings its props hold and the numbers it writes, once per item for a loop, so that the
buffer grows once.

# `html` and `island`

`html` takes the same parameters as `render`, minus the buffer, and returns an
[`Html`](crate::Html): the render applied to its arguments, not yet run. Write it with
[`Html::render_to`](crate::Html::render_to) or [`Html::into_string`](crate::Html::into_string), or,
with the `maud` feature, splice it into a `maud::html!` template, where it is written straight into
maud's buffer:

```rust,ignore
// With ferrovue's `maud` feature.
let page = maud::html! {
    (maud::DOCTYPE)
    body { (greeting::html(&props)) }
};
```

With the `axum` or `actix-web` feature, an `Html` is also a response of its own;
[`web_frameworks`](crate::guide::web_frameworks) shows how.

`island` exists only for a component whose render needs nothing but its props, because the client
rebuilds the component from the props in `data-props` and nothing else. It wraps the markup as

```html
<div data-island="Greeting" data-props="{&quot;name&quot;:&quot;Ada&quot;,&quot;unread&quot;:3}">…</div>
```

with the props serialised by `serde_json` and attribute-escaped. A component that takes slots, the
route, stores, translations or teleports has no `island`; the page's own Vue app hydrates it
instead. See [`islands_and_hydration`](crate::guide::islands_and_hydration).

`html` and `island` borrow the props, so the `Html` lives no longer than they do. Where `island`
exists, `into_html` and `into_island` take the props by value instead, and the `Html` holds them:
it borrows only what the props borrow (nothing, for props of `'static` strings or `Cow`s holding
their own), so a function that builds the props can return the page, as a web handler does. Both
render exactly as their borrowing forms.

```rust,ignore
fn greet(name: String) -> ferrovue::Html<'static, greeting::Props<'static>> {
    greeting::into_html(greeting::Props::new(name, 0))
}
```

# Names

| In the `.vue` file | In Rust |
|---|---|
| `DataList.vue` | module `data_list`, `NAME` `"DataList"` |
| prop `showHead` | field `show_head`, with `#[serde(rename = "showHead")]` so the island's JSON uses Vue's name |
| prop `type` (a Rust keyword) | field `r#type` |
| `v-model` / `defineModel()` | field `model_value`, renamed `modelValue` |
| `<slot name="row">` | `Slots::row`, `RowSlotProps`, `RowSlot` |
| `<RouterView>` | `Slots::router_view` |

# `render_json`, for your own conformance tests

`mod.rs` has, under `#[cfg(test)]`, a `render_json(component, json)` that renders a component by
name from a fixture: a JSON object of props plus optional `$slots` (each slot's content as HTML),
`$route` (the location), `$stores` (Pinia state by store id) and `$locale`. Paired with
`ferrovue/testing` on the npm side, which renders the same fixtures with Vue, it lets a project hold
its own components to Vue's output byte for byte, as ferrovue's own suite does. That function is why
the props structs derive `serde::Deserialize` under `cfg(test)`, and why the project needs
`serde_json` as a dev-dependency.
