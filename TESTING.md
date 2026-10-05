# Testing ferrovue

ferrovue promises one thing: for every input it accepts, the Rust it generates writes the same
bytes Vue's server renderer writes, and it refuses every input it can't translate. The suite is
built around that promise. Wherever it can, it takes the expected answer from the real Vue,
vue-router or JavaScript.

```sh
pnpm test                  # TypeScript: compiler, CLI, vectors, router, Vue half of conformance
cargo test --all-features  # Rust: runtime units, properties, Rust half of conformance
pnpm typecheck
pnpm conformance:check     # the committed generated Rust is what the compiler writes now
pnpm test:browser          # the same fixtures, and the full-stack example, hydrated in real browsers
```

## The layers

| Layer | Where | What it proves | Source of truth |
|---|---|---|---|
| **Conformance** | `crates/ferrovue/tests/conformance/` | Each component × fixture renders identically in Vue and in the generated Rust, and Vue hydrates the HTML with no mismatch | `@vue/server-renderer`, Vue's hydration |
| **Browser hydration** | `packages/ferrovue/browser/`, `examples/fullstack/browser/` | Every fixture's recorded HTML, parsed by Chromium, Firefox and WebKit, hydrates with no mismatch and is left as parsed; the full-stack example's pages do too, and their islands work | Vue's hydration, the browsers' HTML parsers |
| **Shared vectors** | `crates/*/tests/vectors/`: `ferrovue-core` (escaping, numbers), `ferrovue-router`, `ferrovue` (the rest) | The runtime's reimplementations of `trim`, `.length`, `escapeHtml`, `String(number)`, `Math`, `toFixed`, `normalizeClass` of an object, `ssrRenderSlot`'s test of slot content that is only comments, the string methods (`slice`, `at`, `split`, `replace`, `padStart`, … on astral characters, halves of pairs, negative and `NaN` indices), string ordering, `Number` / `parseInt` / `parseFloat`, `JSON.stringify` of strings, an object's order of keys, `mergeProps` and `ssrRenderAttrs` of attributes, unhead's server head (`head.json`: tag order, deduplication, title templates and escaping, over hand-written heads and heads drawn at random with markup-breaking values), and vue-router's link resolution (string and object `to`, named routes, optional parameters, routes that only group others, query and hash encoding, history base) and `useRoute()` fields agree with the originals; and the routes ferrovue builds from a folder of pages (`packages/ferrovue/test/file-routes.json`) are the ones vue-router's file-based routing builds | JavaScript, `@vue/shared`, `@vue/server-renderer`, `@unhead/vue`, vue-router, `vue-router/unplugin` |
| **Compiler** | `packages/ferrovue/test/compiler.test.ts`, `provide.test.ts`, `file-routes.test.ts` | Constructs that a careless translation would get subtly wrong are refused with a named error; key translations have the expected shape | Hand-written |
| **Browser API and testing utilities** | `packages/ferrovue/test/islands.test.ts`, `lazy-islands.test.ts`, `conformance-suite.test.ts`, `link-router.test.ts` | `mountIslands` mounts and hydrates islands, at once or when their trigger fires, replaying the events that woke them; `conformanceSuite` passes a project that matches Vue and fails, saying where, on each way one can differ; `linkRouter` hands navigation to the application | Vue's hydration, hand-written |
| **CLI** | `packages/ferrovue/test/cli.test.ts` | `ferrovue` writes, replaces, and `--check` detects stale and stray files | Hand-written |
| **Runtime units** | `crates/*/src/<module>/tests.rs` beside each module, `crates/ferrovue-router/src/tests.rs`, `crates/ferrovue/src/web.rs` | Escaping, slots, fallbacks, holes, islands, the state script, router edge cases; a streamed page's order and the axum and actix-web responses | Hand-written |
| **Properties** | `crates/ferrovue/tests/properties.rs`, `crates/ferrovue-router/tests/properties.rs`, `crates/ferrovue-core/src/*/tests.rs` | Invariants over generated inputs: escaped text has no markup and reads back whole; the state script can't be closed; router never panics; numbers and escaping are written as slower references write them | `proptest` |
| **Differential fuzzing** | `packages/ferrovue/fuzz/` | Random components and props, within the grammar ferrovue accepts, render identically in Vue and in the generated Rust; each difference is shrunk to a small case (`pnpm fuzz`, nightly in CI, not part of `pnpm test`) | `@vue/server-renderer` |
| **Vue canary** | `.github/workflows/canary.yml` | The newest Vue 3.5, vue-router, Pinia, vue-i18n and `@unhead/vue` patches the peer ranges allow record the same fixtures and vectors as are committed, and hydrate the committed HTML (weekly in CI; an issue is opened on a difference) | `@vue/server-renderer`, Vue's hydration |
| **Mutation testing** | `.cargo/mutants.toml` | The tests above notice a small change to the runtime's source; every change they miss is listed, with the reason, as one that cannot alter the output (`cargo mutants`, weekly in CI) | cargo-mutants |
| **Example** | `examples/greeting/` | Generated code compiles in an ordinary (non-test) consumer crate | `cargo build` |
| **Struct literals** | `crates/ferrovue/tests/literal_props/`, `literal_props.rs` | Code generated with `"builders": false` compiles, and renders from props built as struct literals; `compiler.test.ts` checks the committed Rust is current | Hand-written |
| **Sanitiser** | `crates/ferrovue/src/sanitised/tests.rs`, `crates/ferrovue/tests/sanitised/`, `sanitised.rs` (`--features ammonia`) | `ferrovue::Sanitised` removes scripts, event handlers and `javascript:` URLs; a component compiled with `"trustedHtml": "ferrovue::Sanitised"` writes the sanitised string unchanged through `v-html` and carries the same string in `data-props`; `compiler.test.ts` checks the committed Rust is current | ammonia, hand-written |
| **Basic HTML** | `crates/ferrovue/src/basic_html/tests.rs`, `properties.rs`, `sanitised.rs` (`--features ammonia`) | `ferrovue::BasicHtml` writes as tags only its ten, written exactly, balanced and placed where a browser keeps them; hostile input (attributes, `<scr<b>ipt>`, references, case, NUL, misnesting, long input) stays text; building again gives the same HTML; html5ever, through ammonia, parses every output back to the same tags and text | `proptest`, html5ever |
| **Dioxus** | `crates/ferrovue/tests/conformance.rs` (`--features dioxus`), `examples/dioxus/` | Every island fixture, rendered into a Dioxus page by `dioxus-ssr` (plainly and with fullstack hydration ids), holds exactly the HTML Vue recorded, with no marker inside it, and carries the same props; an island inside an element's `dangerous_inner_html` is every byte of `island()`; an `rsx!` page holds the example's island | `@vue/server-renderer`, `dioxus-ssr` |
| **Full-stack example** | `examples/fullstack/` | An axum server's pages, streamed through holes, hydrate in the client built from the same components with no mismatch, their islands share the store, and their elements carry the scope ids the client build's stylesheet selects | Vue's hydration (`pnpm --filter ferrovue-example-fullstack test`) |

### Conformance in detail

```text
components/X.vue ──Vue SSR──▶ fixtures/X/case.html ◀──byte-equal──  generated/x.rs (Rust)
        ▲                            │
fixtures/X/case.json            Vue hydrates it: no mismatch warnings, same DOM node kept
```

1. `conformance.test.ts` renders each `fixtures/<Component>/<case>.json` with real Vue and compares
   the result with `<case>.html`.
2. It mounts the recorded HTML, hydrates it and waits for async components to load and hydrate
   (`src/settle.ts`). Any hydration warning fails the fixture, except in the fixtures in
   `VUE_DISAGREES` (`conformance-cases.ts`), where Vue's own server and client renders
   differ and which must still mismatch: slot content whose every pushed string is comments and
   whitespace (an interpolation that writes nothing beside a list's fragment markers) shows the
   fallback on the server, while the client keeps the empty text; and a `<RouterView>` whose page
   renders nothing (`"routerView": ""`, `App/empty-view.json`): the server writes no node for it,
   and Vue's hydrator takes a component to begin at a node of the DOM, so it finds none where the
   page should be. No page the fixture could render in its place writes nothing and hydrates.
3. For a fixture with scope ids, which hydration does not compare, it renders the fixture afresh on
   the client and holds every element's `data-v-` ids to the recorded ones, except in the fixtures
   in `CLIENT_DIFFERS`, where Vue's own server and client disagree and which must still differ; and
   it checks that each scoped component's id is the one `@vitejs/plugin-vue` gave it. Each of these
   lists names fixtures that exist.
4. It checks that `generated/` is exactly what the compiler writes now.
5. `tests/conformance.rs` renders every fixture through the generated Rust and compares the result
   with the same `.html`.
6. `tests/conformance.rs` declares `generated/` as a public module, so `cargo clippy -- -D warnings`
   holds the generated code to the lints a crate that exports it meets, such as
   `new_without_default`, which clippy does not check on an item no other crate can reach.

A fixture whose components call `useHead` records the head unhead's server head renders after
its HTML, behind `<!--fv-head-->`, and the generated `render_json` writes `Head::render` the same
way. Hydrating it puts the recorded tags in the document's head and installs unhead's client
head, which must take them over unchanged, except in the fixtures in `UNHEAD_REWRITES`, where
unhead's own server writes a value in markup the HTML parser reads back as something else.

A fixture is a JSON object of props plus three optional keys:

- `$slots`: each slot's content as HTML (`routerView` is the page `<RouterView>` shows); content
  that is the empty string renders as an empty text node, which Vue hydrates against nothing
  (`Frame/empty-slots.json`)
- `$route`: the reader's location (`/` when absent)
- `$stores`: Pinia state by store id

### The components and what they cover

| Component | Covers |
|---|---|
| `Text` | Interpolation of every scalar, absent values, `.trim()`, `.length` (UTF-16), `+`, `??`, `\|\|`, `?:` |
| `Exprs` | `-`, `*`, `%`, comparisons, unary `-`, `Math`, template literals, `?.`, string and list methods (Unicode case mapping included), array literals, ranges, destructured `v-for` items |
| `Branches` | `v-if` / `v-else-if` / `v-else`, `!`, `&&` / `\|\|`, `===` / `!==`, `undefined`, narrowing, `<template v-if>` |
| `Lists` | `v-for` over strings, numbers and objects, index, nesting, `<template v-for>`, empty lists |
| `Attrs` | Boolean attributes, `:hidden`, empty values, numbers, absent optionals, `data-` / `aria-`, all class shapes |
| `Styles`, `Shown` | `:style` objects, arrays, strings and conditional objects merged with a static `style`; `v-show`, including on the root; a global `<style>` block |
| `Markup` | Entities, void elements, SVG attributes, `<pre>` whitespace, whitespace condensing |
| `Setup`, `Lifecycle` | `ref`, `computed`, plain constants, helpers; hooks, `watch`, emits, template refs, `defineOptions`/`defineSlots`/`defineExpose`, a plain `<script>` block |
| `Constants` | Setup bindings that start as a string literal, and `computed`s of them, written into the page and tested as constants; strings compared with the empty one in `===`, `v-if` and `v-model` on `<select>` and radio inputs |
| `Defaults`, `Destructured` | `withDefaults`, the boolean cast, destructured props with defaults and new names, class objects |
| `Model`, `ModelParent` | `defineModel` (named, required, default) and `v-model` on a component |
| `Form` | `v-model` on input, checkbox, select, radio and textarea |
| `Builtins` | `Transition`, `TransitionGroup`, `KeepAlive`, `Suspense`, `v-text`, `v-once`, `v-pre`, `v-memo`, a client-only directive |
| `Prose` | `v-html` of `TrustedHtml`, required and optional |
| `Tree` | A recursive, self-rendering component |
| `UserCard`, `UserList` | Types imported from a shared `.ts` file and from another component, string-literal unions, objects passed to children |
| `DataList`, `DataTable`, `RowChip` | Scoped slots in a loop with fallbacks, props destructured and taken whole, empty content giving way to the fallback, a slot's object handed to a child |
| `Frame`, `Forward`, `Page`, `Card` | Slots, fallbacks, comment-only content, slots forwarded through components |
| `Hollow`, `Blank` | Slot content that may write nothing visible, which shows the fallback exactly when every string it pushes is comments and whitespace: interpolations of absent, empty and whitespace values beside a list's fragment markers, `<template v-if>` and `<template v-for>` of interpolations, whitespace text, a component rendering only a comment, named and scoped slots, a slot forwarded through another component |
| `Panel`, `Dashboard` | Named slots, `$slots.x`, interpolating fallbacks, child props as literals, variables, lists and whole `Props` |
| `Nav`, `Links`, `Menu`, `App` | `<RouterLink>` active matching, relative links, named routes, `query`/`hash`, link class props, imported `RouterLink`, `<RouterView>` |
| `RouteInfo` | `useRoute()` and `$route`: path, hash, name, params |
| `Translated`, `Plurals` | vue-i18n's `$t` and `useI18n()`: named and list values, literals, linked messages and their modifiers, fallback locales; the plural case chosen by an integer, a fraction or a value that is not a finite number, and `count` and `n` given or taking the plural number |
| `Badge`, `Cart` | Pinia state through the store and `storeToRefs`, getters, two stores, store reads in `computed` |
| `ScopedPage` and its children | `<style scoped>`: the id on every element and what reaches each kind of child: `ScopedLeaf` (a root chosen by `v-if`), `ScopedRoot` (a root that is a component), `ScopedPair` (a fragment), `PlainBox` (no scoped styles), `ScopedCard` (`:slotted()`, a scoped slot, fallbacks), `PlainForward`, `ScopedShelf` and `ScopedRack` (slots forwarded into `:slotted()` ones, slot scope ids with two spaces), `ScopedFade` (a `<Transition>` root), and `<KeepAlive>`, `<Teleport>` |
| `ScopedTree` | A scoped component rendering itself, whose children's roots carry its id twice |
| `ScopedNav`, `ScopedLink` | `<RouterLink>` in scoped components: the `<a>` and what it holds, a link that is a scoped component's root, a link in `:slotted()` slot content |
| `ScopedQuirks`, `QuietLeaf` | Where Vue's server and client renders give different ids: a `:slotted()` component's fallback, `inheritAttrs: false` |
| `Fallthrough` and its children, `ScopedFallthrough` | Attributes a child does not declare as props: onto a root with a class, a style, `v-show` and attributes of its own (`FallLeaf`: classes joined, once when equal, styles merged, the rest replaced where they stand, `undefined` too), with `inheritAttrs: false` onto elements that bind `$attrs` before and after their own (`FallInner`), dropped by two roots (`FallPair`), on through a root that is a component (`FallRoot`), and unmerged through one given nothing to `$attrs` bound alone (`FallBare`), through `useAttrs()` to an element and a component (`FallUse`), onto a `<RouterLink>` root (`FallLink`), onto a root chosen by `v-if` (`FallSwitch`), through a `<Transition>` root (`FallFade`), onto a root whose own class may be absent and whose style is text (`FallBinds`); with a scoped parent's ids after them |
| `Strings` | String methods in UTF-16 code units (astral characters, `$` replacement patterns, padding, `split("")`), ordering by code unit, kept by `computed` |
| `Arrays`, `Chips` | `filter`, `map`, `some`, `every`, `find`, `findIndex`, `slice` with arrow functions, chained and nested, with an index and destructuring, in `v-for`, `computed`, `?:` and a child's props; `JSON.stringify` |
| `NumberIncludes` | `.includes()` across `number` and `Float`: a fraction in a list of integers, an integer in a list of fractions and in a list mapped to fractions, `-0` found as `0`, integers beyond 2⁵³ |
| `Records` | `Record<string, T>` and `{ [key: string]: T }` in JavaScript's order of keys (array indices first, a key given twice), `Object.keys` / `values` / `entries`, a record handed to a child |
| `Nullable`, `NullChild`, `Session` | `T \| null` props, interface fields, list items, slot props and Pinia state: `null` written and narrowed (`!== null`, `=== null`, `!= null`, `== null`, truthiness), `??`, `?.` over a nullable object and field, interpolations and attributes of `null`, `null` as a `?:` branch and a child's prop, `ref<T \| null>(null)` in setup |
| `ClientSide` | `<ClientOnly>` with a fallback, without one, and inside another component's slot, around a stand-in for a library component that reads `window` (`vendor/Gauge.ts`); in the browser, the content replaces the fallback once mounted |
| `Deferred` | `defineAsyncComponent`, as an arrow and with `loader`, given props, slot content and a scoped parent's id |
| `EscapedIdioms` | Set A's idioms through the escape hatches: a template-only component in a `<ClientOnly>` fallback, an async template-only component, `props.x` handed to a twin |
| `EscapedNull` | Nullable props through the escape hatches: into an async `NullChild`, a `<ClientOnly>` fallback, and a twin's optional prop by `?? undefined` |
| `Rated` | A Rust twin (`vendor.rs`) of a render-function component (`vendor/StarRating.ts`): props, a boolean cast from a bare attribute, attributes beyond its props, a slot written from virtual nodes |
| `Parsing` | `Number`, `parseInt` (no radix, 10, 16) and `parseFloat` of strings, `JSON.stringify` of numbers, `NaN` and `Infinity` |
| `PropsObject`, `Glyph`, `Divider` | The props object read in the template (`props.label`, with `withDefaults`); a child with no script and one with an empty `<script setup>`, which take no props, one given a class to fall through |
| `Pending` | Refs that start empty, typed by their type argument: `ref<Row[]>([])`, `ref<User[]>([])`, `ref<string[]>([])`, `ref<Row \| undefined>()`, `ref<string>()`, `ref<number \| undefined>(undefined)` |
| `Picker` | A generic component (`generic="T extends Choice, K extends string"`), rendered with each type parameter as its constraint |
| `Catalog` | Constants imported from `types/catalog.ts`, evaluated at build time: an object read by field and nested field, a list of strings, a list of numbers, lists of objects (one typed by an interface) in `types.rs`; enums imported and declared in the component, string and numeric, as a prop's type and read by member and by number |
| `ShapePicker`, `ShapeRoot`, `ShapeCircle`, `ShapeSquare` | `<component :is>` over components: a `computed`, an object declared in setup and one imported from `types/shapes.ts`, read by a literal-union prop, an imported component, a `?:` between a component and an element, inside `<KeepAlive>` and `<Transition>`, as a component's root given fallthrough attributes and slot content, with slots only some choices take and a `:slotted()` id on a chosen element |
| `ThemedChoice` | `<component :is>` with provide/inject: a chosen provider or injector given the parent's context, slot content injecting inside a chosen component, a chosen element and a slot inside one |
| `TagHeading`, `TagGallery`, `TagContent` | `<component :is>` over elements: an `as` prop with a default as a scoped component's root, a `computed` tag, void elements, a static `is`, inside `<Transition>` with `v-if`, `<slot>`s inside a chosen element whose parent content renders from virtual nodes (`<!--v-if-->`, fragments, forwarded), and what an element renders from virtual nodes: classes, styles, bare empty attributes, form controls, nested choices, lists of components, `<TransitionGroup>`, `<KeepAlive>`, comments |
| `SlotProbe` | `useSlots()`: a slot's presence tested in the template and in a `computed` |
| `TabsPage`, `Tabs`, `Tab`, `ThemedButton`, `ThemeScope` | `provide` and `inject` with `InjectionKey` symbols from `types/keys.ts` and string keys: a `Tabs`/`Tab` compound pair whose context is a `reactive()` object, a themed button with defaults, a factory default and a ref default, each rendered with and without a provider; a provider in a parent and a grandparent, a nearer one shadowing it, slot content seeing the providers of the component that renders it, a component injecting what it then provides anew, and a key holding a function |
| `Swatch`, `SwatchShelf` | `inject` with an object default under an interface key: given as it is and by a factory, its fields from props, an optional field left out, a string key typed by `inject<T>`, read in a `computed`, an attribute and an interpolation; rendered alone and under a provider of the key |
| `ThemedShelf`, `ThemedList` | The same through scoped slots and `:slotted()` slot scope ids, lists, fractions mixed with integers and booleans provided |
| `HeadPage`, `HeadArticle`, `HeadSeo` | `useHead` and `useSeoMeta` from `@unhead/vue` in a parent and its children: a title template over a child's title, every kind of tag, `htmlAttrs` and `bodyAttrs` with class and style objects and lists, getters, `computed`s, a `meta` per item of a list (`.map`), a list as `content`, JSON in a `script`, `tagPosition`, `key`, tags a later component replaces, absent, `null`, empty and `"true"` values. The head unhead's server renders is recorded after the HTML, behind `<!--fv-head-->` |
| `HeadTheme`, `HeadThemePage` | The page head beside `provide` and `inject`: a component that injects a theme, provides another and sets the head from the one it injected, inside a provider, with slot content (`HeadArticle`) that calls `useHead` and a child that injects what it provides |
| `HeadChoice`, `HeadNote` | The page head from components `<component :is>` chooses, by `?:` and from an object by a union prop, after a parent's title template |

Every component has at least one **hostile** fixture: markup-breaking characters in every prop that
reaches the page.

## Hydrating in real browsers

The conformance suite hydrates each fixture in happy-dom, whose HTML parser is not a browser's. A
browser rebuilds some markup as it parses: a block element closes an open `<p>`, a table gains a
`<tbody>` and pushes stray content out of it, `<select>` and `<template>` have rules of their own;
and Vue hydrates against what the browser built. A mismatch only a browser shows is a real one for
readers, so `pnpm test:browser` hydrates in Chromium, Firefox and WebKit through
[Playwright](https://playwright.dev):

```sh
pnpm --filter ferrovue exec playwright install chromium firefox webkit   # once (Linux: --with-deps)
pnpm test:browser
FERROVUE_BROWSERS=chromium pnpm test:browser                             # one browser
```

- **Conformance** (`packages/ferrovue/browser/conformance.test.ts`): `entry.ts`, which imports every
  component, is bundled once by Vite with `@vitejs/plugin-vue` and Vue's development build. Each
  fixture becomes a page: its recorded HTML as the body, teleported content in its targets
  (`hydrationBody`, as the happy-dom suite places it), and the fixture in the head. Playwright serves
  the page and the bundle from memory, no server listening. The page builds the app with the same
  `fixtureApp` as the happy-dom suite (`src/fixture.ts`: props, slots, route, Pinia state, locale)
  and hydrates. The test fails on a hydration warning or any error the page logs, if Vue replaced
  the server's first node, or if hydrating changed the document as the browser parsed it.
  Vue rewrites some attributes on purpose as it hydrates (it sets every dynamic prop again);
  those are listed, by fixture, in `PATCHED`, and the test fails if one stops happening. A
  fixture in `VUE_DISAGREES` must mismatch instead, and the head of one in `UNHEAD_REWRITES` must
  be rewritten, as in happy-dom.
- **Lazy islands** (`packages/ferrovue/browser/lazy.test.ts`): `lazy-entry.ts` is bundled with its
  islands' components split into chunks of their own, and a page holds three islands from the
  fixtures: one hydrated at once, one waiting for idle and one for `(min-width: 1000px)`. The page
  holds back `requestIdleCallback` until the test releases it (then hands it to the browser's own),
  and opens 800 pixels wide. The tests check that neither waiting island's chunk is requested
  before its trigger, that each is requested once the browser is idle or the viewport is widened,
  and that hydrating logs no warning and leaves the document as the browser parsed it.
- **Full-stack example** (`examples/fullstack/browser/hydration.test.ts`): builds the client with
  `vite build` into a temporary directory (production Vue, with
  `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__` so attribute mismatches are checked), builds the server
  with Cargo and starts it on a free port (`PORT=0`, `DIST_DIR`), stopping it when done. It opens the
  home page and a streamed book page, fails on any warning or error, checks that the home page fetches
  the code of its own islands alone and that the document is as the browser parsed it, then adds a
  book to the basket and shows every review.

A browser that will not launch is skipped with a warning, except in CI (`CI` set), where it fails
the run: WebKit needs system libraries some Linux distributions do not ship. CI's `Hydrates in real
browsers` job caches the browsers by Playwright version and installs their libraries each run.

A fixture that mismatches only in a browser is a finding: the recorded HTML is Vue's own render, so
the cause is the template: markup a browser rebuilds as it parses. Report
it, leave the fixture as recorded, and consider whether the compiler should refuse the template.

## Randomised differential testing

The conformance components cover what someone thought to write. `pnpm fuzz` writes components
nobody thought of: random single-file components and props, drawn from a seeded PRNG
(`packages/ferrovue/fuzz/generate.ts`), each rendered with Vue's `renderToString` and with the Rust
ferrovue generates, and compared byte for byte.

What it generates, with random nesting:

- elements (block, inline, lists, void), static text with entities and whitespace, `<template>`;
- props of type `string`, `number` (integers, some anywhere within ±2⁵³), `Float`, `boolean`, their
  optional versions, lists of strings and of integers, lists of objects of local interfaces, and
  dictionaries (`Record<string, T>`, `{ [key: string]: T }`) whose JSON gives array-index keys out
  of order and a key twice;
- `{{ }}` of all of them; `v-if` / `v-else-if` / `v-else` (with `!`, `&&`, `||`, `===`, `!==`, `<`,
  `>`, presence tests and narrowing); `v-for` over lists, objects (destructured too), array literals,
  number ranges, computed lists and dictionaries (`(value, key, i) in r`, `Object.entries`), with an
  index;
- static and bound attributes, boolean attributes, `:class` strings, arrays and objects (computed
  names too), `:style` objects merged with a static `style`;
- child components written beside each one: a single root, a slot with a fallback, a root that is
  a component forwarding its slot, a fragment, a root that is another component, a root with
  attributes of its own, `inheritAttrs: false` with `$attrs` bound before and after an element's
  own, `useAttrs()` bound on a root that inherits them too, a root with none of its own and a root
  that is a component given none, given slot content and attributes they
  do not declare, which fall through, at the root or nested, often slot content that may write
  nothing visible (interpolations of optional, empty or whitespace values beside loops, branches
  and `<template>`s that may render only their comments), which decides whether the fallback
  shows; `<style scoped>` on the component and on each child, with `:slotted()` on those with a
  slot;
- string `+`, template literals, `?:`, `??`, `||`, `.length`, `.trim()` and the rest of the string
  methods (`slice`, `substring`, `at`, `charAt`, `indexOf`, `split`, `replace` and `replaceAll`
  with `$` patterns, `padStart`, `padEnd`, `repeat`), strings ordered with `<`, `String()`,
  `.toString()`, `.toFixed()`, `Number()`, `parseInt()`, `parseFloat()`, `JSON.stringify()`, `Math`,
  and integer and fractional arithmetic;
- lists computed from lists, `Object.keys` / `Object.values` and `split`, by `filter`, `map` and
  `slice` with arrow functions (an index too), chained, read by `.join()`, `.length`, `.includes()`,
  `some`, `every`, `find`, `findIndex` and `JSON.stringify`;
- prop values meant to break things: markup and quotes, `</script>`, combining marks, emoji, RTL
  and bidi controls, JavaScript-only whitespace, case mappings that change length, empty strings,
  numbers written as strings, integers at ±(2⁵³ − 1), fractions such as `0.1`, `1e-7`, `1e21`,
  `5e-324` and `-0`, absent optionals.

Only what ferrovue promises to accept is generated: expressions are typed as TypeScript and
ferrovue type them, optional values are read only where they may be, integer arithmetic never
leaves ±2⁵³, and two strings that may each hold half of a surrogate pair never meet. So a component
the compiler refuses is reported as a **refusal**, a finding of its own when the README says the
construct is supported. Vue's HTML is compared as a server sends it, a half of a pair as U+FFFD
(README, "Strings").

```sh
pnpm fuzz                                              # a random seed (printed), 200 components
FERROVUE_FUZZ_SEED=42 FERROVUE_FUZZ_COUNT=1000 pnpm fuzz
FERROVUE_FUZZ_SEED=42 FERROVUE_FUZZ_CASE=17 pnpm fuzz  # reproduce one component of a run
FERROVUE_FUZZ_DRY=1 pnpm fuzz                          # the compiler alone: what it refuses
FERROVUE_FUZZ_PLANT=1 pnpm fuzz                        # self-check: plant a bug, see it caught
```

A seed reproduces a run exactly: case `n` of seed `s` is the same component and fixtures however
many cases the run has. Other variables: `FERROVUE_FUZZ_FIXTURES` (fixtures per component, 4),
`FERROVUE_FUZZ_SHRINK_MAX` (failures to shrink, 24), `FERROVUE_FUZZ_KEEP=1` (keep the shrinker's
work directory).

How a run works:

1. The components and fixtures are written to `target/fuzz/<seed>/cases/`, one directory per
   component, and `generate()` runs on each.
2. One vitest run (`packages/ferrovue/fuzz/vitest.config.ts`, `@vitejs/plugin-vue`, the same
   `attachSsrRender` and `fixtureApp` as the conformance suite) renders every fixture with Vue.
3. One `cargo test` of a throwaway crate, `target/fuzz/harness/`, which includes every component's
   generated modules, renders every fixture through `render_json`. Its target directory,
   `target/fuzz-target/`, is shared between runs, so the runtime crate is built once.
4. Each pair is compared. The summary counts components, fixtures, matches, mismatches, Rust
   errors (a panic, or a fixture the props do not read), components whose generated Rust does not
   compile, and refusals, with the message of each.
5. Each failure is **shrunk**: nodes, `v-if` and `v-for` directives, attributes, class and style
   entries removed, sub-expressions replaced by smaller ones, prop values made shorter or left out,
   for as long as the failure stays. The candidates of each round are checked in one batch. The
   smallest case is saved in `fuzz/failures/<seed>-<case>/`: the component, `fixture.json`, Vue's
   `vue.html`, ferrovue's `ferrovue.html` (or the compile error), and `about.txt`.

`pnpm fuzz` exits 1 on a mismatch, a Rust error, generated Rust that does not compile, a refusal, a
fixture Vue cannot render, or a run that compares no fixture at all. CI runs it nightly
(`.github/workflows/fuzz.yml`) with 1,000 components and the date as the seed
(`FERROVUE_FUZZ_SEED=20261004`), and uploads `fuzz/failures/` when it fails.

`FERROVUE_FUZZ_PLANT=1` checks the harness itself: before building, it writes one escaped
interpolation per component unescaped (`out.push_str` for `fv::escape_into`). The run must then
report mismatches and shrink one to a lone `{{ s }}` with a value such as `">"`. Its failures go to
`target/fuzz/planted-failures/`, apart from the real ones in `fuzz/failures/`. The nightly workflow
runs it on 30 components before the real run and fails unless it reports a mismatch.

### Turning a failure into a conformance case

1. Copy `fuzz/failures/<seed>-<case>/<Name>.vue` to `crates/ferrovue/tests/conformance/components/`
   under a name that says what it covers, and its `fixture.json` to
   `fixtures/<Name>/<case>.json`.
2. Run `pnpm conformance:generate` and `pnpm conformance:record`. The recorded `.html` must equal
   the saved `vue.html`.
3. `cargo test` fails until the compiler or runtime is fixed; then it is a regression test. Delete
   the directory from `fuzz/failures/`.

## Coverage

```sh
pnpm coverage        # both, below
pnpm coverage:ts     # vitest's V8 coverage of packages/ferrovue/src: target/coverage/ts/index.html
pnpm coverage:rust   # cargo llvm-cov over the workspace: target/coverage/rust/html/index.html
```

`coverage:rust` needs `cargo install cargo-llvm-cov --locked` and
`rustup component add llvm-tools-preview`. The **Coverage** workflow
(`.github/workflows/coverage.yml`) runs both on every push to `main` and every pull request, writes
the totals in the run's summary, and uploads the reports (HTML and lcov) as the `coverage`
artifact. Nothing is sent to a coverage service, and no number fails the run: a covered line is
not a tested one, which is what the mutation testing below is for.

## Mutation testing

Coverage says a line ran; mutation testing says a test would notice if it were wrong.
[cargo-mutants](https://mutants.rs) makes hundreds of small changes to the runtime crates' source
(`crates/*/src`, configured in `.cargo/mutants.toml`): `<` made `<=`, `&&` made `||`, a function's
body replaced by a default value; it runs all four crates' tests (units, vectors, properties and
conformance) on each: the conformance suite in `ferrovue` holds the router, vue-i18n and the
number writing to Vue's output too. A change that no test notices is a **surviving** mutant.

```sh
cargo install cargo-mutants --locked
cargo mutants -j 4                      # every crate; the results go to mutants.out/
cargo mutants -p ferrovue-core -j 4     # one crate's mutants, still tested by all four
cargo mutants -F js_round               # only the mutants whose name matches
```

A survivor is either a gap, closed by a test, or an **equivalent** mutant: a change that cannot
alter what the function returns, such as `<` made `<=` where the two sides can never be equal.
Each equivalent is listed in `.cargo/mutants-equivalent.txt`, without its line and column, under
a comment saying why it changes nothing. Where the right answer is defined by JavaScript, Vue,
vue-router or vue-i18n, the test that closes a gap takes it from them: a vector recorded with
`pnpm vectors:record`, or a conformance fixture recorded with `pnpm conformance:record`.

The **Mutants** workflow (`.github/workflows/mutants.yml`) runs every Monday and by hand, in two
shards, and fails on any survivor that is not in the list. It is too slow for every pull request;
run it locally on the functions a change touches (`-F`, or `--in-diff` with a diff file).

## Investigating a construct

`node scripts/inspect.ts path/to/X.vue '{"prop":"value"}'` prints the three things to compare when
adding support for something: what Vue's SSR compiler makes of the component, what Vue renders,
and what ferrovue generates (or the error it refuses with).

## Adding a case

- **A new fixture for an existing component:** add `fixtures/<Component>/<case>.json`, then run
  `pnpm conformance:record` to record its `.html` from Vue. Read the recorded HTML before you commit
  it, then run `cargo test`.
- **A new component:** add it to `components/`, run `pnpm conformance:generate`, add at least one
  fixture (plus a hostile one), and record as above. The suite fails if a component has no fixtures.
- **A new router case:** add it to `crates/ferrovue-router/tests/vectors/router.json` and run
  `pnpm vectors:record`.
- **A new string or number case:** add its inputs to `tests/vectors/strings.json`, `parse.json`,
  `compare.json`, `keys.json` or `json.json` (any expected value) and run `pnpm vectors:record`,
  which writes what JavaScript answers.
- **A new refusal:** add a `[what, source, /message/]` row to `refused` in `compiler.test.ts`.

Never re-record to make a failure go away. A changed `.html` means either Vue changed (after an
upgrade) or the compiler did, and the diff is the thing to review.

## Upgrading Vue or vue-router

1. Bump the exact versions in both `package.json` files and run `pnpm install`.
2. Run `pnpm conformance:record && pnpm vectors:record` and review the diff of every `.html` and of
   `router.expected.json`.
3. Run `pnpm conformance:generate`, then `cargo test --all-features`. A Rust failure here is a
   behaviour change in Vue that the compiler or runtime now needs to follow.
