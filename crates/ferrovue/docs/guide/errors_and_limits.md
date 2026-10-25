What the compiler refuses, and what can still go wrong at run time.

# Refused at compile time

The compiler translates a closed set of constructs, each proven against Vue by the conformance
suite. Anything else is an error, never an approximation, because an approximation would be a
hydration mismatch in the browser. Errors carry a stable code and point into the `.vue` file, with
the line quoted and a caret under the construct. Where the way around a refusal is short, a
`= help:` line gives it. For example:

```text
error[FV0609]: components/Card.vue:7:14: `<` is supported between two numbers, two strings or two dates that are present: the other is a string
 7 |     <p v-if="label < limit">{{ label }}</p>
   |              ^
 = docs: https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0609

error[FV0601]: components/Price.vue:9:9: `formatPrice()` calls a function imported from `./format`, a module the server does not run
 9 |   <p>{{ formatPrice(cents) }}</p>
   |         ^
 = help: put `formatPrice` in the module `helpers.module` names with a Rust twin under `helpers.functions` in ferrovue.config.json, or compute the value in Rust and pass it as a prop
 = docs: https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0601

2 errors in 2 components
```

A run reports every refusal it finds, then a line that counts them, and writes nothing while any
remains. Each component is checked on its own, and within a template each statement of the
compiled render and each interpolation in it, so independent refusals in one component are all
reported. A component that uses a refused one (as a child, or by importing its `Props`) is checked
once that one compiles; the count line says how many were left unchecked. A refusal in the
configuration, a routes file or a locale file stops the run where it is found.

[`error_codes`](crate::guide::error_codes) lists every code. `ferrovue --format json` writes the
same errors for an editor or a CI annotation, and a VS Code problem matcher puts them in the
Problems panel: see [`quick_start`](crate::guide::quick_start#editor-and-ci-diagnostics). The
`ferrovue/volar` plugin for Vue's language tools underlines them in the editor as you type: see
[`quick_start`](crate::guide::quick_start#diagnostics-in-your-editor).

What is refused today, each with an error that names it:

- `<style module>` without `cssModules` in the configuration, a module in another file, one a
  preprocessor compiles or one that imports from another file, and `v-bind()` in `<style>` of a value
  that is not a string or a number (see [`scoped_styles`](crate::guide::scoped_styles));
- `<RouterView>` in a component with `<style scoped>`, which would give the page that component's
  id; and, since vue-router renders a link from virtual nodes, a `<slot>` inside a `<RouterLink>`
  that takes scope ids, or an element inside one in slot content given a `:slotted()` id;
- `v-show`, and `v-model` on a `<select>`, in the content of a `<RouterLink>` or of a Rust twin's
  slot, which Vue renders from virtual nodes;
- `<component :is>` over an open set (a `string`, a `Component`, a key that is not a union of
  string literals), over a prop that may be absent, or naming a key its object lacks or a tag that
  is not an HTML element; `v-html` or `v-text` on it; and, inside an element it chooses, a `<slot>`
  with fallback content, `v-show`, and `v-model` on a `<select>`. See
  [`generated_code`](crate::guide::generated_code#component-is);
- the Options API (a `<script>` without `setup`), and a type parameter of a generic component with
  no constraint (`generic="T"`): a generic component renders each type parameter as its
  constraint;
- constants that are not literals (`Date.now()`, a function), an object constant read whole or by
  a key typed `string` or `number` (`LABELS[key]`, where a key such as `toString` names a field
  every object has), and `new` of anything but `Date` (`new Map()`);
- the current time (`new Date()`, `Date.now()`), `new Date(year, month, …)`, a date string outside
  ECMAScript's date time string format or with a time and no `Z` or offset, the local getters
  (`.getFullYear()`, `.getHours()`), `.toString()` and the other `Date` methods; and,
  permanently, locale formatting: `Intl`, `.toLocaleString()`, `.toLocaleDateString()`,
  `.toLocaleTimeString()`, `.localeCompare()` and vue-i18n's `$d` and `$n`. See
  [`dates_and_prices`](crate::guide::dates_and_prices);
- `<RouterLink custom>`, slot props that are array literals, defaults in destructured slot props,
  and outlets of one slot that pass different props;
- custom directives not listed in `clientDirectives`;
- `watchEffect`, `watch` with `immediate`, `onServerPrefetch`, a top-level `await` of anything but
  a loader (see [`loaders`](crate::guide::loaders#what-is-refused)), and statements in setup that
  change state;
- `route.meta` and `route.matched`;
- in a folder of pages: a parameter beside text in one part of a path (`prefix-[id].vue`),
  repeatable and optional catch-all parameters, parameter parsers (`[id=int]`), named views
  (`index@aside.vue`), `definePage()`, a `<route>` block, and two pages, or a page and a component,
  with one component name. See [`routing`](crate::guide::routing#file-based-routes);
- Pinia getters that read `this` or return a function;
- ordering comparisons between a string and a number, which JavaScript makes numeric;
- regular expressions (`.replace(/x/g, …)`, `.split(/,/)`), replacement functions, a search's
  starting position or a split's limit (`.includes(x, 3)`, `.split(",", 2)`),
  `.toLocaleUpperCase()` and `.toLocaleLowerCase()` (the server's locale is not the browser's),
  `parseInt` with a radix other than 10 or 16, or of a number, and `.repeat()` by a negative
  literal. See [`strings`](crate::guide::strings);
- two strings that may each hold half of a surrogate pair compared, searched or joined. See
  [`strings`](crate::guide::strings#halves-of-surrogate-pairs);
- array methods given anything but `Boolean` or an arrow function (`.map(String)`), `.map()` to
  optional values, methods other than `.filter(Boolean)` over a list of optional values, and a
  computed list as a slot prop;
- in a `computed`'s body or a callback's: loops, assignments, `try`, `throw`, `var`, and a path
  that ends without `return`. See [`script_logic`](crate::guide::script_logic#what-is-refused);
- an object literal no type reaches (one typed by an annotation, a return type, a parameter, a
  child's prop or the list a `.map()` makes is built as its interface's struct), one that does not
  match its interface, and a list method, an item or `?.` of a value built from literals in place.
  See [`script_logic`](crate::guide::script_logic#object-literals);
- a dictionary's field read by name (`r.key`, `r[key]`), which may be absent although TypeScript
  says it is not; the `[key, value]` pairs of `Object.entries()` joined, compared, sorted without a
  comparator or kept as a list of pairs by `.map()`; dictionaries of optional
  values. See [`props`](crate::guide::props#dictionaries);
- a type that is both `null` and `undefined` (`T | null | undefined`, `x?: T | null`), a default
  for a nullable prop, and `=== null` or `=== undefined` of a value that may be either. See
  [`props`](crate::guide::props#nullable-props);
- an attribute (`class` and `style` aside) bound to a value that may be neither a string, a number
  nor a boolean: a list, an object, or a `route.query` value, which is an array when its key is
  repeated. Vue's server renderer leaves such an attribute out, and hydration then sets it to the
  value's `String()` without reporting a mismatch. Join a list (`.join(",")`), or narrow a query
  value to one string (`typeof route.query.q === "string" ? route.query.q : ""`);
- `v-html` of anything but a `TrustedHtml` or `InlineHtml` prop; `v-html` on an element whose
  content the browser's parser rebuilds (a table's structure, a `<select>`, SVG and MathML outside
  the elements that hold HTML), and `v-html` in a `<p>` of HTML that is not `InlineHtml`. See
  [`escaping`](crate::guide::escaping#where-v-html-may-go);
- `provide` and `inject` beyond what the server can resolve exactly: keys that are not string
  literals or exported `InjectionKey` symbols, `inject(key)!`, provided values that may be absent,
  a ref and a plain value under one key, setup that assigns to an injected value, and `provide(…)`
  not imported from `vue`. See [`provide_inject`](crate::guide::provide_inject#what-is-refused);
- in the page head: options given to `useHead`, `useHeadSafe`, `templateParams`, a `titleTemplate`
  function, event handlers, a `class` or `style` that may be `null` (on which unhead's renderer
  throws), and an object or array given to a `useSeoMeta` key. See
  [`head`](crate::guide::head#what-a-component-may-pass);
- a value read from `$attrs` or `useAttrs()` (`$attrs.title`), which has no type; an attribute a
  component is passed that would reach a prop of the component (or `<RouterLink>`) its root passes
  it on to; `$attrs` in a component that is the root of one that may be handed scope ids, where it
  would hold them; an attribute named by a number, or bound to a `$route.query` value; a class
  merged by `v-bind` with a string that may equal the class before it, which Vue would write once;
  and attributes passed to a component whose root is a `<Transition>` or `<KeepAlive>` around a
  `v-if`, which Vue's server drops but its client keeps. See
  [`generated_code`](crate::guide::generated_code#fallthrough-attributes);
- any method call without a Rust twin.

Client-only code is allowed where the server never runs it: lifecycle hooks, `watch` (without
`immediate`), `defineEmits`, `defineExpose`, template refs, functions the server cannot evaluate
(see [`script_logic`](crate::guide::script_logic#functions)) and what is injected under a
key holding a function may be named from event handlers, which the server drops. The repository
README's "What a component may use" table lists everything that is supported.

A `<script>` element in a template is kept by Vue's server renderer, so a component that writes the
whole document (`<html>`, `<head>`, `<body>` and a `<script type="module">` that loads the client)
compiles, and the server writes the element as it is. Vue's client compiler drops a `<script>` from
a template, so such a component must never hydrate: render it on the server only, as the page's
shell, and put the islands or the app inside it.

# Helpers

A template may call functions of your own. One declared in `<script setup>`, or exported from a
`.ts` file the component imports, is translated by the compiler when its body is in the subset
[`script_logic`](crate::guide::script_logic#functions) describes. Any other function needs a Rust
twin, named in `ferrovue.config.json`:

```json
{
  "helpers": {
    "module": "./helpers",
    "functions": {
      "plural": { "rust": "crate::helpers::plural", "params": ["int"], "returns": "string", "maxLen": 1 },
      "orDash": { "rust": "crate::helpers::or_dash", "params": ["string?"], "returns": "string", "maxLen": 1 }
    }
  }
}
```

`module` is what components import the TypeScript functions from; `maxLen` is the longest string the
function returns, which the generated code adds to its buffer reservation. Each parameter and return
type maps to Rust as follows:

| Type | Rust |
|---|---|
| `"string"`, `"string?"` | `&str`, `Option<&str>` |
| `"int"`, `"int?"` | `i64`, `Option<i64>` |
| `"float"`, `"float?"` | `f64`, `Option<f64>` |
| `"bool"` | `bool` |

A string a helper returns is a `&str`: `'static`, or borrowed from an argument.

```rust
// src/helpers.rs: the twins of client/components/helpers.ts.
pub fn plural(n: i64) -> &'static str {
    if n == 1 { "" } else { "s" }
}

pub fn or_dash(s: Option<&str>) -> &str {
    match s {
        Some(s) if !s.is_empty() => s,
        _ => "—",
    }
}
# assert_eq!(plural(2), "s");
# assert_eq!(or_dash(None), "—");
```

The twin must return what the TypeScript function returns for every input, or the page will not
hydrate; ferrovue cannot check that for you. Test the pair against shared vectors, as ferrovue's
own runtime is tested.

# Client-only content

Some components will never compile: a component library's render functions, code that measures the
page in `onMounted`. `<ClientOnly>` and [Rust twins](#rust-twins) keep one of them from blocking
the page around it.

A component the compiler refuses can still be on the page if the server does not render it. Put it
in `<ClientOnly>`, from `ferrovue/client`: the server writes the `#fallback` slot between fragment
markers (or `<!---->` without one), the browser hydrates that fallback and swaps in the default
slot once mounted. Both sides render the fallback first, so this is exact by construction. The
compiler does not read the default slot at all, so any component, import or expression may go
there:

```vue
<script setup lang="ts">
import { ClientOnly } from "ferrovue/client";
import { VDataTable } from "vuetify/components";

defineProps<{ rows: { name: string }[] }>();
</script>

<template>
  <ClientOnly>
    <VDataTable :items="rows" />
    <template #fallback><p class="loading">Loading the table…</p></template>
  </ClientOnly>
</template>
```

The swap happens only where Vue runs: inside an island, or an app hydrated whole. Elsewhere the
fallback stays. `<ClientOnly>` takes no attributes.

# Rust twins

A component the server must render but ferrovue cannot compile, such as a component library's
button, can be rendered by a function of yours. Name it in `ferrovue.config.json` with the props a
template may pass it (typed as helpers' are) and the slots it may fill:

```json
{
  "twins": {
    "VBtn": { "rust": "crate::ui::v_btn", "props": { "label": "string", "block": "bool" }, "slots": ["default"] }
  }
}
```

`twins.rs` then holds `VBtnProps`, `VBtnSlots` and `VBtnRender`, the signature the generated
parents call the function with: the buffer, the props, the slots, and the attributes the parent
passes beyond the props together with the scope ids the root takes. A template uses `<VBtn>` (or
`<v-btn>`), imported from anywhere or registered globally. An absent `bool` is `false` and a bare
attribute (`<VBtn block>`) is `true`, as Vue casts them.

```rust
# mod generated { pub mod twins {
# use ferrovue as fv;
# #[derive(Debug, Clone, Copy)]
# pub struct VBtnProps<'a> {
#     pub label: &'a str,
#     pub block: bool,
# }
# #[derive(Clone, Copy, Default)]
# pub struct VBtnSlots<'s> {
#     pub default: Option<fv::Slot<'s>>,
# }
# pub type VBtnRender = fn(&mut String, &VBtnProps<'_>, VBtnSlots<'_>, &fv::Attrs<'_>);
# const _: VBtnRender = crate::v_btn;
# } }
use ferrovue::{Attr, Attrs};
use generated::twins::{VBtnProps, VBtnSlots};

// What `h("button", { class: ["v-btn", { block }] }, [label, slots.default?.()])` renders.
pub fn v_btn(out: &mut String, props: &VBtnProps<'_>, slots: VBtnSlots<'_>, attrs: &Attrs<'_>) {
    let class = if props.block { "v-btn block" } else { "v-btn" };
    out.push_str("<button");
    ferrovue::attrs_into(out, &[&[("class", Attr::str(class))], attrs.list()], 1, attrs.ids());
    out.push('>');
    ferrovue::escape_into(out, props.label);
    match slots.default {
        Some(slot) => {
            out.push_str("<!--[-->");
            slot.render_to(out);
            out.push_str("<!--]-->");
        }
        None => out.push_str("<!---->"),
    }
    out.push_str("</button>");
}
# fn main() {
# let mut out = String::new();
# v_btn(&mut out, &VBtnProps { label: "Save", block: true }, VBtnSlots::default(), &Attrs::NONE);
# assert_eq!(out, r#"<button class="v-btn block">Save<!----></button>"#);
# }
```

**ferrovue does not check that a twin writes what Vue writes.** A twin's exactness rests on your
code, as a helper's does. Hold each twin to Vue with fixtures of the components that use it,
rendered by Vue and by the generated Rust and compared: the [`testing`](crate::guide::testing) page
sets that up with `conformanceSuite` from `ferrovue/testing` and
[`conformance!`](crate::conformance!). Slot content is written as a render function sees it, from
virtual nodes: an absent `v-if` is `<!--v-if-->`. Fragment markers around a slot, and what an empty one shows, are
the twin's to write, as they are the component's. The repository's `examples/fullstack` has a twin
(`src/ui.rs`) and its fixtures (`fixtures/`).

# Refused at render time

Some props can only be found wrong as the component renders, because they come from a request: a
date string outside ECMAScript's date time string format, which browsers read each in their own
way, or an integer the template multiplies beyond ±2⁶³ and hands to a child's `number` prop.
Writing anything for them would break the promise that the page is Vue's, so the render is
refused, with a code from the same list as the compiler's refusals:

| Code | What the props asked for |
|---|---|
| [FV1803](crate::guide::error_codes#fv1803) | `new Date(s)` or `Date.parse(s)` of a string outside the format every browser reads alike |
| [FV1808](crate::guide::error_codes#fv1808) | `Date.UTC()` of parts engines compute differently |
| [FV1811](crate::guide::error_codes#fv1811) | `.toISOString()` of an invalid date, where JavaScript throws |
| [FV1812](crate::guide::error_codes#fv1812) | a date a child's `Date` prop cannot hold, with a `dateType` such as chrono's |
| [FV0714](crate::guide::error_codes#fv0714) | `.repeat()` by a negative or infinite count, where JavaScript throws |
| [FV0725](crate::guide::error_codes#fv0725) | `.repeat()`, `.padStart()` or `.padEnd()` beyond the longest string V8 makes |
| [FV0724](crate::guide::error_codes#fv0724) | an integer beyond the range of `i64` where the template needs one: a child's `number` prop, an index, the count of a `v-for` |
| [FV0518](crate::guide::error_codes#fv0518) | a string outside a union of string literals, held as a string, where a child's union prop or an object's union field needs the union's enum |

Every component has a `try_render` beside its `render`, with the same parameters, which returns
`Result<(), Refused>`. A [`Refused`](crate::Refused) carries the code, the component, the line and
column of the expression in its file, and a message saying what to do; its `Display` is the
compiler's own form, `error[FV1803]: components/Published.vue:3:9: the date …`. A refusal in a
child, in slot content or in a loader's component is returned by the page's `try_render` as it is,
and the first one the render met is the one returned. `render` calls `try_render` and panics with
the message, so code that calls it behaves as it did. A handler that renders props from a request
calls `try_render` and answers a refusal with `400 Bad Request`:

```rust
# mod published {
# use std::borrow::Cow;
# use ferrovue as fv;
# pub const NAME: &str = "Published";
# pub struct Props<'a> { pub on: Cow<'a, str> }
# impl<'a> Props<'a> {
#     pub fn new(on: impl Into<Cow<'a, str>>) -> Self {
#         Props { on: on.into() }
#     }
# }
# pub fn render(out: &mut String, props: &Props<'_>) {
#     fv::rendered(try_render(out, props));
# }
# pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
#     let fv_refusals = fv::Refusals::new(NAME, "components/Published.vue");
#     out.push_str("<time>");
#     fv::escape_into(out, &fv_refusals.keep(fv::try_to_iso_string(fv_refusals.keep(fv::try_date_parse(&props.on), 3, 9)), 3, 9));
#     out.push_str("</time>");
#     fv_refusals.check(Ok(()))
# }
# }
# #[cfg(feature = "axum")]
# fn main() {
use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};

// Published.vue: <time>{{ new Date(on).toISOString() }}</time>
async fn published(Path(on): Path<String>) -> Response {
    let mut html = String::new();
    match published::try_render(&mut html, &published::Props::new(on)) {
        Ok(()) => Html(html).into_response(),
        Err(refused) => (StatusCode::BAD_REQUEST, refused.message().to_owned()).into_response(),
    }
}
# let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
# let ok = runtime.block_on(published(Path("2024-05-01".to_owned())));
# assert_eq!(ok.status(), StatusCode::OK);
# let refused = runtime.block_on(published(Path("May 1".to_owned())));
# assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
# }
# #[cfg(not(feature = "axum"))]
# fn main() {}
```

The full-stack example's `/delivery` route does this with a date and a number from the query
string. The other ways a component is rendered have a twin that returns the refusal too:
[`Html::try_render_to`](crate::Html::try_render_to) and
[`Html::try_into_string`](crate::Html::try_into_string) for a generated `html()` or `island()`,
[`Page::try_render_to`](crate::Page::try_render_to) for a page, its parts included, and
[`PageHole::try_fill`](crate::PageHole::try_fill) for a streamed hole; each leaves the buffer as it
was. With loaders, the closure [`load`](crate::load) renders with returns the `Result` of
`try_render`, which `load` hands back once the render is done. Slot content written by a Rust
closure is plain Rust: render a component there with `try_render` into a `String` beforehand, and
push the string from the closure.

The message is written for the developer and names the value that was refused. Answer the client
with it, as above, or with a message of the application's own, and log the
[`Refused`](crate::Refused) itself.

# At run time

Beside the refusals above, generated code returns no errors, and the few panics are programming
errors, found the first time the code runs:

- [`Router::tree`](crate::Router::tree), [`Router::named`](crate::Router::named) and
  [`Router::new`](crate::Router::new) panic on a route path outside the supported syntax, or two
  routes with the same name. The generated `router()` uses routes the compiler has checked.
- [`Route::link_named`](crate::Route::link_named) panics on a route name no route has (the compiler
  checks the names a template uses), and in a debug build on a required parameter that is missing
  or empty, which makes vue-router throw. A release build writes the link without it.
- [`I18n::t`](crate::I18n::t) panics in a debug build when a fractional plural number chooses none
  of a message's cases (`1.5` with three cases), where vue-i18n throws. A release build writes
  nothing for the message.
- `render`, and the [`Html`](crate::Html) and [`Page`](crate::Page) methods without `try_`, panic
  with the message of a refusal at render time.

A `computed` whose expression may be refused, calls `t()` or a helper, or reads such a `computed`,
is worked out where the render first reads it, once, as Vue works it out: one the template reads
only under a `v-if` that is false, or in slot content a child does not render, is neither refused
nor panics. One that
a `v-bind()` in `<style>` reads is worked out as the render starts, where Vue's server works out
the component's style variables.

Serialising an island's props or the stores' state cannot fail for the types the compiler
generates. If a hand-written [`TrustedHtml`](crate::TrustedHtml) type's `Serialize` fails, or
hand-written props hold a map serde_json refuses (one keyed by a list), a debug build panics where
they are rendered. A release build gives the island empty props, which the client reports and
leaves the server's markup as it is, and records `null` for them in a [`Page`](crate::Page)'s
record, which the client still reads.

# Limits worth knowing

- **Integers** are exact within ±2⁵³, as in JavaScript. See [`numbers`](crate::guide::numbers).
- **Strings** count UTF-16 code units, as in JavaScript, and half of a surrogate pair is written as
  U+FFFD, as a server sends it. See [`strings`](crate::guide::strings).
- **Scope ids** are computed as `@vitejs/plugin-vue` computes them only when `scopeId` and
  `viteRoot` match its configuration; a wrong id hydrates cleanly and leaves the styles unapplied.
  The same holds for the names of `v-bind()` variables in `<style>`, which follow `isProduction`
  too, and for CSS module classes, which follow `cssModules`. The Vite plugin compares them. See
  [`scoped_styles`](crate::guide::scoped_styles).
- **Lists of string-literal unions** (`Size[]`) are lists of strings in Rust: a value outside the
  union renders as given. A union itself is an enum. See
  [`props`](crate::guide::props#unions-of-string-literals).
- **Optional values must be narrowed** before use, as TypeScript requires: `v-if="user"`,
  `user !== undefined`, `??`.
- **One render per buffer at a time**: a render borrows its `String` mutably; render pages in
  parallel by giving each its own buffer. [`Teleports`](crate::Teleports) and
  [`Head`](crate::Head) are per page and not `Sync`.
- **Same versions**: generated code and this crate are released together. After upgrading either,
  regenerate with the matching compiler.
