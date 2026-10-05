Holding your own components to Vue: the conformance suite, in two calls.

ferrovue's own suite renders every component it accepts with Vue and with the generated Rust,
compares the bytes, and hydrates each recorded render. An application gets the same check for its
components from a fixtures directory and two calls: `conformanceSuite` from `ferrovue/testing` for
the Vue half, and [`conformance!`](crate::conformance!) for the Rust half.

# Fixtures

A fixture is a JSON file of a component's props, in a directory named after the component, with
the HTML Vue rendered for it beside it:

```text
ferrovue.config.json
fixtures/
  Reviews/
    three.json        {"reviews":[{"reader":"Ada","stars":5,"text":"The spice must flow."}]}
    three.html        what Vue's renderToString wrote for those props
    none.json
    none.html
  Layout/
    home.json         {"shop":"Bookshop","$route":"/","$stores":{"basket":{"owner":"guest","ids":[]}}}
    home.html
```

Besides the props, a fixture may hold `$slots` (each slot's content as HTML, `routerView` for what
`<RouterView>` shows), `$route` (the location it renders at), `$stores` (Pinia state by store id)
and `$locale`, as the component takes them. A slot whose content is `""` hydrates; a `routerView`
of `""` does not, in Vue either: the server writes nothing for the page, and Vue's client takes
every component, the page included, to begin at a node of the DOM. Give each component a typical case, an empty or falsy
one, and a hostile one with markup-breaking characters (`<`, `&`, `"`, `'`) in every prop that
reaches the page.

# The Vue half

```ts
// test/conformance.test.ts
import { join } from "node:path";
import type { Component } from "vue";
import { conformanceSuite } from "ferrovue/testing";

await conformanceSuite({
  config: join(import.meta.dirname, "../ferrovue.config.json"),
  components: import.meta.glob<Component>("../client/components/*.vue", { eager: true, import: "default" }),
  pinia: await import("pinia"),
  vueRouter: await import("vue-router"),
});
```

Run it with vitest in a DOM environment (`environment: "happy-dom"`), with `@vitejs/plugin-vue`
configured as the client build configures it, so scoped styles get the ids the client gets.
`components` is every `.vue` file in the configured `components` directory; `fixtures` (beside the
configuration by default) names another fixtures directory. `pinia`, `vueRouter` and `vueI18n` are
the application's own modules, imported by the test file: vitest may load `ferrovue/testing` with
Node and the application's code through Vite, and a store or composable finds its Pinia, router or
i18n only in the module instance it was defined with. The suite:

- fails when a component has no fixtures, a fixture's directory names no component, or there are
  no components at all;
- fails when the generated Rust in `out` differs from what `ferrovue` writes now, with the diff;
- renders each fixture with Vue's `renderToString`, through the `ssrRender` the component's SSR
  build has (`attachSsrRender`), with a router over the configured routes, Pinia state and
  vue-i18n as the fixture and the configuration ask, and fails on any difference from the recorded
  `.html`, saying where the two first differ;
- hydrates each recorded `.html` with Vue, waiting for `<ClientOnly>` to show its content and async
  components to load, and fails on any warning or error Vue logs, or when Vue replaces the
  server's first node.

`FERROVUE_FIXTURES_WRITE=1` records instead: each fixture's `.html` is written from Vue's render,
and nothing is hydrated. Read the recorded HTML before committing it; a changed `.html` means Vue
or the component changed, and that diff is what a reviewer needs to see. vue-router, Pinia and
vue-i18n not passed in are loaded only when the configuration or a fixture needs them, and `vitest`
only by `conformanceSuite`.

# The Rust half

The generated `mod.rs` has, in test builds, a `render_json(component, json)` that renders a
component from a fixture. `conformance!` writes the test that renders every fixture through it and
compares the bytes with the recorded `.html`:

```rust
// src/main.rs or src/lib.rs
#[rustfmt::skip]
# /*
mod generated;
# */
# mod generated {
#     pub fn render_json(component: &str, _json: &str) -> Result<String, String> {
#         Err(format!("no component called {component}"))
#     }
# }

ferrovue::conformance!("fixtures", generated::render_json, at_least = 24);
# fn main() {}
```

The path is relative to the crate's manifest. The test fails, listing each fixture, when a render
differs from its `.html` (with where they first differ), a fixture has no `.html` or names no
component, or fewer than `at_least` fixtures are found (one when it is not given), so a suite that
finds nothing does not pass. [`check_fixtures`](crate::check_fixtures) is the same check as a
function, for a test of your own.
