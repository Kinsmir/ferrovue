# Contributing to ferrovue

Thanks for helping! ferrovue makes one promise: for every component it accepts, the generated Rust
writes exactly the bytes Vue's server renderer writes, and anything it cannot reproduce is refused
with an error naming the construct. Every change is judged against that.

## Setting up

You need Node 22.18 or newer with pnpm, and the latest stable Rust.

```sh
pnpm install
pnpm test                    # compiler, CLI, vectors, router, the Vue half of conformance
pnpm typecheck
pnpm lint                    # oxlint (type-aware, on TypeScript 7), and fallow for unused files, exports and dependencies
cargo test --workspace --all-features
cargo deny check             # licences, advisories, duplicate crates and sources (deny.toml)
```

`pnpm lint:fix` applies the fixes both tools can make on their own; review the diff before committing.

[TESTING.md](TESTING.md) explains how the suite fits together.

## Adding support for a Vue construct

1. **Look at what Vue does.** `node scripts/inspect.ts X.vue '{"prop":"value"}'` prints Vue's SSR
   compilation of a component, Vue's render, and what ferrovue generates today. Read the matching
   `@vue/server-renderer`, `@vue/shared` or vue-router source in `node_modules` too: the rules you
   reproduce are defined there.
2. **Translate it** in the compiler, `packages/ferrovue/src/` (the README's "Repository layout"
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
   examples copy generated code, and `cargo test --doc -p ferrovue` runs them.

Never re-record a fixture to make a failing test pass. A changed `.html` means Vue changed or the
compiler did, and that diff is what a reviewer needs to see.

## Compiler plugins

What Vue's core does not do (vue-router, Pinia, vue-i18n) and scoped styles are compiler plugins,
in `packages/ferrovue/src/plugins/`, so that the core compiler names none of them. A plugin is an
object of optional hooks, `Plugin` in `src/plugin.ts`, where each hook is documented; the plugins
are listed in `plugins/index.ts`, and the core calls their hooks at fixed points of a run. The
interface is internal: it is not part of the npm package's API, and it changes when an integration
needs it to.

| When | Hooks | Used by |
|---|---|---|
| A run starts | `configure` returns the plugin's state for the run, read from its keys of `Config`; `prepare` reads files with the core's own readers, once every plugin is configured | all; `prepare`: stores |
| A component is read | `sfc` (its `<style>` blocks), `templateOptions` (how Vue compiles its template), `importedType` (a type from a file the plugin owns), `struct` (where a type of its own is declared), `compiled` (what its compiled template renders or reads) | scoped styles; stores; router, i18n, `<Teleport>`, `<ClientOnly>` |
| Every component at once | `analyse`, before any is generated | scoped styles, twins |
| `<script setup>` | `scope` (its state for one setup), `scriptImport`, `scriptBinding` (a binding of its own, given the setup's `let`s to add to), `scriptStatement` (a statement of its own: `provide(…)`, `useHead(…)`) | router, stores, i18n, twins; provide and inject, the page head |
| Expressions | `global` (`$route`), `call` (`$t(…)`), `member` (a field of the route, a store's getter), `equality` and `presence` (`typeof q === "string"`), `values` (what `??`, `===`, a test, `{{ }}` and an attribute make of a type it adds) | router, stores, i18n |
| The compiled template | `resolveComponent` and `component` (`<RouterLink>`, `<RouterView>`, `<ClientOnly>`, a twin), `child` (a child it refuses), `childIds` (the scope ids a child's root is handed), `statement` (`_ssrRenderTeleport`) | router, `<ClientOnly>`, twins; scoped styles; `<Teleport>` |
| The Rust written | `params` (a render parameter, its fixture field and how the conformance suite builds it; with `slotContext`, also handed to slot content by the outlet that renders it), `prelude` (lines at the start of a render: `before` the setup's, and `after` them in `plugins/index.ts` order), `slotFields` (`router_view`), `modules` (`route_table.rs`, `stores.rs`, `i18n.rs`, `twins.rs`, `provides.rs`) | router, stores, i18n, `<Teleport>`, provide and inject, the page head; provide and inject, the page head; router; router, stores, i18n, twins, provide and inject |

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

An integration still to come (file-based routes) is a new file in
`plugins/`, added to `plugins/index.ts`. Where no hook reaches what it needs, add one to `Plugin`,
documented there and called from one place in the core, so the core still names no
integration.

## Pull requests

- Keep a pull request to one change; the template's checklist covers what CI cannot.
- Commit messages are short and say what changed (`compiler: support v-show on the root`), with
  detail in the body when the why is not obvious.
- CI must be green: tests on Node 22 and 24 and on stable Rust and the declared minimum, `pnpm lint`,
  clippy and rustfmt, docs, the example, hydration in real browsers (`pnpm test:browser`), both
  packages packing cleanly, and `cargo deny` on the dependencies' licences, bans and sources. A new
  RustSec advisory shows in the run without failing a pull request; it does fail a release. The
  **CI passed** job sums up the rest: it fails when any other CI job does.
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
