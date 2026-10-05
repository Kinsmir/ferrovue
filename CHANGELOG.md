# Changelog

All notable changes to this project are documented here. The crate and the npm package are
released together and share version numbers.

## [Unreleased]

### Added

- `ferrovue init`: scaffold a starter `ferrovue.config.json` and `components/Hello.vue`.
- `--config <path>` (`-c`): read configuration from another file.
- `ferrovue --check --diff` (`-d`): print a unified diff of stale or ungenerated modules.
- `--version` (`-v`) and `--help` (`-h`).
- Informative error when `ferrovue.config.json` is missing or invalid, without a stack trace.
- `VERSION` constant exported from `ferrovue`.
- `typeof route.query.q === "string"` (or `!==`), which narrows a query value to a single string in
  `v-if`, `&&` and `? :`, as TypeScript does.
- Web framework responses in the crate, each behind a feature: with `axum`, `Html` (what `html()`
  and `island()` return) is an `IntoResponse`, and with `actix-web` a `Responder` and, by `From`, an
  `HttpResponse`: `200 OK`, `text/html; charset=utf-8`. `ferrovue::HtmlStream` (the `stream`
  feature, which both include) sends a page rendered with holes as a streamed body, each hole's
  content from a future, the futures running at once and their output written in order; a page
  without holes is sent whole. A guide page, `ferrovue::guide::web_frameworks`.
  `examples/fullstack` responds with `HtmlStream` instead of building its stream by hand.
- Pages that hold their props: beside `html(&props)` and `island(&props)`, a component that has an
  `island()` gets `into_html(props)` and `into_island(props)`, taking the props by value. The
  `Html` they return borrows only what the props borrow, so a handler that builds the props returns
  the page (`-> impl IntoResponse { greeting::into_html(Props::new(name)) }`) instead of ending
  with `.into_response()`. `examples/fullstack` serves a book's reviews alone this way, at
  `/books/{id}/reviews`.

### Fixed

- An attribute bound to a value that may be neither a string, a number nor a boolean is refused,
  with an error at the binding: a `route.query` value (an array when its key is repeated), and a
  list or an object, which were refused without a location. Vue's server renderer leaves such an
  attribute out and its client then sets it to the value's `String()` without reporting a mismatch,
  so ferrovue's matching render was rewritten on hydration (`:data-q="route.query.q"` on
  `?q=a&q=b`, found by the real-browser hydration test). `class` and `style` are unaffected.

## [0.2.0] - 2026-10-04

### Added

- `<style scoped>`: the `data-v-` id on every element, on a child component's root (the creating
  component's id, what a parent passes on to a component that is its root, and the slot scope ids it
  renders inside) and on slot content given a `:slotted()` component's `-s` id, as Vue's server
  renderer writes them, fragments, recursion, `inheritAttrs: false`, `<Transition>`, `<KeepAlive>`,
  `<Teleport>` and `<RouterLink>` included. The id is computed as `@vitejs/plugin-vue` computes it: `scopeId`
  (`"filepath-source"`, the plugin's production default, or `"filepath"`) and `viteRoot` in
  `ferrovue.config.json`. A component that may inherit ids gets a `render_scoped` beside `render`;
  `ferrovue::scope_attrs`, `Slot::slotted`, `slot_into_slotted` and `scoped_slot_into_slotted` in
  the crate. `<RouterView>` in a scoped component is refused, as are a `<slot>` in a `<RouterLink>`
  that takes ids and an element in one inside `:slotted()` slot content. The Vite
  plugin fails a build in which plugin-vue computes the ids otherwise, and warns the dev server.
- `attachSsrRender` compiles a `<style scoped>` component with the `__scopeId` plugin-vue gave it,
  and `fixtureApp` takes `client: true` to render on the client instead of hydrating.
- A release workflow: a tag stages the npm package and, after approval, publishes the crate, through
  both registries' trusted publishing; `scripts/release.ts` bumps versions and checks tags
  (`RELEASING.md`).
- `ferrovue::push_number` and `ferrovue::Js`: numbers written as JavaScript's `Number.prototype.toString`
  writes them, held to 343 vectors recorded from JavaScript.
- `ferrovue::class_object`.
- Errors point into the `.vue` file: `components/Card.vue:12:18: …`, with the line quoted and a caret
  under the construct, mapped through the template's source map.
- `mountIslands` in `ferrovue/client`: hydrates every island on the page from its own props, sharing
  one Pinia and one router, and reports islands it cannot hydrate.
- `ferrovue --watch`, and a Vite plugin (`ferrovue/vite`) that regenerates on change and shows a
  refused construct in the error overlay.
- Generated props and types have `new(required…)` and a setter per optional field, taking strings and
  lists of strings as they come.
- Examples in the crate's API documentation.
- Fractional numbers: a `Float` prop (from `ferrovue/types`) is an `f64`; fractional literals, `/`,
  `%` by any divisor, `Math.round`/`floor`/`ceil`/`trunc`/`max`/`min`/`abs` and `.toFixed()` work as
  in JavaScript, written with `ferrovue::push_number`. `js_round`, `js_max`, `js_min` and
  `js_to_fixed` in the crate, held to 694 vectors recorded from JavaScript.
- `route.query` and `route.fullPath`, parsed as vue-router parses them: a repeated key is an array,
  written as `JSON.stringify` writes it, and `?flag` is `null`. `Route::query`, `Route::full_path` and
  `ferrovue::Query` in the crate.
- vue-i18n: `$t` and `useI18n()` (`t`, `locale`), with named and list values, plurals, literals,
  linked messages and modifiers, nested and flat keys, and fallback locales. Messages are parsed by
  vue-i18n's own message compiler into a generated `i18n` module; `ferrovue::i18n` evaluates them.
- Nested routes: `children` in the routes file, matched in vue-router's order, with
  `router-link-active` and `router-link-exact-active` (and `aria-current`) decided separately, as
  `useLink` decides them. `Router::tree`, `RouteDef` and `Link::exact` in the crate; the generated
  `route_table::ROUTES` is now a tree of `RouteDef`s.
- `<Teleport>`: markers in place and the content in the target's buffer, nested and disabled
  teleports as Vue renders them; `ferrovue::Teleports` collects them for the page to place.
- Pinia setup stores: the returned refs are the state (typed by `ref<T>()` or their initial literal),
  the returned computeds getters that may read each other, the functions actions.
- Narrowing as TypeScript narrows: `x !== undefined` as well as `x`, and `!x` or `x === undefined`
  for the `v-else`; in `?:`, `&&` and `||` as well as `v-if`. A value that is always present
  compares unequal to `undefined`; `??` and `?:` between an integer and a `Float` give a `Float`.
- Testing: every conformance fixture is hydrated in real browsers — Chromium, Firefox and WebKit,
  through Playwright — as well as in happy-dom, failing on a mismatch Vue reports and on any change
  hydrating makes to the document as the browser parsed it; the full-stack example's server is run
  and its pages hydrated and clicked through in each browser too (`pnpm test:browser`, and a CI
  job). The fixture app `ferrovue/testing` builds now comes from a module with no Node imports
  (`fixture.ts`), so a browser bundle can use it. The example's server reads its client build from
  `DIST_DIR` when set.
- `deny.toml` and a `cargo deny` CI job: every crate the workspace builds is under a licence
  compatible with MIT OR Apache-2.0 and comes from crates.io; RustSec advisories fail a release.
- The release workflow checks the crate's public API against the last version on crates.io
  (`cargo-semver-checks`): before 1.0, breaking changes need a new minor version (`RELEASING.md`).
- `pnpm coverage` (vitest's V8 coverage of the compiler, `cargo llvm-cov` of the workspace) and a
  Coverage workflow that summarises both on the run's page and uploads the reports.
- Mutation testing of the runtime crate with cargo-mutants (`.cargo/mutants.toml`, TESTING.md):
  every mutant the tests miss is either closed by a test or listed with the reason it cannot change
  the output (`.cargo/mutants-equivalent.txt`). A weekly Mutants workflow fails on any other.
- String methods counted in UTF-16 code units, as JavaScript counts them: `.slice()`, `.substring()`,
  `.at()`, `.charAt()`, `.indexOf()`, `.lastIndexOf()`, `.split()`, `.replace()` and `.replaceAll()`
  with string patterns (and JavaScript's `$` replacement patterns), `.padStart()`, `.padEnd()`,
  `.repeat()`. Half of a surrogate pair is written as U+FFFD, the character a server sends for it;
  two strings that may each hold one are never compared, searched or joined (README, "Strings").
  `js_slice`, `js_substring`, `js_at`, `js_char_at`, `js_index_of`, `js_last_index_of`, `js_split`,
  `js_replace`, `js_replace_all`, `js_pad_start`, `js_pad_end`, `js_repeat`, `js_slice_range` and
  `js_slice_items` in the crate, held to 4,600 vectors recorded from JavaScript.
- `<`, `>`, `<=` and `>=` between strings, by UTF-16 code unit: `ferrovue::js_cmp`, held to 400
  vectors.
- Array methods with arrow functions: `.filter()`, `.map()`, `.some()`, `.every()`, `.find()`,
  `.findIndex()`, and `.slice()`, chained and nested, with an index or a destructured item; the lists
  they make work in `v-for`, `.join()`, `.length`, `.includes()`, `computed` and a child's props.
- `Record<string, T>` and `{ [key: string]: T }` props as `ferrovue::Record`, which keeps
  JavaScript's order of keys (array indices first, in numeric order; a key given twice keeps its
  first place and its last value); `v-for="(value, key, index) in r"`, `Object.keys`,
  `Object.values`, and `Object.entries` in `v-for`.
- `Number()`, `parseInt()` (no radix, 10 or 16), `parseFloat()` and `JSON.stringify()` of strings,
  numbers, booleans and lists of those: `js_number`, `js_parse_int`, `js_parse_float`,
  `js_json_string` and `js_json_number` in the crate, held to vectors.
- The differential fuzzer generates all of the above, dictionaries with keys out of JavaScript's
  order, and compares Vue's HTML as a server sends it.

### Documentation

- The crate's documentation stands on its own on docs.rs: a crate-level overview with the guarantee,
  an end-to-end quick start, feature flags and version requirements (`docs/crate.md`), and a guide,
  `ferrovue::guide`, with a page each on the generated code, props, slots, routing, i18n, teleports,
  Pinia, islands and hydration, streaming, JavaScript numbers, escaping, and what is refused. Its
  examples mirror the code the compiler generates and run as doctests; the guide is compiled only
  by rustdoc.
- The public items have runnable examples, and those that generated code calls say so.
- docs.rs builds with `--cfg docsrs`, which marks `maud`-only items; the manifest links the docs.
- The guide covers the rest of this release: a page on `<style scoped>` (the ids, matching
  `@vitejs/plugin-vue` with `scopeId` and `viteRoot`, `render_scoped`, `:slotted()` and slot scope
  ids), a page on strings (UTF-16 indices, halves of surrogate pairs, ordering, `Number`,
  `parseInt`, `parseFloat`, `JSON.stringify`, slicing lists), dictionaries and `Record` in the
  props page, vue-i18n's plural choice from a fraction, and `Math.round`'s `-0`. Its copies of
  generated code are what the compiler writes now, and the new runtime functions have runnable
  examples.

### Changed

- The compiler is split into modules, its state gathered into one context; generated output is
  unchanged.
- `ferrovue` writes only the files whose text changed, and removes those no component produces, so a
  Rust build rebuilds no more than it must. `write()` returns what it changed.
- The CLI prints a refused construct as an error message, without a stack trace.
- Generated code no longer computes setup values nothing reads, nor binds loop items, narrowed values
  or slot props nothing reads; it compiles without `allow(unused_variables)`.
- Generated code passes rustc's default warnings and `cargo clippy -- -D warnings` with one allow
  left, `dead_code`, as each component gets an API an app uses only part of (and a constructor of
  more than seven required props allows `clippy::too_many_arguments`). It is parenthesised only
  where Rust needs it, folds what is known at build time (literal arithmetic, constant conditions,
  string literals), borrows and dereferences only where coercion does not, and pushes a single
  character as a `char`. Output is unchanged.
- Faster rendering of numbers and short strings, which made the `list` benchmark 2.5× faster
  (115 µs to 46 µs; `tree` 5.2 to 3.7 µs, `page` 5.0 to 4.4 µs). `push_int` and `Js` write integers
  digit pairs at a time instead of through `fmt` and a `String`; `push_number` writes a whole
  number that way, and looks for a tie between two shortest spellings only in a number short enough
  to have one, from its exact digits in a `u128`, instead of formatting 1,100 digits of every number
  (about 20× faster); `escape_into` checks for characters to escape eight bytes at a time. Generated
  `render`s reserve room for the numbers they write and for loops nested in a loop over the props,
  so a long page no longer outgrows its buffer and is copied. Held to the old `push_number` and a
  bytewise escape by property tests, and to 18 new JavaScript vectors.

### Fixed

- A child component given no props at all (`<Child />`) is rendered, where it was refused with an
  error about `null`.
- Found by the randomised differential tester, and kept as conformance fixtures:
  - an integer literal beyond 2⁵³ (`1e21`) is a double, where it generated Rust that did not compile;
  - `?:` and `||` choosing between a string the component holds and one it builds, or a trim of
    one it builds (`(1).toFixed(2).trim()`), compile;
  - `label ?? (1).toFixed(1)`, an optional string falling back to one built in place, compiles
    inside `||` and `?:`;
  - a class object whose names repeat, or are array indices (`"0"`, `"12"`), renders as a
    JavaScript object lists them: one entry per name, array indices first in numeric order;
  - integer arithmetic keeps JavaScript's `-0`, so dividing by it is `-Infinity`;
  - a number exactly halfway between two shortest spellings is written with the even digit, as
    ECMAScript specifies (`-1801439850948198.2`);
  - `||` after an optional string whose `??` fallback is built (`` (s ?? "a") || (s ?? `${n}x`) ``)
    compiles.

- Integers beyond ±2⁵³ are written, added and compared as JavaScript does with the rounded value the
  browser reads, so such a prop no longer causes a hydration mismatch.
- A class object with computed names keeps the spaces inside a name, as Vue does.
- An empty route parameter fails a debug build's render, as vue-router fails it; a release build
  still writes the link.
- vue-i18n: a fractional `count` or `n` chooses the plural case as vue-i18n does (`1.5` is
  plural, not singular), and one that is not a finite number (`NaN`, `Infinity`) is passed over
  for the plural number; a fraction that chooses no case fails a debug build's render, as vue-i18n
  throws. Found by mutation testing; the conformance component `Plurals` holds it to vue-i18n.
- `Math.round` of a number from `-0.5` up to zero is `-0`, as in JavaScript, which `1 / Math.round(x)`
  shows (`-Infinity`). The math vectors now record the sign of a zero result, and hold
  `Math.max` and `Math.min` to it as well.

## [0.1.0] - 2026-10-04

### Added

- First standalone release of the compiler (`ferrovue` on npm) and the runtime (`ferrovue` on
  crates.io).
- `ferrovue::js_length`: a string's length in UTF-16 code units, as a template's `.length` counts it.
- The compiler accepts `:hidden` bound to any value (Vue compiles it to `ssrRenderDynamicAttr`).
- The npm package ships compiled JavaScript and type declarations (`dist/`), so the `ferrovue`
  command runs from `node_modules`.

- Script setup: lifecycle hooks, `watch`, `defineEmits`/`defineSlots`/`defineOptions`/`defineExpose`,
  template refs and plain constants; `.value` on refs in script code; a plain `<script>` block.
- Props: `withDefaults`, destructured props with defaults, optional booleans, `defineModel`,
  components without props, string-literal unions, `T | undefined`, `Array<T>`, type aliases.
- Shared types imported from `.ts` files, store files and other components (`types.rs`), and objects
  passed to child components.
- Expressions: `-`, `*`, `%`, comparisons, unary `-`, template literals, optional chaining, string
  and list methods, `Math`, `String()`, array literals; `v-for` over ranges and destructured items.
- `class` objects and conditionals; `:style` and `v-show`; `mergeProps` with any number of objects;
  global `<style>` blocks.
- Pinia getters; type imports from store files.
- Vue Router: named routes, object `to` with `params`, `query` and `hash`, `active-class`,
  `exact-active-class`, `aria-current-value`, `replace`, a history base and global link classes;
  `useRoute()` / `$route` (`path`, `hash`, `name`, `params`); `RouterLink` imported from
  `vue-router`. `Router::named`, `Router::with_base`, `Route::{param, name, hash, link_named,
  link_path}` and `query_into` in the crate; `route_table::router()` in generated code.
- `<Suspense>`, custom directives declared in `clientDirectives`; `v-model` and listeners on child
  components; clear errors for `<Teleport>`, `<component :is>`, scoped and module styles.
- Scoped slots: a `…SlotProps` struct and `…Slot` content type per scoped slot, `scoped_slot_into`
  in the crate; destructured or whole slot props in a parent; children generated before parents.
- `ferrovue::js_trim_start` and `js_trim_end`; `scripts/inspect.ts` for investigating a construct.

### Fixed

- `.length` of a string counted UTF-8 bytes, so a non-ASCII string rendered a different number
  than Vue.
- Slot content made only of comments (a `v-if` not taken, for example) was kept when the slot had
  no fallback. Vue drops it, so the bytes differed.
