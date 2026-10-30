# ferrovue

Vue 3 single-file components compiled to Rust render functions whose output is byte-identical to
Vue's `renderToString`. Anything the compiler accepts renders exactly as Vue does; anything it
cannot render exactly is refused with a located error and a stable FV code. Every change is judged
against that promise.

CONTRIBUTING.md (layout, adding a construct, compiler plugins, the crates' and the npm package's
contracts), TESTING.md (the test layers, adding a case, upgrading Vue) and RELEASING.md are the
reference; this file is the short version.

## Layout

- `packages/ferrovue`: the npm package `ferrovue`.
  - `src/client.ts`: the package root, the light browser API
    (`mountIslands`, `mountPage`, `readPage`, `renderPage`, `hydrateState`, `defineLoader`).
  - `src/compiler.ts`: `ferrovue/compiler`, with `src/config.ts` and `src/errors.ts` as
    `ferrovue/compiler/config` and `ferrovue/compiler/errors`. `src/cli.ts` and `src/args.ts` are the `ferrovue`
    command, `src/vite.ts` the Vite plugin, `src/volar.ts` the editor plugin, `src/testing.ts`
    `ferrovue/testing`.
  - `src/errors.ts`: every FV code with its title and detail.
  - `src/schema.ts`: the configuration's keys, from which `schema.json` is written.
  - `src/plugins/`: the integrations, as compiler plugins listed in `plugins/index.ts` (vue-router,
    Pinia, vue-i18n, scoped styles, CSS modules, `<Teleport>`, `<ClientOnly>`, Rust twins, provide
    and inject, the page head, dates, loaders). The order of that list is the order of generated
    code: add a plugin at the end.
  - `test/`, `browser/` (hydration in real browsers), `fuzz/` (the differential fuzzer), `api/`
    (the API reports), `bench/`.
- `crates/`: the runtime, released together at one version. `ferrovue-core` (escaping, numbers,
  URIs), `ferrovue-router`, `ferrovue-i18n`, and `ferrovue`, which holds the other three as its
  modules `core`, `router` and `i18n`.
  `ferrovue-contract` is unpublished: it uses every item of the generated-code contract and checks
  the version check's messages.
  - `crates/ferrovue/docs/guide/*.md`: the guide, published as `ferrovue::guide`. Its examples are
    doctests.
  - `crates/ferrovue/tests/conformance/`: a component per behaviour in `components/`, fixtures in
    `fixtures/<Component>/<case>.json` with the `.html` Vue rendered for each, and the Rust ferrovue
    writes in `generated/`.
- `examples/`: `greeting` (the smallest setup), `fullstack` (axum and Vite), `dioxus`.
- `fuzz/`: cargo-fuzz targets for the runtime.
- `scripts/`: `release.ts` (bump, members check), `api-report.ts`, `inspect.ts` (Vue's SSR code,
  Vue's render and ferrovue's Rust for one component), `ferrovue-in.ts` (the CLI run in a project
  of the repository), `traceability.test.ts` (the README's "What a component may use" rows, traced
  to conformance components in TESTING.md).

## Adding support for a construct

1. Read what Vue does: `node scripts/inspect.ts X.vue '{"prop":"value"}'`, and the
   `@vue/server-renderer` or `@vue/shared` source.
2. Translate it in `packages/ferrovue/src/`, or in a plugin when it belongs to an integration, with
   runtime support in the crates if generated code needs it.
3. Add a conformance component and fixtures: a typical case, an empty or falsy one, and a hostile
   one with markup-breaking characters in every prop that reaches the page. Record them with
   `pnpm conformance:record` and read the recorded HTML. Never re-record a fixture to make a test
   pass.
4. Refuse what is not translated exactly. A new refusal gets a code in `ERRORS` in
   `packages/ferrovue/src/errors.ts`, after the last of its area, with a title and a detail, and a
   case in `refused` in `packages/ferrovue/test/compiler.test.ts`. A code is never reused or
   renumbered: one no input can raise any more is marked `retired`.
5. Let the fuzzer (`packages/ferrovue/fuzz/`) generate the construct where it can.
6. Document it: the README's "What a component may use" table (with its row in TESTING.md), the
   guide, and an entry under `## [Unreleased]` in CHANGELOG.md.

## Rules

- Every change a user of the crates or the npm package can notice adds an entry under
  `## [Unreleased]` in CHANGELOG.md, following [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
  (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, in that order), at most two
  lines each with its detail in the guide. Tests, CI, lint, the fuzzer and contributor docs get none.
- Before adding a CHANGELOG entry, read `## [Unreleased]` for one about the same thing and edit
  it, so the section describes what will ship, each change once and as it ends up. A fix of
  something added in the same cycle goes into that thing's entry; an entry of its own under
  `Fixed` is for a bug the last release has, worded as a fix of that release. A released section
  changes only to correct a fact that was wrong about that release.
- A CHANGELOG entry is at most two lines: a short statement of the change, then, if needed, a bit
  of detail ending with a link to the docs.rs guide page that covers it. Lists of items, steps and
  reasons go in that page, and a breaking change links its section of the upgrade guide.
- Generated code opens with `ferrovue::__compat!(N)`, `N` being `GENERATED_VERSION` in
  `packages/ferrovue/src/rust.ts`. When generated code calls a crate item the last release lacks,
  the version goes up once in that release: a new arm in `crates/ferrovue/src/compat.rs`, a new
  `GENERATED_VERSION`, and the contract's trybuild messages recorded again (RELEASING.md, step 3).
- The crates' API is what their documentation shows. An item only generated code calls is
  `#[doc(hidden)]`; public enums and structs with public fields are `#[non_exhaustive]`, built
  through constructors and `with_` methods; constructors, builders and getters are `#[must_use]`.
- No re-exports, in Rust or TypeScript: an item is imported from and exported at the file or module
  that defines it. No `pub use` of any visibility, no `export … from`, and no `export { … }` or
  `export default` of an imported name. The one exception is the `ferrovue` crate's whole-crate
  modules `core`, `router` and `i18n`. `pnpm lint` runs `scripts/no-re-exports.ts`, which fails on
  any other.
- The npm package's exports are in `packages/ferrovue/api/*.api.md`, the configuration in
  `schema.json`, the CLI options in `FLAGS` in `src/args.ts`. A change to any of them is a change to
  the public API: say so in the CHANGELOG.
- Something users rely on is deprecated first (`#[deprecated]`, `deprecated:` in `CONFIG_SCHEMA` or
  `FLAGS`, warning FV1117 or FV1118) and removed in a later minor release before 1.0, and only in a
  major release from 1.0.
- The package root `ferrovue` stays the light browser API; the compiler is `ferrovue/compiler`.
  Optional peers (vue-router, Pinia, vue-i18n) are imported only where needed.
- Workspace members are listed by path, never by wildcard. Every Rust dependency, dev-dependencies
  included, is declared in the root `Cargo.toml`'s `[workspace.dependencies]` and used as
  `name.workspace = true` or `name = { workspace = true, features = [...] }`. A new dependency is
  under a licence `deny.toml` allows and comes from crates.io.
- Test data does not ship: a new directory of fixtures or vectors under a crate's `tests/` or
  `benches/` goes into that crate's `exclude`.
- pnpm, never npm, in commands and instructions.
- Run one-shot commands only. Do not start dev or watch servers (`pnpm dev`, `vite`, `--watch`)
  unless asked to.
- Examples, fixtures and docs are generic: never name an application that uses ferrovue.

## Comments

No comments that say what code does or why, in code, tests, config or CI files. What stays:

- short rustdoc and TSDoc on public items
- lint-allow reasons (`// oxlint-disable-next-line rule -- reason`, `#[allow(..., reason = "...")]`)
- `@generated` headers, and the comments the compiler writes into generated code
- the reasons in `.cargo/mutants-equivalent.txt`, `.cargo/mutants-timeout.txt`,
  `stryker-equivalent.txt` and `stryker-timeout.txt`
- the recipe descriptions in `justfile`, which `just --list` shows

## Prose

Docs, CHANGELOG, doc comments, error messages, test names, commit messages and PR text:

- No em dashes.
- State what a thing is or does. No contrast framing: "X, not Y", "not X but Y", "rather than Y",
  "instead of Y", "not only X". An error message says what to do.

## Generated files

Regenerate these after a change or a rebase; never merge them by hand.

| Files | Command |
| --- | --- |
| conformance Rust (`crates/ferrovue/tests/conformance/generated/`) | `pnpm conformance:generate` |
| conformance fixtures' `.html` | `pnpm conformance:record` |
| vectors (`crates/*/tests/vectors/`) | `pnpm vectors:record` |
| any other project's Rust (each directory with a `ferrovue.config.json`) | `node scripts/ferrovue-in.ts <directory>` |
| `crates/ferrovue/docs/guide/error_codes.md` | `pnpm errors:generate` |
| `packages/ferrovue/api/` | `pnpm api:report` |
| `packages/ferrovue/schema.json` | `pnpm schema:generate` |
| the contract's trybuild messages | `TRYBUILD=overwrite cargo test -p ferrovue-contract --test compat` |

## Checks

`just check` runs the pull request template's checklist. One by one:

```sh
pnpm test && pnpm typecheck && pnpm lint
pnpm api:check
pnpm conformance:check
node scripts/release.ts members
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
cargo deny check
FERROVUE_FUZZ_COUNT=300 pnpm fuzz
pnpm test:browser
```

`pnpm test:browser` is for changes that can affect hydration; Chromium and Firefox must pass, and
WebKit skips where it cannot launch. A timing test may time out under heavy load; rerun it alone
before treating it as a failure. CI runs Node 22.23.4, 22, 24 and 26, stable Rust and the MSRV, and
its **CI passed** job fails when any other job does. A pull request runs the jobs its changed paths
reach, on Node 22.23.4 and 26 (the `changes` job in `ci.yml` decides); a push to `main` runs the
jobs the merged change reaches on every Node and OS; the release branch, a tag, the weekly run and a
manual run run everything. A change to `ci.yml` or `.github/actions/` runs every job. The account
runs 20 jobs at once, 5 of them on macOS, so small checks share a job as named steps: **Checks**
(lint, cargo-deny, `pnpm audit`, zizmor), **Examples and package** and **Performance budgets**, each
step skipped when the changed paths do not reach it. The Mutants and Fuzz matrices cap their
`max-parallel` for the same reason, and Coverage runs weekly and by hand.

Mutation testing runs weekly in the Mutants workflow, outside the per-PR checks: `cargo mutants` on
the runtime and `pnpm mutants:ts` (Stryker) on the compiler modules `stryker.config.json` lists.
After changing one of those modules, run `pnpm exec stryker run -m <file>` and
`node scripts/stryker-survivors.ts`, and close each new survivor with a test or an entry in
`stryker-equivalent.txt` with its reason, and each new timeout with a test or an entry in
`stryker-timeout.txt`.

## Git and pull requests

- `main` is protected: every change goes on its own branch and pull request, one change per pull
  request, filled in from `.github/pull_request_template.md`.
- Commits and tags are signed. If signing fails, wait and retry; never disable it.
- Commit messages are short and say what changed, with detail in the body when the why is not
  obvious.
- No attribution in commits or pull requests: no `Co-Authored-By`, session links or "Generated
  with" lines. Strip them from a branch before it merges.
- Write the PR body to a file and pass `--body-file`.
- A pull request merges once CI is green and a maintainer approves it, as a merge commit:
  `gh pr merge <n> --merge --body-file <file>`, so that no trailer reaches `main`.
- Force-push a PR branch with `--force-with-lease`; never force-push `main`.
- When GitHub cannot acquire a runner, rerun the job. A flaky test is fixed in a pull request.

## Releasing

`node scripts/release.ts bump X.Y.Z --pr` opens the `release/vX.Y.Z` pull request. After it merges,
a signed annotated tag on the merge commit (`git tag -a vX.Y.Z -m "ferrovue X.Y.Z"`) starts
`release.yml`. Every job on the tagged commit must pass: when one fails, delete the tag, fix the
cause in a pull request, and tag the new merge commit. Approving the `release` environment and
`npm stage approve` (npm's own command, with 2FA) are done by a maintainer.
