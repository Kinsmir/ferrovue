What the compiler refuses, and what can still go wrong at run time.

# Refused at compile time

The compiler translates a closed set of constructs, each proven against Vue by the conformance
suite. Anything else is an error, never an approximation, because an approximation would be a
hydration mismatch in the browser. Errors point into the `.vue` file, with the line quoted and a
caret under the construct. For example:

```text
components/Card.vue:12:18: `<` is supported between two numbers that are present: JavaScript orders strings by UTF-16 code unit, which is not supported
```

What is refused today, each with an error that names it:

- `<style scoped>`, `<style module>`, and `v-bind()` in CSS (a global `<style>` block is fine);
- `<component :is>`;
- `<RouterLink custom>`, slot props that are array literals, defaults in destructured slot props,
  and outlets of one slot that pass different props;
- custom directives not listed in `clientDirectives`;
- `watchEffect`, `watch` with `immediate`, `onServerPrefetch`, top-level `await`, and statements in
  setup that change state;
- `route.meta` and `route.matched`;
- Pinia getters that read `this` or return a function;
- ordering comparisons of strings;
- `null`;
- `v-html` of anything but a `TrustedHtml` prop;
- any method call without a Rust twin.

Client-only code is allowed where the server never runs it: lifecycle hooks, `watch` (not
`immediate`), `defineEmits`, `defineExpose`, template refs and functions may be named from event
handlers, which the server drops. The repository README's "What a component may use" table lists
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

# At run time

Generated code does not return errors: a render writes into a `String` and cannot fail. The few
panics are programming errors, found the first time the code runs:

- [`Router::tree`](crate::Router::tree), [`Router::named`](crate::Router::named) and
  [`Router::new`](crate::Router::new) panic on a route path outside the supported syntax, or two
  routes with the same name. The generated `router()` uses routes the compiler has checked.
- [`Route::link_named`](crate::Route::link_named) panics on a route name no route has (the compiler
  checks the names a template uses), and in a debug build on a missing required parameter, which
  makes vue-router throw. A release build writes the link without it.

Serialising an island's props or the stores' state cannot fail for the types the compiler
generates. If a hand-written [`TrustedHtml`](crate::TrustedHtml) type's `Serialize` fails, the
island gets empty props and the client leaves the server's markup as it is.

# Limits worth knowing

- **Integers** are exact within ±2⁵³, as in JavaScript. See [`numbers`](crate::guide::numbers).
- **String-literal unions** are not checked in Rust: a value outside the union renders as given.
- **Optional values must be narrowed** before use, as TypeScript requires: `v-if="user"`,
  `user !== undefined`, `??`.
- **One render per buffer at a time**: a render borrows its `String` mutably; render pages in
  parallel by giving each its own buffer. [`Teleports`](crate::Teleports) is per page and not
  `Sync`.
- **Same versions**: generated code and this crate are released together. After upgrading either,
  regenerate with the matching compiler.
