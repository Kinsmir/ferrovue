Moving an existing Vue 3 server-rendered app to ferrovue: a Vite SSR setup, or a Node server that
calls `renderToString`.

Each step links to the page that covers it in depth. The repository's
[`examples/fullstack`](https://github.com/Kinsmir/ferrovue/blob/main/examples/fullstack/README.md)
is a finished app of this shape to compare with: an axum server, a Vite client, islands, Pinia,
vue-router and streaming.

# What changes and what stays

ferrovue replaces the server half. The Node process that builds an app with `createSSRApp`, loads
data, and calls `renderToString` from `@vue/server-renderer` becomes a Rust binary. At build time
the ferrovue compiler turns each `.vue` file into a Rust module, and the server calls that module's
`render` with the component's props: a function call that writes into a `String`, with no
JavaScript runtime.

The client half stays. The browser still runs Vue, built by Vite with `@vitejs/plugin-vue` from the
same `.vue` files, and hydrates the HTML the Rust server wrote. vue-router, Pinia, vue-i18n and
`@unhead/vue` keep running in the browser as they do now. The server writes the bytes Vue's
`renderToString` writes for the same input, so hydration finds the DOM it expects.

The project's `vue` and its integrations must be in the ranges ferrovue supports, since its output
is held to fixtures recorded from one version of each: the README's
[Versions](https://github.com/Kinsmir/ferrovue#versions) table lists them, and
[`support`](crate::guide::support) says how they move.

# 1. Install both halves

```sh
pnpm add -D ferrovue
cargo add ferrovue serde --features serde/derive
cargo add --dev serde_json
```

The crate that includes the generated code uses edition 2024.
[`quick_start`](crate::guide::quick_start#1-install-both-halves) says what each dependency is for,
and the crate's feature flags (`axum`, `actix-web`, `stream`, `router`, `i18n`, `chrono`,
`ammonia`, …) are listed on [the crate's front page](crate#feature-flags).

# 2. Configure

`pnpm ferrovue init` writes a starter `ferrovue.config.json`; or write one at the project root with
the two required keys:

```json
{
  "$schema": "./node_modules/ferrovue/schema.json",
  "components": "client/components",
  "out": "src/generated"
}
```

Then add a key for each part of the app the server must reproduce:

| The app uses | Configure | See |
|---|---|---|
| vue-router | `routes` (a JSON file of routes, or `{ "pages": "client/pages" }`), or `router` with `base` and the link classes `createRouter` is given | [`routing`](crate::guide::routing) |
| Pinia | `stores`, the directory of store files | [`pinia`](crate::guide::pinia) |
| vue-i18n | `i18n`: `{ messages, locale?, fallbackLocale? }` | [`i18n`](crate::guide::i18n) |
| `<style scoped>`, `v-bind()` in `<style>`, `<style module>` | `scopeId`, `viteRoot` and `isProduction` as the Vite build sets them, and `cssModules` as Vite's `css.modules` | [`scoped_styles`](crate::guide::scoped_styles) |
| `v-html` | `trustedHtml`, the Rust type of a `TrustedHtml` prop | [`escaping`](crate::guide::escaping) |
| `Date` props | `dateType`, when the default `ferrovue::date::JsDate` does not suit | [`dates_and_prices`](crate::guide::dates_and_prices#date-props) |
| Functions of its own called from templates | `helpers` | [`errors_and_limits`](crate::guide::errors_and_limits#helpers) |
| Components from a library the compiler refuses | `twins` | [`errors_and_limits`](crate::guide::errors_and_limits#rust-twins) |
| Custom directives with no server output | `clientDirectives` | [`quick_start`](crate::guide::quick_start#2-configure) |

The [`quick_start`](crate::guide::quick_start#2-configure) table describes every key, and the
JSON Schema named by `$schema` lets an editor complete and check them.

# 3. Generate the Rust and commit it

```sh
pnpm ferrovue
```

This writes one module per component into `out`, with `mod.rs` declaring them. Include the
directory once, with `#[rustfmt::skip]` on the `mod generated;` line, and commit it: the server
builds from it with no Node installed. In CI, `pnpm ferrovue --check` fails when a committed module
is stale. A Vite project can add the `ferrovue/vite` plugin, which regenerates the modules in the
dev server and before a build. [`generated_code`](crate::guide::generated_code) describes each file
and what of it is stable API.

# 4. Move the server to Rust

What the Node server did per request moves into a Rust handler:

- **Responding.** The `axum` and `actix-web` features make a render a response:
  [`web_frameworks`](crate::guide::web_frameworks). [`streaming`](crate::guide::streaming) sends a
  page in the order its parts are ready.
- **Loading data.** Data a component awaits at the top of `<script setup>` becomes a loader:
  declare the function with `defineLoader`, implement the generated `Loaders` trait in Rust, and
  render through `loaders::load`, which writes the results for the client to hydrate from
  ([`loaders`](crate::guide::loaders)). Data fetched in `onServerPrefetch`, or before
  `renderToString`, is loaded by the handler and passed in as props; the compiler refuses
  `onServerPrefetch` and any other top-level `await`, and the client receives the same values
  through the island's props, the page record or the Pinia state.
- **Routing.** Build the router once from the generated `route_table::router()`, resolve each
  request with `router.at(path)`, and choose the page from the route's name and parameters. A
  layout with `<RouterView>` takes the page as its `router_view` slot:
  [`routing`](crate::guide::routing#a-router-per-application-a-route-per-request).
- **Pinia.** The state is a generated Rust struct filled per request and passed to `render`;
  `state_script_into` writes it into the page, and `hydrateState` on the client starts every store
  from it: [`pinia`](crate::guide::pinia#rendering-and-handing-the-state-over).
- **vue-i18n.** Build an `I18n` per request with the generated `i18n(locale)`:
  [`i18n`](crate::guide::i18n#rendering-in-a-locale).
- **The page head and teleports.** `useHead` and `useSeoMeta` write into a
  [`Head`](crate::head::Head), and `<Teleport>` into [`Teleports`](crate::page::Teleports), which the server
  places in the page: [`head`](crate::guide::head) and [`teleports`](crate::guide::teleports).
- **provide and inject.** What the client app gives `app.provide` is a generated `Provides`:
  [`provide_inject`](crate::guide::provide_inject).

# 5. Choose how the client hydrates

[`islands_and_hydration`](crate::guide::islands_and_hydration) describes three ways, which a page
may combine with islands:

- **The whole app**, as a Vue SSR app hydrates now: the client keeps its `createSSRApp(Root)` and
  mounts it on the server's element, starting from the same props, route, state and locale. This
  is the smallest change to the client:
  [hydrating the whole app](crate::guide::islands_and_hydration#hydrating-the-whole-app).
- **A page recorded part by part**: the server writes the layout and its parts with
  [`Page`](crate::page::Page), and `mountPage` hydrates them as one app:
  [hydrating a page](crate::guide::islands_and_hydration#hydrating-a-page).
- **Islands**: each interactive component hydrates on its own from its props, with `mountIslands`
  and the `ferrovue/islands` module the Vite plugin writes. The rest of the page stays static HTML,
  and the browser fetches only the islands' code. A component has an `island()` when its render
  needs its props alone: [islands](crate::guide::islands_and_hydration#islands).

[Islands or a page](crate::guide::islands_and_hydration#islands-or-a-page) compares them, and
[what makes hydration fail](crate::guide::islands_and_hydration#what-makes-hydration-fail) lists
the usual causes of a mismatch.

# 6. Work through what the compiler refuses

The first run on an existing app usually reports errors, all of them at once, then a line that counts
them. Each names the file, line and column, and has a stable code:

```text
error[FV1805]: components/Card.vue:4:17: `.toLocaleString()` formats by locale with `Intl`, whose output differs between Node, Chromium, Firefox and Safari: format the value in Rust and pass a string, or translate it with `$t` (see the `dates_and_prices` guide)
 4 | <template><p>{{ n.toLocaleString() }}</p></template>
   |                 ^
 = docs: https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv1805
```

`pnpm ferrovue --format json` writes the same errors as JSON, each with its `code`, `severity`,
`title`, `message` and `docs` link, which makes a long list easy to sort by code and work through
one kind at a time. [`error_codes`](crate::guide::error_codes) explains every code, and
[`quick_start`](crate::guide::quick_start#editor-and-ci-diagnostics) has a VS Code problem matcher
for them. The `ferrovue/volar` plugin underlines them in the editor as you type:
[`quick_start`](crate::guide::quick_start#diagnostics-in-your-editor).

[`errors_and_limits`](crate::guide::errors_and_limits) lists what is refused and why. The ways
around a refusal, from the least work:

- **Rewrite the expression** as the message suggests: narrow an optional value before use, join a
  list before binding it to an attribute, compare values of one type.
- **Type an object literal** with the interface it builds: a `computed` returning an object
  (`computed((): Card => …)`), a function's return type, a `.map((x): Row => ({ … }))` callback. The
  compiler builds the literal as that interface's Rust struct, where an untyped one is refused
  (FV0634): [object literals](crate::guide::script_logic#object-literals).
- **Compute the value in Rust and pass it as a prop.** Locale formatting, the current time and
  anything else the server cannot reproduce exactly is worked out by the handler and passed as a
  `string` or `number` prop, which the client receives unchanged:
  [format in Rust, pass a string](crate::guide::dates_and_prices#format-in-rust-pass-a-string).
- **A helper**: a function of your own the template calls, mapped to a Rust twin in `helpers`:
  [helpers](crate::guide::errors_and_limits#helpers).
- **`<ClientOnly>`** from `ferrovue`, around content the server need not render. The
  server writes the `#fallback` slot, and the compiler does not read the default slot at all:
  [client-only content](crate::guide::errors_and_limits#client-only-content).
- **A Rust twin**: a component the server must render and the compiler cannot compile, such as a
  component library's button, rendered by a Rust function of yours named in `twins`:
  [Rust twins](crate::guide::errors_and_limits#rust-twins).

Helpers and twins are your code, and ferrovue does not check that they write what Vue writes: hold
the components that use them to Vue with fixtures, as the next step does. When none of these fits
a construct you need, [`support`](crate::guide::support#reporting-a-bug-or-a-refusal) says how to
ask for it.

# 7. Verify the output against Vue

[`testing`](crate::guide::testing) holds an application's own components to Vue with fixtures and
two calls. A checklist for a port:

1. **Fixtures for every component.** A directory per component under `fixtures/`, each fixture a
   JSON file of props, with `$slots`, `$route`, `$stores` and `$locale` where the component takes
   them. Give each component a typical case, an empty or falsy one, and one with `<`, `&`, `"` and
   `'` in every prop that reaches the page.
2. **The Vue half.** A vitest file calls `conformanceSuite` from `ferrovue/testing` with the
   configuration, every component, and the app's own `pinia`, `vueRouter` and `vueI18n` modules.
   Run it in a DOM environment with `@vitejs/plugin-vue` configured as the client build configures
   it.
3. **Record from Vue.** `FERROVUE_FIXTURES_WRITE=1` writes each fixture's `.html` from Vue's
   `renderToString`. Read the recorded HTML before committing it.
4. **Run it again without recording.** The suite fails when a render differs from the recorded
   `.html`, when Vue's hydration of it logs a warning, when a component has no fixtures, and when
   the committed Rust is stale.
5. **The Rust half.** `ferrovue::conformance!("fixtures", generated::render_json, at_least = N)`
   writes a test that renders every fixture with the generated Rust and compares the bytes, and
   fails when it finds fewer than `N` fixtures.
6. **Pages and client renders.** `hydrateRecordedPage` from `ferrovue/testing/browser` hydrates a page as
   the server wrote it:
   [testing a page](crate::guide::islands_and_hydration#testing-a-page). An app that renders the
   next page from its record on navigation passes `clientRender: true` to `conformanceSuite`.
7. **Your own tests.** `fixtureApp` from `ferrovue/testing/browser` builds the app a fixture describes, for
   a vitest test of your own:
   [fixtures in your own vitest tests](crate::guide::testing#fixtures-in-your-own-vitest-tests).
8. **In CI.** Run `pnpm ferrovue --check`, the vitest suite and `cargo test` on every change, so a
   component edit that changes the output fails until its fixtures are recorded again and reviewed.
