# Contributing to ferrovue

Thanks for helping! ferrovue makes one promise: for every component it accepts, the generated Rust
writes exactly the bytes Vue's server renderer writes, and anything it cannot reproduce is refused
with an error naming the construct. Every change is judged against that.

## Setting up

You need Node 22.23.4 or newer on 22, 24.22.1 or newer on 24, or 26.12.1 or newer, with pnpm, and the latest stable Rust.

```sh
pnpm install
pnpm test                    # compiler, CLI, vectors, router, the Vue half of conformance
pnpm typecheck
pnpm lint                    # oxlint (type-aware, on TypeScript 7), and fallow for unused files, exports and dependencies
cargo test --workspace --all-features
cargo deny check             # licences, advisories, duplicate crates and sources (deny.toml)
cargo deny --manifest-path fuzz/Cargo.toml --config fuzz/deny.toml check   # the same for the fuzz targets
pnpm audit                   # advisories in the npm dependencies (pnpm-lock.yaml)
uvx zizmor .                 # security lint of the workflows, composite actions and Dependabot
```

`pnpm lint:fix` applies the fixes both tools can make on their own; review the diff before committing.

With [just](https://just.systems), `just check` runs the pull request template's checklist in one
go: type check, lint and tests on both sides, Clippy and rustfmt, the generated code's `--check`s
and `cargo deny check` (`just --list` shows the parts). `rust-toolchain.toml` selects stable Rust
with Clippy and rustfmt, `.node-version` the Node.js CI mostly runs (for fnm, nodenv and the like),
and `.editorconfig` the repository's whitespace, leaving recorded fixtures byte for byte.

[TESTING.md](TESTING.md) explains how the suite fits together and how to add a case, and
[RELEASING.md](RELEASING.md) how a release is cut. `pnpm bench` runs the benchmarks the README's
Performance section reports: `pnpm bench:rust` is `cargo bench -p ferrovue --bench render`
(`crates/ferrovue/benches/render.rs`), `pnpm bench:js` Vue's `renderToString` with tinybench
(`packages/ferrovue/bench/ssr.bench.ts`), and `pnpm bench:record` rewrites
`benches/expected/*.html` from Vue after a scenario changes. They are not part of `pnpm test`.

## Repository layout

```text
crates/ferrovue/             the Rust runtime crate, which generated code calls
  src/                       a module per part (`Html`, slots, class and style, the state script,
                             strings, teleports, the page head, fallthrough attributes, `BasicHtml`
                             and `InlineHtml`,
                             `Sanitised`, `JsDate`, `Refused` and the refusals a render holds, the
                             fixture check `conformance!` writes), each module's
                             unit tests beside it in <module>/tests.rs; lib.rs re-exports them all,
                             and the three crates below
  docs/guide/                the crate guide, `ferrovue::guide` on docs.rs
  tests/conformance/         components, fixtures, recorded HTML, generated Rust
  tests/literal_props/       components compiled with `"builders": false`
  tests/closed_unions/       components that read props typed as closed unions through lookups and `:is`
  tests/sanitised/           a component whose `TrustedHtml` is `ferrovue::Sanitised`
  tests/chrono_dates/        the conformance suite's `Date` components, compiled with chrono's type
  tests/own_dates/           `DateStamp`, compiled with a `dateType` whose time values need clipping
  tests/vectors/             vectors recorded from JavaScript and Vue
  tests/properties.rs        property-based tests of the runtime
  benches/                   criterion and instruction-count benchmarks of generated renderers
crates/ferrovue-core/        escaping, JavaScript's numbers and URI encoding, which the other crates share
  tests/vectors/             vectors recorded from escapeHtml, String(n), Math, toFixed,
                             toPrecision, toExponential, encodeURIComponent and encodeURI
crates/ferrovue-router/      vue-router's matching and links (the `router` feature)
  tests/vectors/             vectors recorded from vue-router
crates/ferrovue-i18n/        vue-i18n's t() (the `i18n` feature)
crates/ferrovue-contract/    unpublished: Rust using every item of the generated-code contract,
                             and the version check's message (trybuild)
packages/ferrovue/           the compiler (npm package)
  src/index.ts               `ferrovue`: the browser API, `mountIslands`, `mountPage`, `readPage`, `renderPage`, `hydrateState` and the types
  src/compiler.ts            `ferrovue/compiler`: `generate`, `write`
  src/context.ts, model.ts   `ferrovue.config.json`, and the types and values the compiler passes around
  src/schema.ts              the configuration's keys, types and defaults, from which `schema.json` is written
  src/component.ts, script.ts, typescript.ts, constants.ts
                             a `.vue` file read, <script setup>, TypeScript types, constants and enums
  src/template.ts, children.ts, slots.ts, loops.ts, vhtml.ts
                             the compiled template: statements, child components, slots, v-for,
                             where `v-html` may go
  src/expr.ts, strings.ts, numbers.ts, narrowing.ts, calls.ts, lists.ts, parens.ts
                             expressions: operators, strings, numbers, narrowing, calls, lists,
                             the parentheses Rust needs
  src/attrs.ts, classes.ts, styles.ts, fallthrough.ts
                             attributes, class and style, attributes a parent passes on
  src/dynamic.ts             `<component :is>` over a closed set of choices
  src/plugin.ts              the plugin interface (see Compiler plugins below)
  src/plugins/               vue-router, Pinia, vue-i18n, scoped styles, <Teleport>, shared types,
                             <ClientOnly>, Rust twins, provide and inject, the page head
  src/rust.ts, emitter.ts    the Rust source written out
  src/cli.ts, args.ts, vite.ts
                             the `ferrovue` command, its options, and the Vite plugin
  src/diff.ts                the diff `ferrovue --check --diff` prints for a stale file
  src/inputs.ts              what a run reads, which `--watch` and the Vite plugin regenerate on
  src/files.ts, paths.ts     reading the directories and files the configuration names, and paths
                             written with `/` on every platform
  src/resolve.ts             the `.ts` file an import leads to: a relative path, tsconfig's `paths`
                             and `baseUrl`, Vite's `resolve.alias`
  src/errors.ts, diagnostics.ts
                             every error code with its title, and errors as the CLI, JSON and Vite show them
  src/volar.ts, editor.ts    `ferrovue/volar`: errors in the editor, from a plugin for Vue's language tools
  src/client.ts              browser-side helpers: `mountIslands`, `mountPage`, `readPage`, `renderPage`, `hydrateState`, `<ClientOnly>`
  src/islands.ts             `ferrovue/islands`, which the Vite plugin writes: every island, loaded lazily
  src/link-router.ts         `ferrovue/link-router`: `<RouterLink>` while the application navigates on its own
  src/routes.ts              a routes file as vue-router's route records
  src/file-routes.ts         the routes vue-router's file-based routing builds from a folder of pages
  src/page-routes.ts         `ferrovue/routes`, which the Vite plugin writes from the pages
  src/testing.ts             `ferrovue/testing`: utilities for a project's own conformance suite
  src/fixture.ts, settle.ts  `fixtureApp` and `readFixture`, and waiting for async components to settle
  src/conformance.ts         `conformanceSuite`, which `ferrovue/testing` exports
  src/ssr.ts                 `attachSsrRender`, which `ferrovue/testing` exports
  src/hydration.ts           `hydrateRecordedPage` and `renderRecordedPage`, which `ferrovue/testing` exports
  src/client-render.ts       the DOM of a client render as it is compared with the server's markup
  src/types.ts               `ferrovue/types`: `TrustedHtml`, `InlineHtml`, `Float`
  test/                      compiler, CLI, router, vector, island, Vite and conformance tests
  api/                       the package's API report, an `.api.md` per export and `cli.txt` (`pnpm api:report`)
  schema.json                the JSON Schema of `ferrovue.config.json` (`pnpm schema:generate`)
  browser/                   conformance fixtures and recorded pages hydrated in real browsers (`pnpm test:browser`)
  bench/                     Vue renderToString benchmarks, the other half of Performance
  fuzz/                      the randomised differential tester (`pnpm fuzz`)
examples/greeting/           the smallest setup: one component rendered from Rust
examples/fullstack/          axum + Vite: islands (some hydrating later), a page hydrated whole,
                             Pinia state, routes from a folder of pages, the page head, streaming,
                             loaders, <ClientOnly>, a Rust twin, and a conformance suite
examples/dioxus/             a Dioxus page, rendered with dioxus-ssr, with an island in it
fuzz/                        cargo-fuzz targets for the runtime's escaping and JSON (see TESTING.md)
scripts/ferrovue-in.ts       the `ferrovue` command run in a project of this repository (`pnpm conformance:check`, CI)
scripts/inspect.ts           Vue's SSR code and render of a component beside the Rust ferrovue generates for it
scripts/release.ts           the release version bump and the members check (see RELEASING.md)
scripts/api-report.ts        the npm package's API report, written and checked (`pnpm api:report`, `pnpm api:check`)
scripts/traceability.test.ts the README's "What a component may use" rows, traced to conformance components in TESTING.md
```

## Adding support for a Vue construct

1. **Look at what Vue does.** `node scripts/inspect.ts X.vue '{"prop":"value"}'` prints Vue's SSR
   compilation of a component, Vue's render, and what ferrovue generates today. Read the matching
   `@vue/server-renderer`, `@vue/shared` or vue-router source in `node_modules` too: the rules you
   reproduce are defined there.
2. **Translate it** in the compiler, `packages/ferrovue/src/` ([Repository layout](#repository-layout)
   says which module does what), or in a plugin when it belongs to an integration (below), with
   runtime support in `crates/ferrovue/src/` if generated code needs it (`crates/ferrovue-router/`
   or `crates/ferrovue-i18n/` for the router and vue-i18n, `crates/ferrovue-core/` for escaping and
   numbers; `ferrovue` re-exports what they add, at its root).
3. **Prove it with conformance.** Add a component under `crates/ferrovue/tests/conformance/components/`
   and fixtures beside the others: a typical case, an empty or falsy one, and a hostile one with
   markup-breaking characters in every prop that reaches the page. Run `pnpm conformance:generate`
   and `pnpm conformance:record`, read the recorded HTML, then run `cargo test`.
4. **Refuse the edges.** Whatever part of the construct you do not translate exactly must be an
   error. Add a case to `refused` in `packages/ferrovue/test/compiler.test.ts`. Each error has a
   stable code: add a new one to `ERRORS` in `packages/ferrovue/src/errors.ts`, after the last
   of its area, with a short title, and run `pnpm errors:generate` to rewrite the guide's
   `error_codes` page. A code is never reused or renumbered: one no longer raised gets `retired`
   and stays. `pnpm test` fails on a code raised but not listed, listed but not raised, listed
   twice, or an index that differs from the list.
5. **Document it** in the README's "What a component may use" table and in `CHANGELOG.md` under
   `[Unreleased]`. If it changes what generated code looks like or adds to the runtime, update the
   crate's guide too (`crates/ferrovue/docs/`, published on docs.rs as `ferrovue::guide`): its
   examples copy generated code, and `cargo test --doc -p ferrovue --all-features` compiles and
   runs every one of them, those for optional features included. An example that shows generated
   code, or calls it, compiles against a hidden stand-in module of the same shape.

Never re-record a fixture to make a failing test pass. A changed `.html` means Vue changed or the
compiler did, and that diff is what a reviewer needs to see.

## Compiler plugins

What Vue's core does not do (vue-router, Pinia, vue-i18n, the page head), scoped styles, and provide
and inject are compiler plugins, in `packages/ferrovue/src/plugins/`, so that the core compiler
names none of them. A plugin is an object of optional hooks, `Plugin` in `src/plugin.ts`, where each
hook is documented; the plugins are listed in `plugins/index.ts`, and the core calls their hooks at
fixed points of a run. The interface is internal: it is not part of the npm package's API, and it
changes when an integration needs it to.

| When | Hooks | Used by |
|---|---|---|
| A run starts | `configure` returns the plugin's state for the run, read from its keys of `Config`; `prepare` reads files with the core's own readers, once every plugin is configured; `components` names `.vue` files to compile beside the components directory's, each with its component name | all; `prepare`: stores; `components`: router (pages) |
| A component is read | `sfc` (its `<style>` blocks), `templateOptions` (how Vue compiles its template), `importedType` (a type from a file the plugin owns), `struct` (where a type of its own is declared), `compiled` (what its compiled template renders or reads) | `sfc`: scoped styles, CSS modules; `templateOptions`: scoped styles (its id, `v-bind()` variables); `importedType`, `struct`: stores; `compiled`: router, i18n, `<Teleport>`, `<ClientOnly>`, provide and inject, the page head |
| Every component at once | `analyse`, before any is generated | scoped styles, twins |
| `<script setup>` | `scope` (its state for one setup), `scriptImport`, `scriptBinding` (a binding of its own, given the setup's `let`s to add to), `scriptStatement` (a statement of its own: `provide(…)`, `useHead(…)`) | router, stores, i18n, twins, CSS modules (`useCssModule()`); provide and inject, the page head |
| Expressions | `global` (`$route`, `$style`), `call` (`$t(…)`), `member` (a field of the route, a store's getter, a module's class), `equality` and `presence` (`typeof q === "string"`), `values` (what `??`, `===`, a test, `{{ }}` and an attribute make of a type it adds) | router, stores, i18n, CSS modules; `call`: i18n, provide and inject |
| The compiled template | `resolveComponent` and `component` (`<RouterLink>`, `<RouterView>`, `<ClientOnly>`, a twin), `child` (a child it refuses), `childIds` (the scope ids a child's root is handed), `loadedLater` (statements in a block around the call of a child `defineAsyncComponent` loads), `statement` (`_ssrRenderTeleport`) | `resolveComponent`, `component`: router, `<ClientOnly>`, twins; `child`: router, provide and inject; `childIds`: scoped styles; `loadedLater`: the page head; `statement`: `<Teleport>` |
| The Rust written | `params` (a render parameter, its fixture field and how the conformance suite builds it; with `slotContext`, also handed to slot content by the outlet that renders it), `prelude` (lines at the start of a render: `before` the setup's, and `after` them in `plugins/index.ts` order), `slotFields` (`router_view`), `modules` (`route_table.rs`, `types.rs`, `stores.rs`, `i18n.rs`, `twins.rs`, `provides.rs`) | `params`: router, stores, i18n, `<Teleport>`, provide and inject, the page head; `prelude`: provide and inject, the page head; `slotFields`: router; `modules`: router, shared types, stores, i18n, twins, provide and inject |

- **State lives in the run.** A plugin's module holds nothing that changes: `configure` returns its
  state for the run, which `runOf(plugin)` reads back, and `scope` its state for one component's
  setup, which `scopeOf(plugin, s)` reads back.
- **The first claim decides.** A hook that may claim a node or an import answers `null`, `false` or
  `undefined` for anything not its own, and the first plugin to claim it in `plugins/index.ts`
  order decides.
- **The order is generated code.** Render parameters, the fixture's fields and the modules beside
  the components follow the order of `plugins/index.ts`, which is why `<Teleport>` and the shared
  types module, both the core's own, are written as plugins too. Add a plugin at the end, or the
  generated code of every project changes.
- **New kinds of value join the core's types** by declaration merging: the router adds `route` and
  `query` with `declare module "../model.ts" { interface PluginTys { … } }`, and the stores mark
  their own structs through `interface StructTy`. `values` tells the core what to do with them.

A new integration is a new file in `plugins/`, added to `plugins/index.ts`. Where no hook reaches
what it needs, add one to `Plugin`, documented there and called from one place in the core, so the
core still names no integration.

## The crates' contract

The crates' API is what their documentation shows, which `cargo-semver-checks` compares with the
last release (RELEASING.md):

- **Generated code's own helpers are hidden.** A runtime function or method that only generated
  code calls gets `#[doc(hidden)]`, on its `pub use` at the crate root or on the item, and is
  versioned with generated code through `__compat!`. Keep visible what an application calls or
  implements itself (a page, a hand-written twin, a `TrustedHtml` type) and what
  `docs/guide/generated_code.md` names, and link to no hidden item from the visible docs.
- **Types that may grow are `#[non_exhaustive]`.** Every public enum, and every struct with public
  fields. Code outside the crate, generated code included, builds one through a constructor and
  `with_` methods (`RouteDef::new("/books").with_name("books")`, `i18n::Args::new().with_plural(n)`),
  which are `const fn` where a generated `const` or `static` table calls them. A newtype generated
  code wraps values in (`Js`) stays exhaustive.
- **Values pointless to drop are `#[must_use]`**: constructors, builders, getters, and a method that
  consumes `self` to return its result. A function that writes into a buffer and returns whether it
  wrote anything is not.

## The npm package's contract

What a project relies on from the npm package is checked in the repository, so a pull request that
changes it shows the change:

- **Exports.** `packages/ferrovue/api/*.api.md` is an [API Extractor](https://api-extractor.com/)
  report of each entry of `package.json`'s `exports` (`ferrovue.api.md` for the package root), and
  `api/cli.txt` is `ferrovue --help`. `pnpm api:report` builds the package and rewrites them;
  `pnpm api:check`, run in CI, fails when they differ from what the build exports. A change to a
  report is a change to the public API: say so in the CHANGELOG.
- **Configuration.** `packages/ferrovue/schema.json` is the JSON Schema of `ferrovue.config.json`,
  shipped as `ferrovue/schema.json` and published with every version at
  `https://cdn.jsdelivr.net/npm/ferrovue@<version>/schema.json`, the `$schema` `ferrovue init`
  writes. The keys, types and defaults are `CONFIG_SCHEMA` in `src/schema.ts`, which the
  configuration's validation reads its keys from; the descriptions are the TSDoc of `Config` in
  `src/context.ts`. `pnpm schema:generate` writes the file, and `pnpm test` fails when the schema and
  `Config` disagree on a key, a type or whether it is required, when a default is not what the
  compiler does without the key, or when the file is stale.
- **Command-line options** are `FLAGS` in `src/args.ts`, which `--help` is written from.

### Deprecating

Something users rely on is removed in a later minor release before 1.0, and only in a major release
from 1.0, after at least one minor release in which it still works and warns:

- **A crate item** gets `#[deprecated(since = "0.7.0", note = "use `Other` instead")]`.
- **A configuration key** gets `deprecated: { since: "0.7.0", use: "`newKey`" }` in
  `CONFIG_SCHEMA` and a `@deprecated` tag in its TSDoc (the schema test checks the two agree). The
  compiler still reads it, and warns with `warning[FV1117]` naming the replacement; the JSON Schema
  marks it deprecated, so editors strike it through. A misspelt key is never taken for a deprecated
  one.
- **A command-line option** gets `deprecated: { since: "0.7.0", use: "'--new'" }` in `FLAGS`; it
  still works, warns with `warning[FV1118]`, and `--help` marks it.

Either warning goes to standard error, or into `diagnostics` with the `severity` `"warning"` under
`--format json`, and does not change the exit status. List what a release deprecates in the
CHANGELOG's `### Deprecated` subsection, and what it removes under `### Removed`.

## Pull requests

- Keep a pull request to one change; the template's checklist covers what CI cannot.
- Commit messages are short and say what changed (`compiler: support v-show on the root`), with
  detail in the body when the why is not obvious.
- CI must be green: tests on Node 22.23.4, 22, 24 and 26 and on stable Rust and the declared minimum,
  `pnpm lint`, clippy and rustfmt, docs, the example, hydration in real browsers
  (`pnpm test:browser`), both packages packing cleanly, `cargo deny` on the dependencies' licences,
  bans and sources, and zizmor on the workflows (any finding fails it, and `.github/zizmor.yml` lists
  the ones ignored with their reasons). A new RustSec advisory shows in the run without failing a
  pull request; it does fail a release.
  `pnpm audit` follows the same rule for an advisory that reaches the npm package's dependencies or
  peers, and lists one in development tooling only as a warning; the job's summary lists every
  advisory with its paths. An advisory the maintainer has judged harmless goes under
  `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`. The **CI passed** job sums up the rest: it
  fails when any other CI job does.
- A new dependency must be under a licence `deny.toml` allows (permissive ones compatible with
  MIT OR Apache-2.0) and come from crates.io.
- A new crate, example or npm package is listed by its path in `Cargo.toml`'s `members` or
  `pnpm-workspace.yaml`'s `packages`; neither uses wildcards, and `node scripts/release.ts members`
  fails on a member that is missing (CI runs it on every pull request).
- Every Rust dependency, dev-dependency included, has its version and default features in
  `Cargo.toml`'s `[workspace.dependencies]`; a crate takes it with `name.workspace = true` or
  `name = { workspace = true, features = [...], optional = true }`, and `release.ts members` fails on
  one declared in a crate's own manifest.
- Test data does not ship with the crates. A new directory of fixtures or vectors under a crate's
  `tests/` or `benches/` goes into that crate's `exclude` in `Cargo.toml`; the docs, the README and
  everything under `src/` that builds the library stay in the package.

## Licence

ferrovue is dual-licensed under MIT or Apache-2.0. Unless you explicitly state otherwise, any
contribution you intentionally submit for inclusion in this work, as defined in the Apache-2.0
licence, is dual-licensed as above, without any additional terms or conditions.
