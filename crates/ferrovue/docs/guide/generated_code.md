What the compiler writes, and the API each component gets.

Generated code is ordinary Rust that calls this crate: there is no template engine and no
reflection at run time. Commit it, and let `pnpm ferrovue --check` in CI catch a stale copy.

# What is stable

Applications write Rust against generated modules, so their shape is API. What this page
documents is the contract: within a major version, a newer compiler keeps every item below, with
the name, the type shape and, for functions, the parameters in the order given here, and the Rust
an application writes against them keeps compiling. That is:

- the files of the output directory and the module names they give (`DataList.vue` is
  `data_list`, `pages/books/[id].vue` is `books_id`), and the version check at the top of `mod.rs`;
- in each component module: `NAME`; `Props`, its public fields and, with `builders` on (the
  default), its `new` and its setters; the structs of local types, with the same; `Slots`, each
  `…SlotProps` and each `…Slot`; `render`, with its parameters in the order
  [below](#render-and-its-parameters); `html`; and, for a component that renders from its props
  alone, `island`, `into_html` and `into_island`;
- `types.rs`'s structs and constants, `route_table.rs`'s `ROUTES`, `PATHS`, `BASE` and `router()`,
  `stores.rs`'s state structs and `Stores`, `i18n.rs`'s `LOCALE`, `FALLBACK`, `LOCALES` and
  `i18n(locale)`, `provides.rs`'s `Provides`, and `twins.rs`'s `…Props`, `…Slots` and `…Render`;
- the derives the tables below list, which an application relies on to copy, print and serialise
  what it builds;
- `render_json`, under `#[cfg(test)]`, and the fixture keys it reads.

Outside the contract, and free to change in any release: `render_scoped` and every other
`#[doc(hidden)]` item; the bodies of functions, and the order of what they reserve, write and
call; the names of `render`'s parameters (an unread one is named with a leading `_`); private
items, such as the fixture plumbing in `mod.rs`; comments; and the order of the `pub mod` lines.
What `render` writes is held to Vue's output, which the conformance suite checks.

The repository's `crates/ferrovue-contract` crate generates every item listed here from a few
components and uses each as an application would; CI builds and runs it against the compiler of
the same commit, so a change that breaks an item fails there first.

# The output directory

Everything in the configured `out` directory is replaced on each run.

| File | Written when | Holds |
|---|---|---|
| `mod.rs` | always | The [version check](#the-version-check), one `pub mod` per file below, and a `#[cfg(test)]` `render_json` for a project's conformance tests |
| `<component>.rs` | one per `.vue` file, pages included | The component's types and renderers: `DataList.vue` becomes `data_list.rs`, and the page `books/[id].vue` becomes `books_id.rs` |
| `types.rs` | the server render reaches a type or a constant exported from a `.ts` file | The shared types the render reaches (the types of props and of their fields, of provided and injected values, of store state and of twins' props), in the order their files declare them and written once so components passing them to one another agree on them, and each constant a template reads, as a `const`. See [shared types](crate::guide::props#shared-types) |
| `route_table.rs` | `routes` or `router` is configured | `ROUTES`, `PATHS`, `BASE` and `router()`. See [`routing`](crate::guide::routing) |
| `stores.rs` | `stores` is configured | A struct per store's state, named for its id (`cart` has `CartState`), the types it uses, and `Stores`, with a field per store. See [`pinia`](crate::guide::pinia) |
| `i18n.rs` | `i18n` is configured | `LOCALE`, `FALLBACK`, every locale's messages in `LOCALES`, and `i18n(locale)`. See [`i18n`](crate::guide::i18n) |
| `provides.rs` | a component calls `provide` or `inject` | `Provides`, what the components' ancestors provide, with a field per key. See [`provide_inject`](crate::guide::provide_inject) |
| `twins.rs` | `twins` is configured | Each twin's `…Props` and `…Slots`, and `…Render`, the signature its function must have. See [`errors_and_limits`](crate::guide::errors_and_limits#rust-twins) |

Include the directory as one module. `#[rustfmt::skip]` keeps rustfmt from rewriting it:

```rust
#[rustfmt::skip]
# /*
mod generated;
# */
# mod generated {}
```

The modules pass rustc's default warnings and `cargo clippy -- -D warnings`, so they can sit in a
crate that denies warnings. `mod.rs` allows one lint for all of them, at its top:

```rust
// The modules pass rustc's default warnings and clippy's default lints, with one exception:
// `dead_code`. Every component gets the whole of its API (`render`, `html`, `island`, their
// `into_` forms, `NAME`, a constructor and a setter per optional prop) and an app calls only what
// it needs.
#![allow(dead_code)]
```

The only other allow is `clippy::too_many_arguments`, on a function that takes more than seven
arguments: a props constructor with more than seven required props, which takes one argument per
required field, and a `render`, `render_scoped` or `html` that takes most of the parameters
[below](#render-and-its-parameters).

# The version check

Generated code calls the `ferrovue` crate, so the two must come from compatible releases. Below
the `allow`, `mod.rs` names the version of generated code its compiler writes:

```rust
ferrovue::__compat!(1);
```

The version is a number that changes only when generated code changes in a way the crate must
match: when the compiler starts calling something an older crate lacks, or the crate stops
supporting something older generated code calls. Each crate accepts the versions it supports and
stops the build at this line for any other, before the compiler reports anything else:

```text
error: this module was generated as version 2 of ferrovue's generated code, and this `ferrovue` crate supports version 1: use the `ferrovue` npm package and the `ferrovue` crate of one release, and run `ferrovue` to generate the module again
 --> src/generated/mod.rs:12:1
   |
12 | ferrovue::__compat!(2);
   | ^^^^^^^^^^^^^^^^^^^^^^
```

`__compat!` itself is `#[doc(hidden)]` and may change form in any release; the check at the top of
`mod.rs` stays.

# A component's module

Every component module has, in this order:

| Item | What it is |
|---|---|
| `NAME` | The component's name, `"DataList"`: what `data-island` carries, and what a [`Part`](crate::Part) of a [`Page`](crate::Page) records |
| One struct per local `interface` or object `type` | `Row` for `export interface Row { … }`, with the same derives and builder as `Props` |
| `Props<'a>` | The props, one public field per prop, deriving `Debug`, `Clone` and `serde::Serialize`, and `Default` when every prop is optional. With `builders` on, `Props::new` takes the required props in declaration order and each optional prop other than one named `new` has a setter of its name. See [`props`](crate::guide::props) |
| `…SlotProps<'v>` and `…Slot<'s>` | For each scoped slot: what its outlet passes (with `<'v>` only when it borrows), and the closure type a parent supplies. A component that takes `fv_provides` has a `…Slot<'s>` for each of its slots, scoped or not, whose closure is also given the `Provides` its content renders with. See [`slots`](crate::guide::slots) |
| `Slots<'s>` | When the component renders a `<slot>` or `<RouterView>`: what a parent puts in each, an `Option` per `<slot>` and the page as `router_view`. It derives `Clone` and `Copy`, and `Default` when it has no `router_view` |
| `render` | Write the component into a buffer |
| `render_scoped` | Only for a component a parent may hand `<style scoped>` ids to, or pass attributes it does not declare as props: `render` with those last. Generated parents call it; it is `#[doc(hidden)]` and outside the contract. See [`scoped_styles`](crate::guide::scoped_styles) and [fallthrough attributes](#fallthrough-attributes) |
| `html` | The same render as an [`Html`](crate::Html) value |
| `island` | Only for a component that renders from its props alone: the render wrapped as a hydratable island |
| `into_html` and `into_island` | Beside `island`: `html` and `island` taking the props by value, so the `Html` holds them |

`Props` has no lifetime when none of its fields borrow (a component whose props are all numbers
and booleans has a plain `Props`), and a component with no props has an empty `Props`.

# `render` and its parameters

`render` always takes the buffer first and the props second. After them come only the parameters
the component needs, always in this order:

```rust
# #[cfg(all(feature = "router", feature = "i18n"))]
# mod generated {
# pub mod stores { pub struct Stores<'a>(pub &'a str); }
# pub mod provides { pub struct Provides<'a>(pub &'a str); }
# pub mod page {
# use ferrovue as fv;
# pub struct Props<'a>(pub &'a str);
# pub struct Slots<'s>(pub fv::Slot<'s>);
pub fn render(
    out: &mut String,
    props: &Props<'_>,
    fv_slots: Slots<'_>,                          // renders <slot> or <RouterView>
    fv_route: &fv::Route<'_>,                     // <RouterLink>, useRoute() or $route
    fv_stores: &super::stores::Stores<'_>,        // reads a Pinia store
    fv_i18n: &fv::I18n,                           // $t or useI18n()
    fv_teleports: &fv::Teleports,                 // <Teleport>
    fv_provides: super::provides::Provides<'_>,   // provide() or inject()
    fv_head: &fv::Head,                           // useHead() or useSeoMeta()
)
# {}
# }
# }
```

A component needs a parameter when it uses the feature itself **or renders a child that does**: a
`Card` whose child `Badge` reads a store takes the stores too, and passes them on. Generated parents
call their children's `render` directly, so a page renders in one pass with no intermediate
strings. The `fv_` prefix keeps these names apart from anything a template names.

So, from the repository's own test components:

```rust
# #[cfg(feature = "router")]
# mod generated {
# pub mod stores { pub struct Stores<'a>(pub &'a str); }
# pub mod greeting {
# pub struct Props<'a>(pub &'a str);
// Greeting.vue: props alone.
pub fn render(out: &mut String, props: &Props<'_>)
# {}
# }
# pub mod layout {
# use ferrovue as fv;
# pub struct Props<'a>(pub &'a str);
# pub struct Slots<'s>(pub fv::Slot<'s>);
// Layout.vue: <RouterView> and two <RouterLink>s.
pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>, fv_route: &fv::Route<'_>)
# {}
# }
# pub mod card {
# pub struct Props<'a>(pub &'a str);
// Card.vue: renders Badge, which reads a store.
pub fn render(out: &mut String, props: &Props<'_>, fv_stores: &super::stores::Stores<'_>)
# {}
# }
# pub mod modal {
# use ferrovue as fv;
# pub struct Props<'a>(pub &'a str);
// Modal.vue: <Teleport>.
pub fn render(out: &mut String, props: &Props<'_>, fv_teleports: &fv::Teleports)
# {}
# }
# }
```

A component that a parent may hand scope ids to (see [`scoped_styles`](crate::guide::scoped_styles))
also has a `render_scoped`, which takes the parameters of `render` and then `fv_attrs: &str`, the
ids its root carries besides its own. Its `render` calls it with `""`:

```rust
# mod tag {
# pub struct Props<'a>(pub &'a str);
pub fn render(out: &mut String, props: &Props<'_>) {
    render_scoped(out, props, "");
}

/// [`render`], with the scope ids a parent hands the root: ` data-v-…` each.
#[doc(hidden)]
pub fn render_scoped(out: &mut String, props: &Props<'_>, fv_attrs: &str) {
    // …
}
# }
```

A component that a parent passes attributes it does not declare as props takes them, with the ids,
as one [`Attrs`](crate::Attrs) instead: see [fallthrough attributes](#fallthrough-attributes).

A `render` or `render_scoped` that never reads its props, such as a component's that only passes
its slot on, names the parameter `_props`, so that the module compiles without warnings; it is
still the second parameter.

`render` appends to `out` and never reads or rewrites what is already there, so a page can be
assembled in one `String`: write the document's head, render the body's components into the same
buffer, write the tail. It first reserves an estimate of what it will write, from its literal
markup, the strings its props hold and the numbers it writes, once per item for a loop, so that the
buffer grows once.

# Fallthrough attributes

What a parent passes a child beyond its props (`<Badge class="wide" :title="t" />` where `Badge`
declares neither) falls through, as in Vue: onto the child's single root, merged with the root's
own class and style and replacing its other attributes where they stand, or, with
`inheritAttrs: false`, onto whatever element binds `v-bind="$attrs"` (or a `useAttrs()` binding).
Two roots take none. A root that is another component passes them on to that one, merged with the
attributes it gives it. Listeners are dropped, as Vue's server drops them.

The parent knows at compile time which attributes it passes, but the child is generated once for
every parent, so the two meet at run time. A child that some parent passes attributes to takes
`fv_attrs: &fv::Attrs<'_>` in its `render_scoped`, the attributes in order followed by the scope
ids, and the parent builds them from its template:

```rust
# mod generated {
# pub mod badge {
#     use std::borrow::Cow;
#     use ferrovue as fv;
#     pub struct Props<'a> { pub label: Cow<'a, str> }
#     pub fn render_scoped(out: &mut String, props: &Props<'_>, fv_attrs: &fv::Attrs<'_>) {
#         super::badge_root::write(out, fv_attrs);
#         out.push('>');
#         fv::escape_into(out, &props.label);
#         out.push_str("</b>");
#     }
# }
# pub mod parent {
#     use std::borrow::Cow;
#     use ferrovue as fv;
#     pub struct Props<'a> { pub name: Cow<'a, str>, pub note: Option<Cow<'a, str>> }
#     pub fn render(out: &mut String, props: &Props<'_>) {
// <Badge :label="name" class="wide" :title="note" /> in a parent's template:
super::badge::render_scoped(out, &super::badge::Props { label: Cow::Borrowed(&props.name) },
    &fv::Attrs::new(&[("class", fv::Attr::str("wide")), ("title", props.note.as_deref().map_or(fv::Attr::Undefined, fv::Attr::str))], ""));
#     }
# }
# pub mod badge_root {
#     use ferrovue as fv;
#     pub fn write(out: &mut String, fv_attrs: &fv::Attrs<'_>) {

// Badge's root, `<b class="badge">`:
out.push_str("<b");
if fv_attrs.is_empty() {
    out.push_str(" class=\"badge\"");
    out.push_str(fv_attrs.ids());
} else {
    fv::attrs_into(out, &[&[("class", fv::Attr::str("badge"))], fv_attrs.list()], 1, fv_attrs.ids());
}
#     }
# }
# }
# use generated::{badge, parent};
# let mut out = String::new();
# parent::render(&mut out, &parent::Props { name: "Ada".into(), note: Some("hi".into()) });
# assert_eq!(out, r#"<b class="badge wide" title="hi">Ada</b>"#);
# out.clear();
# parent::render(&mut out, &parent::Props { name: "Ada".into(), note: None });
# assert_eq!(out, r#"<b class="badge wide">Ada</b>"#);
# out.clear();
# badge::render_scoped(&mut out, &badge::Props { label: "Ada".into() }, &ferrovue::Attrs::NONE);
# assert_eq!(out, r#"<b class="badge">Ada</b>"#);
```

With nothing passed (from `render`, which passes [`Attrs::NONE`](crate::Attrs::NONE), or from a
parent that passes none), the root is written exactly as it would be without; only when attributes
arrive does [`attrs_into`](crate::attrs_into) merge them as Vue's `mergeProps` does and write them as
`ssrRenderAttrs` does. A component no parent passes attributes to has neither: its `render_scoped`,
if it has one, takes the scope ids alone as a `&str`.

Attribute names are what the parent's template gives, and their values strings, numbers, booleans
or absent (`undefined`, which removes the root's own attribute of that name), a class or a style in
any form a template binds. An attribute that would reach a prop of the component a root passes it on
to, a value read from `$attrs` (it has no type), `$attrs` in a component whose `$attrs` would hold
scope ids, and attributes passed to a root `<Transition>` or `<KeepAlive>` around a `v-if` (which
Vue's server drops but its client keeps) are refused at compile time.

# `<component :is>`

`<component :is>` compiles when every value it can take is known when compiling. Each of these is
a closed set:

- an imported component, `:is="Card"`, or an async one from `defineAsyncComponent`;
- an HTML element's name, `is="h2"` or `:is="'h2'"`;
- a prop typed as a union of string literals, `as: "h1" | "h2"` (or an alias or `enum` of them),
  required or with a default;
- an object of imported components or element names, declared in `<script setup>`
  (`const ICONS = { star: Star, moon: Moon }`) or exported as a constant from a `.ts` file that
  imports them, read by such a prop or a literal key: `ICONS[name]`, `ICONS.star`;
- a `?:` or a `computed` that chooses among any of these.

The choices become a `match` on the prop, or an `if` on the condition, and each arm renders its
choice exactly as the static child or element would: the same props, fallthrough attributes, slots
and scope ids. Choices that render the same component share an arm. A choice of elements alone
writes the tag from the `match`:

```rust
# mod generated {
# pub mod star {
#     use std::borrow::Cow;
#     pub struct Props<'a> { pub label: Cow<'a, str> }
#     pub fn render(out: &mut String, props: &Props<'_>) {
#         out.push_str("<i class=\"star\">");
#         ferrovue::escape_into(out, &props.label);
#         out.push_str("</i>");
#     }
# }
# pub mod moon {
#     use std::borrow::Cow;
#     pub struct Props<'a> { pub label: Cow<'a, str> }
#     pub fn render(out: &mut String, props: &Props<'_>) {
#         out.push_str("<i class=\"moon\">");
#         ferrovue::escape_into(out, &props.label);
#         out.push_str("</i>");
#     }
# }
# pub mod icon {
#     use std::borrow::Cow;
#     pub struct Props<'a> { pub name: Cow<'a, str>, pub label: Cow<'a, str> }
#     pub fn render(out: &mut String, props: &Props<'_>) {
// <component :is="ICONS[name]" :label="label" />, where ICONS = { star: Star, moon: Moon }:
match &*props.name {
    "star" => {
        super::star::render(out, &super::star::Props { label: Cow::Borrowed(&props.label) });
    }
    _ => {
        super::moon::render(out, &super::moon::Props { label: Cow::Borrowed(&props.label) });
    }
}
#     }
# }
# pub mod heading {
#     use std::borrow::Cow;
#     use ferrovue as fv;
#     pub struct Props<'a> { pub r#as: Cow<'a, str> }
#     pub struct Slots<'s> { pub default: Option<fv::Slot<'s>> }
#     pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>) {

// <component :is="as" class="heading"><slot /></component>, where as: "h1" | "h2":
let fv_tag1 = match &*props.r#as { "h1" => "h1", _ => "h2" };
out.push('<');
out.push_str(fv_tag1);
out.push_str(" class=\"heading\">");
fv::slot_into(out, fv_slots.default, None);
out.push_str("</");
out.push_str(fv_tag1);
out.push('>');
#     }
# }
# }
# use generated::{heading, icon};
# let mut out = String::new();
# icon::render(&mut out, &icon::Props { name: "star".into(), label: "Night".into() });
# icon::render(&mut out, &icon::Props { name: "sun".into(), label: "Day".into() });
# assert_eq!(out, r#"<i class="star">Night</i><i class="moon">Day</i>"#);
# out.clear();
# heading::render(&mut out, &heading::Props { r#as: "h1".into() }, heading::Slots { default: Some(ferrovue::Slot::new(&|out: &mut String| out.push_str("Hi"))) });
# assert_eq!(out, r#"<h1 class="heading"><!--[-->Hi<!--]--></h1>"#);
```

The last choice is the `match`'s `_` arm: a prop's Rust type is a `&str`, so a value outside the
union TypeScript declares renders as the last choice. Inside `<KeepAlive>` and `<Transition>` the
choice renders as it does elsewhere, as on Vue's server.

Vue's server renders an element `<component :is>` chooses from virtual nodes, by rules that differ
from a template's in a few places, and ferrovue follows them: a `v-if` that renders nothing writes
`<!--v-if-->`, an attribute with an empty value is written bare (`alt`), a static `class` written
just before `:class` gives its names first (`class="a x"`), and slot content a parent
gives a `<slot>` inside the element is rendered the same way, through every component that passes
it on. Where virtual nodes would differ in ways the compiler cannot reproduce, it refuses: a
`<slot>` with fallback content inside such an element (Vue decides whether to show the fallback by
rules of its own), one `<slot>` rendered both inside and outside one, `v-show` and `v-model` on a
`<select>` inside one, a static `class` with other attributes between it and a later `:class`
(Vue writes it where the static one stands), and `v-html` or `v-text` on `<component :is>`
itself, which Vue's server leaves empty.

# `html` and `island`

`html` takes the same parameters as `render`, minus the buffer, and returns an
[`Html`](crate::Html): the render applied to its arguments, run when it is written. Write it with
[`Html::render_to`](crate::Html::render_to) or [`Html::into_string`](crate::Html::into_string), or,
with the `maud` feature, splice it into a `maud::html!` template, where it is written straight into
maud's buffer:

```rust
# mod greeting {
#     use std::borrow::Cow;
#     #[derive(serde::Serialize)]
#     pub struct Props<'a> { pub name: Cow<'a, str> }
#     pub fn render(out: &mut String, props: &Props<'_>) {
#         out.push_str("<p>Hello, ");
#         ferrovue::escape_into(out, &props.name);
#         out.push_str("!</p>");
#     }
#     pub fn html<'p, 'a>(props: &'p Props<'a>) -> ferrovue::Html<'p, Props<'a>> {
#         ferrovue::Html::markup(props, render)
#     }
# }
# #[cfg(feature = "maud")]
# fn main() {
# let props = greeting::Props { name: "<Ada>".into() };
// With ferrovue's `maud` feature.
let page = maud::html! {
    (maud::DOCTYPE)
    body { (greeting::html(&props)) }
};
# assert_eq!(page.into_string(), "<!DOCTYPE html><body><p>Hello, &lt;Ada&gt;!</p></body>");
# }
# #[cfg(not(feature = "maud"))]
# fn main() {}
```

With the `axum` or `actix-web` feature, an `Html` is also a response of its own;
[`web_frameworks`](crate::guide::web_frameworks) shows how.

`island` exists only for a component whose render needs nothing but its props, because the client
rebuilds the component from the props in `data-props` and nothing else. It wraps the markup as

```html
<div data-island="Greeting" data-props="{&quot;name&quot;:&quot;Ada&quot;,&quot;unread&quot;:3}">…</div>
```

with the props serialised by `serde_json` (a non-finite `f64` as JavaScript writes it, `NaN` or
`Infinity`, where `serde_json` would write `null`) and attribute-escaped. A component that takes slots, the
route, stores, translations, teleports or the page head has no `island`; the page's own Vue app hydrates it
instead. See [`islands_and_hydration`](crate::guide::islands_and_hydration).

`html` and `island` borrow the props, so the `Html` lives no longer than they do. Where `island`
exists, `into_html` and `into_island` take the props by value instead, and the `Html` holds them:
it borrows only what the props borrow (nothing, for props of `'static` strings or `Cow`s holding
their own), so a function that builds the props can return the page, as a web handler does. Both
render exactly as their borrowing forms.

```rust
# mod greeting {
#     use std::borrow::Cow;
#     #[derive(serde::Serialize)]
#     pub struct Props<'a> { pub name: Cow<'a, str>, pub unread: i64 }
#     impl<'a> Props<'a> {
#         pub fn new(name: impl Into<Cow<'a, str>>, unread: i64) -> Self {
#             Props { name: name.into(), unread }
#         }
#     }
#     pub fn render(out: &mut String, props: &Props<'_>) {
#         out.push_str("<p>Hello, ");
#         ferrovue::escape_into(out, &props.name);
#         out.push_str("!</p>");
#     }
#     pub fn into_html<'a>(props: Props<'a>) -> ferrovue::Html<'a, Props<'a>> {
#         ferrovue::Html::markup_owned(props, render)
#     }
# }
fn greet(name: String) -> ferrovue::Html<'static, greeting::Props<'static>> {
    greeting::into_html(greeting::Props::new(name, 0))
}
# assert_eq!(greet("Ada".to_owned()).into_string(), "<p>Hello, Ada!</p>");
```

# Names

| In the `.vue` file | In Rust |
|---|---|
| `DataList.vue` | module `data_list`, `NAME` `"DataList"` |
| the page `books/[id].vue` | module `books_id`, `NAME` `"BooksId"`: the PascalCase of its path in the pages folder |
| a module name that is a Rust keyword, `type` | module `r#type`, in `type.rs`; `self`, `super` and `crate` take a `_`: `self_` |
| prop `showHead` | field `show_head`, with `#[serde(rename = "showHead")]` so the island's JSON uses Vue's name |
| prop `type` (a Rust keyword) | field `r#type` |
| `v-model` / `defineModel()` | field `model_value`, renamed `modelValue` |
| `<slot name="row">` | `Slots::row`, `RowSlotProps`, `RowSlot` |
| `<RouterView>` | `Slots::router_view` |
| a store with id `cart` | `stores::CartState`, `Stores::cart` |
| the twin `StarRating` | `twins::StarRatingProps`, `StarRatingSlots`, `StarRatingRender` |
| `provide(ThemeKey, …)`, `provide("tone", …)` | `Provides::theme_key`, `Provides::tone` |

# `render_json`, for your own conformance tests

`mod.rs` has, under `#[cfg(test)]`, a `render_json(component, json)` that renders a component by
name from a fixture: a JSON object of props plus optional `$slots` (each slot's content as HTML),
`$route` (the location), `$stores` (Pinia state by store id) and `$locale`. Paired with
`ferrovue/testing` on the npm side, which renders the same fixtures with Vue, it lets a project hold
its own components to Vue's output byte for byte, as ferrovue's own suite does: the
[`testing`](crate::guide::testing) page sets up both halves in two calls. That function is why
the props structs derive `serde::Deserialize` under `cfg(test)`, and why the project needs
`serde_json` as a dev-dependency.
