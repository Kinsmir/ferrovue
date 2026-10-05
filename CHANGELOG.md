# Changelog

All notable changes to this project are documented here. The crates and the npm package are
released together and share version numbers.

## [Unreleased]

## [0.4.0] - 2026-10-05

### Changed

- **Breaking:** `import … from "ferrovue"` is the browser API (`mountIslands`, `hydrateState`, `TrustedHtml`, `Float`); the compiler's API (`generate`, `write`, the configuration types) moved to `ferrovue/compiler`. `ferrovue/client`, `ferrovue/types`, `ferrovue/islands`, `ferrovue/vite`, `ferrovue/testing` and the CLI are unchanged. The package is marked `"sideEffects": false`, its root bundles to about 2.4 kB instead of 1.2 MB, and a build no longer leaves files from earlier builds in `dist/`.
- A release starts only from a signed, annotated tag whose signature GitHub verifies; any other tag
  stops the release workflow before anything is staged or published (`RELEASING.md`, "Signed tags").
- The crate's `lib.rs` is split into modules, one per part of the runtime: escaping, numbers,
  `Html`, slots and holes, `class`, the state script, `v-html`. Every public path is the same
  (`ferrovue::escape_into`, `ferrovue::Html`, …), and so is everything generated code writes.
- The runtime is four crates, released together at one version. vue-router's matching is
  `ferrovue-router` and vue-i18n's `t()` is `ferrovue-i18n`; the escaping and the JavaScript number
  writing all of them use is `ferrovue-core`. `ferrovue` depends on them at exactly its own version
  and re-exports them where they were (`ferrovue::Router`, `ferrovue::I18n`, `ferrovue::i18n::…`,
  `ferrovue::push_int`, …), so generated code and code using the crate do not change.
- New default features of `ferrovue`, `router` and `i18n`, which bring in `ferrovue-router` and
  `ferrovue-i18n`. An application with neither routes nor translations can set
  `default-features = false` and build neither crate.
- The compiler is restructured, with no change to anything it generates or refuses: vue-router,
  Pinia stores, vue-i18n and scoped styles are compiler plugins behind an internal interface
  (`src/plugin.ts` and `src/plugins/`, described in CONTRIBUTING.md), so the core names none of
  them, and `expr.ts`, `template.ts` and `attrs.ts` are split into modules of under 500 lines.

### Fixed

- A prop named after a Rust keyword compiles: `Props::new` and the setters take `r#loop`, `r#type` and
  the like, and `self`, `Self`, `super` and `crate`, which Rust cannot write as raw identifiers,
  become `self_`, `Self_`, `super_` and `crate_` in Rust while keeping their name in the props' JSON (#19).
- `ferrovue/testing` loads in a project that installs only `vue`: `fixtureApp` imports the optional
  peers when a fixture needs them, `vue-router` for routes, `pinia` for `$stores` and `vue-i18n` for
  the `i18n` option, and a fixture needing one that is not installed fails with an error naming the
  package to install. With the peers installed it renders as before (#22).
- Generated `Props`, and the structs of shared types, whose fields are all optional or that have
  none derive `Default` beside their argument-free `new()`, so a crate that includes them passes
  `cargo clippy -- -D warnings` (`clippy::new_without_default`). The conformance suite's generated
  modules are a public module of its test crate, so CI's clippy holds them to the lints a crate
  that exports them meets (#21).
- A setup binding whose value is a string literal, such as `ref("")`, and a `computed` of one are
  folded into the render as constants, and `v-model` on a `<select>` or radio input compares a
  string with an empty `value` by whether it is empty, so the generated code no longer trips
  `clippy::const_is_empty` and `clippy::comparison_to_empty` (#21).
- Generated Rust that did not compile, found by the randomised differential tester: an attribute
  passed to a child component whose value is a string built in a branch of `?:` or `&&`
  (`:class="on ? 'a' : String(n)"`) now owns that string instead of borrowing a temporary, and an
  arrow function's string item in a branch of `?:` (`find((w) => (on ? w : x))`) is borrowed
  instead of taken as a `String` it is not.

## [0.3.0] - 2026-10-05

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
- `Debug` for every public type in the crate, which now warns on one without it:
  `Router` (its base and each route's full path and name), `Route` (the full path, the route's name
  and its parameters), `Html` (the island's name and the props), `Slot` (`Slot { .. }`) and `Js`.
  `Link` derives `Debug`, `Clone`, `PartialEq` and `Eq`.
- `ferrovue/islands`, written by the Vite plugin: every component that has an `island()`, by the name
  `data-island` carries, each a lazy `import()`, so `mountIslands(islands)` needs no list of
  components and a page fetches the code of its own islands alone. `mountIslands` takes loaders
  (`() => import("./Counter.vue")`) beside components, loads each component a page names once, and
  reports an island whose component did not load. `write` returns the islands it found.
- The full-stack example hydrates from `ferrovue/islands`, and its server links the stylesheets of the
  lazily loaded islands up front.
- Fallthrough attributes: what a parent passes a child beyond its props falls through as in Vue —
  onto the child's single root, merged with its own class and style and replacing its other
  attributes where they stand (`undefined` included), none for two roots, on through a root that is
  a component or a `<RouterLink>`, and with `inheritAttrs: false` onto the elements and components
  that bind `v-bind="$attrs"` or a `useAttrs()` binding, before or after their own. Listeners are
  dropped, as Vue's server drops them. A component some parent passes attributes to takes them with
  its scope ids as one `ferrovue::Attrs` in its `render_scoped`; with none passed, its root is
  written as before, and a component no parent passes attributes to is unchanged. The crate gains
  `Attr`, `Attrs`, `attrs_into`, `merge_props`, `class_names` and `style_text_into`, held to vectors
  recorded from Vue's `mergeProps` and `ssrRenderAttrs`. A parent's `kebab-case` attribute sets the
  child's `camelCase` prop, as Vue matches them. Refused: a value read from `$attrs`, an attribute
  that would reach a prop of the component a root passes it on to, `$attrs` in a component whose
  `$attrs` would hold scope ids, an attribute named by a number, and attributes passed to a root
  `<Transition>` or `<KeepAlive>` around a `v-if`, which Vue's server drops but its client keeps.
- The fuzzer passes attributes to its child components, among them roots with attributes of their
  own, `inheritAttrs: false` with `$attrs`, and `useAttrs()`.
- Dioxus 0.7: the crate's `dioxus` feature (`dioxus-core` alone, no default features) makes `Html`
  an `IntoDynNode`, so `{greeting::island(&props)}` goes straight into `rsx!`, with
  `Html::to_element` for the same as an `Element`. An island is its own `<div data-island
  data-props>`, its markup inside as `dangerous_inner_html`, so `dioxus-ssr` and a fullstack render
  write exactly ferrovue's markup inside it, with no hydration marker; `ferrovue::dioxus::state_script`
  is `state_script_into` as an element. A guide page (`guide::dioxus`), and `examples/dioxus`.

### Changed

- **Breaking:** an attribute bound to a value that may be an array or an object, including a
  `route.query` value, is now refused at compile time (see Fixed); narrow a query value with
  `typeof … === "string"` or join a list with `.join(",")`.
- `ferrovue::Js` derives `Clone` and `Copy` (and `Debug`); `cargo-semver-checks` counts a new `Copy`
  as a breaking change.
- The release workflow prints the command that approves the staged npm package, with its id when
  npm reports one, as a notice at the top of the run and in the summaries of the npm and GitHub
  release jobs, so a finished run says plainly that one step is left.

### Fixed

- An attribute bound to a value that may be neither a string, a number nor a boolean is refused,
  with an error at the binding: a `route.query` value (an array when its key is repeated), and a
  list or an object, which were refused without a location. Vue's server renderer leaves such an
  attribute out and its client then sets it to the value's `String()` without reporting a mismatch,
  so ferrovue's matching render was rewritten on hydration (`:data-q="route.query.q"` on
  `?q=a&q=b`, found by the real-browser hydration test). `class` and `style` are unaffected.
- A `Float` that is `NaN` or infinite reaches the client as itself: an island's `data-props` and the
  state script write it as JavaScript does (`NaN`, `Infinity`, `-Infinity`) instead of the `null`
  `serde_json` writes, and `mountIslands` and `hydrateState` read the tokens back, so the client
  renders what the server did instead of hydrating with a mismatch nobody reported. Props and state
  without them are written and read as before. A client older than the crate refuses the tokens and
  leaves the island as the server rendered it, with a report.
- A root bound to `:class` of an optional string that is absent no longer writes `class=""`, and a
  root bound to `:style` of a string writes it parsed and normalised (`color:red;`), as Vue's
  `mergeProps` leaves them.
- A string built from one a runtime routine borrows, as the left side of `||`, compiles:
  `text.slice(1).toLowerCase() || "-"`, `((words.find(…) ?? "x") + "a") || "-"`.
- Slot content that writes nothing visible shows the slot's fallback exactly when Vue's does. Vue's
  `ssrRenderSlot` reads content as empty when every string it pushed is comments with only
  whitespace between them; ferrovue decided that from the template alone, so an interpolation pushed
  with fragment markers (`{{ note }}<p v-for="…">`, `<template v-if>{{ a }}{{ b }}</template>`)
  counted as content even when its values wrote nothing, or whitespace, and the slot showed nothing
  instead of its fallback. Such a push is now checked as it is written, by Vue's rule (held to
  vectors recorded from `ssrRenderSlot`), and slot content that ends a list or fragment with an interpolation
  (`<p v-for="…"></p>{{ note }}`), which was refused, compiles. Found by the randomised differential
  tester, which now writes slot content of this kind more often; kept as the `Hollow` conformance
  component.

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
