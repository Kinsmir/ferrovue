What the compiler refuses, and what can still go wrong at run time.

# Refused at compile time

The compiler translates a closed set of constructs, each proven against Vue by the conformance
suite. Anything else is an error, never an approximation, because an approximation would be a
hydration mismatch in the browser. Errors carry a stable code and point into the `.vue` file, with
the line quoted and a caret under the construct. For example:

```text
error[FV0609]: components/Card.vue:7:14: `<` is supported between two numbers, or two strings, that are present: the other is a string
 7 |     <p v-if="label < limit">{{ label }}</p>
   |              ^
 = docs: https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0609
```

[`error_codes`](crate::guide::error_codes) lists every code. `ferrovue --format json` writes the
same errors for an editor or a CI annotation, and a VS Code problem matcher puts them in the
Problems panel: see [`quick_start`](crate::guide::quick_start#editor-and-ci-diagnostics).

What is refused today, each with an error that names it:

- `<style module>`, and `v-bind()` in CSS (`<style scoped>` and a global `<style>` block are fine:
  see [`scoped_styles`](crate::guide::scoped_styles));
- `<RouterView>` in a component with `<style scoped>`, which would give the page that component's
  id; and, since vue-router renders a link from virtual nodes, a `<slot>` inside a `<RouterLink>`
  that takes scope ids, or an element inside one in slot content given a `:slotted()` id;
- `<component :is>`;
- the Options API (a `<script>` without `setup`), and a type parameter of a generic component with
  no constraint (`generic="T"`): a generic component renders each type parameter as its
  constraint;
- constants that are not literals (`Date.now()`, a function), an object constant read whole or by
  a key chosen at run time (`LABELS[key]`), and `new` (`new Date(at)`,
  `new Intl.NumberFormat()`);
- `<RouterLink custom>`, slot props that are array literals, defaults in destructured slot props,
  and outlets of one slot that pass different props;
- custom directives not listed in `clientDirectives`;
- `watchEffect`, `watch` with `immediate`, `onServerPrefetch`, top-level `await`, and statements in
  setup that change state;
- `route.meta` and `route.matched`;
- Pinia getters that read `this` or return a function;
- ordering comparisons between a string and a number, which JavaScript makes numeric;
- regular expressions (`.replace(/x/g, …)`, `.split(/,/)`), replacement functions, a search's
  starting position or a split's limit (`.includes(x, 3)`, `.split(",", 2)`),
  `.toLocaleUpperCase()` and `.toLocaleLowerCase()` (the server's locale is not the browser's),
  `parseInt` with a radix other than 10 or 16, or of a number, and `.repeat()` by a negative
  literal. See [`strings`](crate::guide::strings);
- two strings that may each hold half of a surrogate pair compared, searched or joined. See
  [`strings`](crate::guide::strings#halves-of-surrogate-pairs);
- array methods given anything but an arrow function whose body is an expression
  (`.filter(Boolean)`, `x => { return … }`), `.map()` to optional values, and a computed list as a
  slot prop;
- a dictionary's field read by name (`r.key`, `r[key]`), which may be absent although TypeScript
  says it is not; `Object.entries()` anywhere but as a `v-for`'s source; dictionaries of optional
  values. See [`props`](crate::guide::props#dictionaries);
- a type that is both `null` and `undefined` (`T | null | undefined`, `x?: T | null`), a default
  for a nullable prop, and `=== null` or `=== undefined` of a value that may be either. See
  [`props`](crate::guide::props#nullable-props);
- an attribute (`class` and `style` aside) bound to a value that may be neither a string, a number
  nor a boolean: a list, an object, or a `route.query` value, which is an array when its key is
  repeated. Vue's server renderer leaves such an attribute out, and hydration then sets it to the
  value's `String()` without reporting a mismatch. Join a list (`.join(",")`), or narrow a query
  value to one string (`typeof route.query.q === "string" ? route.query.q : ""`);
- `v-html` of anything but a `TrustedHtml` prop;
- `provide` and `inject` beyond what the server can resolve exactly: keys that are not string
  literals or exported `InjectionKey` symbols, `inject(key)!`, provided values that may be absent.
  See [`provide_inject`](crate::guide::provide_inject#what-is-refused);
- any method call without a Rust twin.

Client-only code is allowed where the server never runs it: lifecycle hooks, `watch` (not
`immediate`), `defineEmits`, `defineExpose`, template refs, functions and what is injected under a key
holding a function may be named from event handlers, which the server drops. The repository README's "What a component may use" table lists
everything that is supported.

# Helpers

A template may call functions of your own if each has a Rust twin. Name them in
`ferrovue.config.json`:

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

A component the compiler refuses can still be on the page if the server does not render it. Put it
in `<ClientOnly>`, from `ferrovue/client`: the server writes the `#fallback` slot between fragment
markers (or `<!---->` without one), the browser hydrates that fallback and swaps in the default
slot once mounted. The compiler does not read the default slot at all, so any import or expression
may go there. The swap happens only where Vue runs: inside an island, or an app hydrated whole.

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
passes beyond the props together with the scope ids the root takes. An absent `bool` is `false`
and a bare attribute (`<VBtn block>`) is `true`, as Vue casts them.

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
code, as a helper's does. Hold each twin to
Vue with fixtures of the components that use it, rendered by Vue and by the generated Rust and
compared: the [`testing`](crate::guide::testing) page sets that up with `conformanceSuite` from
`ferrovue/testing` and [`conformance!`](crate::conformance!). Slot content is written as a render function sees it, from virtual nodes:
an absent `v-if` is `<!--v-if-->`. Fragment markers around a slot, and what an empty one shows, are
the twin's to write, as they are the component's. The repository's `examples/fullstack` has a twin
and its fixtures.

# At run time

Generated code does not return errors: a render writes into a `String` and cannot fail. The few
panics are programming errors, found the first time the code runs:

- [`Router::tree`](crate::Router::tree), [`Router::named`](crate::Router::named) and
  [`Router::new`](crate::Router::new) panic on a route path outside the supported syntax, or two
  routes with the same name. The generated `router()` uses routes the compiler has checked.
- [`Route::link_named`](crate::Route::link_named) panics on a route name no route has (the compiler
  checks the names a template uses), and in a debug build on a required parameter that is missing
  or empty, which makes vue-router throw. A release build writes the link without it.
- [`I18n::t`](crate::I18n::t) panics in a debug build when a fractional plural number chooses none
  of a message's cases (`1.5` with three cases), where vue-i18n throws. A release build writes
  nothing for the message.
- [`js_repeat`](crate::js_repeat), [`js_pad_start`](crate::js_pad_start) and
  [`js_pad_end`](crate::js_pad_end) panic where JavaScript throws a `RangeError`: a negative or
  infinite `.repeat()` count, or a result longer than V8's longest string. See
  [`strings`](crate::guide::strings#panics).

Serialising an island's props or the stores' state cannot fail for the types the compiler
generates. If a hand-written [`TrustedHtml`](crate::TrustedHtml) type's `Serialize` fails, the
island gets empty props and the client leaves the server's markup as it is.

# Limits worth knowing

- **Integers** are exact within ±2⁵³, as in JavaScript. See [`numbers`](crate::guide::numbers).
- **Strings** count UTF-16 code units, as in JavaScript, and half of a surrogate pair is written as
  U+FFFD, as a server sends it. See [`strings`](crate::guide::strings).
- **Scope ids** are computed as `@vitejs/plugin-vue` computes them only when `scopeId` and
  `viteRoot` match its configuration; a wrong id hydrates cleanly and leaves the styles unapplied.
  See [`scoped_styles`](crate::guide::scoped_styles).
- **String-literal unions** are not checked in Rust: a value outside the union renders as given.
- **Optional values must be narrowed** before use, as TypeScript requires: `v-if="user"`,
  `user !== undefined`, `??`.
- **One render per buffer at a time**: a render borrows its `String` mutably; render pages in
  parallel by giving each its own buffer. [`Teleports`](crate::Teleports) is per page and not
  `Sync`.
- **Same versions**: generated code and this crate are released together. After upgrading either,
  regenerate with the matching compiler.
