# Testing ferrovue

ferrovue promises one thing: for every input it accepts, the Rust it generates writes the same
bytes Vue's server renderer writes, and it refuses every input it can't translate. The suite is
built around that promise. Wherever it can, it takes the expected answer from the real Vue,
vue-router or JavaScript rather than from a hand-written string.

```sh
pnpm test                  # TypeScript: compiler, CLI, vectors, router, Vue half of conformance
cargo test --all-features  # Rust: runtime units, properties, Rust half of conformance
pnpm typecheck
pnpm conformance:check     # the committed generated Rust is what the compiler writes now
```

## The layers

| Layer | Where | What it proves | Source of truth |
|---|---|---|---|
| **Conformance** | `crates/ferrovue/tests/conformance/` | Each component × fixture renders identically in Vue and in the generated Rust, and Vue hydrates the HTML with no mismatch | `@vue/server-renderer`, Vue's hydration |
| **Shared vectors** | `crates/ferrovue/tests/vectors/` | The runtime's reimplementations of `trim`, `.length`, `escapeHtml`, and vue-router's link resolution (string and object `to`, named routes, query and hash encoding, history base) and `useRoute()` fields agree with the originals | JavaScript, `@vue/shared`, vue-router |
| **Compiler** | `packages/ferrovue/test/compiler.test.ts` | Constructs that a careless translation would get subtly wrong are refused with a named error; key translations have the expected shape | Hand-written |
| **CLI** | `packages/ferrovue/test/cli.test.ts` | `ferrovue` writes, replaces, and `--check` detects stale and stray files | Hand-written |
| **Runtime units** | `crates/ferrovue/src/tests.rs`, `src/router/tests.rs` | Escaping, slots, fallbacks, holes, islands, the state script, router edge cases | Hand-written |
| **Properties** | `crates/ferrovue/tests/properties.rs` | Invariants over generated inputs: escaped text has no markup and reads back whole; the state script can't be closed; router never panics | `proptest` |
| **Differential fuzzing** | `packages/ferrovue/fuzz/` | Random components and props, within the grammar ferrovue accepts, render identically in Vue and in the generated Rust; each difference is shrunk to a small case (`pnpm fuzz`, nightly in CI, not part of `pnpm test`) | `@vue/server-renderer` |
| **Example** | `examples/greeting/` | Generated code compiles in an ordinary (non-test) consumer crate | `cargo build` |
| **Full-stack example** | `examples/fullstack/` | An axum server's pages, streamed through holes, hydrate in the client built from the same components with no mismatch, and their islands share the store | Vue's hydration (`pnpm --filter ferrovue-example-fullstack test`) |

### Conformance in detail

```text
components/X.vue ──Vue SSR──▶ fixtures/X/case.html ◀──byte-equal──  generated/x.rs (Rust)
        ▲                            │
fixtures/X/case.json            Vue hydrates it: no mismatch warnings, same DOM node kept
```

1. `conformance.test.ts` renders each `fixtures/<Component>/<case>.json` with real Vue and compares
   the result with `<case>.html`.
2. It mounts the recorded HTML and hydrates it, failing on any hydration warning.
3. It checks that `generated/` is exactly what the compiler writes now.
4. `tests/conformance.rs` renders every fixture through the generated Rust and compares the result
   with the same `.html`.

A fixture is a JSON object of props plus three optional keys:

- `$slots`: each slot's content as HTML (`routerView` is the page `<RouterView>` shows)
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
| `Defaults`, `Destructured` | `withDefaults`, the boolean cast, destructured props with defaults and new names, class objects |
| `Model`, `ModelParent` | `defineModel` (named, required, default) and `v-model` on a component |
| `Form` | `v-model` on input, checkbox, select, radio and textarea |
| `Builtins` | `Transition`, `TransitionGroup`, `KeepAlive`, `Suspense`, `v-text`, `v-once`, `v-pre`, `v-memo`, a client-only directive |
| `Prose` | `v-html` of `TrustedHtml`, required and optional |
| `Tree` | A recursive, self-rendering component |
| `UserCard`, `UserList` | Types imported from a shared `.ts` file and from another component, string-literal unions, objects passed to children |
| `DataList`, `DataTable`, `RowChip` | Scoped slots in a loop with fallbacks, props destructured and taken whole, empty content giving way to the fallback, a slot's object handed to a child |
| `Frame`, `Forward`, `Page`, `Card` | Slots, fallbacks, comment-only content, slots forwarded through components |
| `Panel`, `Dashboard` | Named slots, `$slots.x`, interpolating fallbacks, child props as literals, variables, lists and whole `Props` |
| `Nav`, `Links`, `Menu`, `App` | `<RouterLink>` active matching, relative links, named routes, `query`/`hash`, link class props, imported `RouterLink`, `<RouterView>` |
| `RouteInfo` | `useRoute()` and `$route`: path, hash, name, params |
| `Badge`, `Cart` | Pinia state through the store and `storeToRefs`, getters, two stores, store reads in `computed` |

Every component has at least one **hostile** fixture: markup-breaking characters in every prop that
reaches the page.

## Randomised differential testing

The conformance components cover what someone thought to write. `pnpm fuzz` writes components
nobody thought of: random single-file components and props, drawn from a seeded PRNG
(`packages/ferrovue/fuzz/generate.ts`), each rendered with Vue's `renderToString` and with the Rust
ferrovue generates, and compared byte for byte.

What it generates, with random nesting:

- elements (block, inline, lists, void), static text with entities and whitespace, `<template>`;
- props of type `string`, `number` (integers, some anywhere within ±2⁵³), `Float`, `boolean`, their
  optional versions, lists of strings and of integers, and lists of objects of local interfaces;
- `{{ }}` of all of them; `v-if` / `v-else-if` / `v-else` (with `!`, `&&`, `||`, `===`, `!==`, `<`,
  `>`, presence tests and narrowing); `v-for` over lists, objects (destructured too), array literals
  and number ranges, with an index;
- static and bound attributes, boolean attributes, `:class` strings, arrays and objects (computed
  names too), `:style` objects merged with a static `style`;
- string `+`, template literals, `?:`, `??`, `||`, `.length`, `.trim()` and the rest of the string
  methods, `String()`, `.toString()`, `.toFixed()`, `Math`, and integer and fractional arithmetic;
- prop values meant to break things: markup and quotes, `</script>`, combining marks, emoji, RTL
  and bidi controls, JavaScript-only whitespace, case mappings that change length, empty strings,
  integers at ±(2⁵³ − 1), fractions such as `0.1`, `1e-7`, `1e21`, `5e-324` and `-0`, absent
  optionals.

Only what ferrovue promises to accept is generated: expressions are typed as TypeScript and
ferrovue type them, optional values are read only where they may be, and integer arithmetic never
leaves ±2⁵³. So a component the compiler refuses is reported as a **refusal**, a finding of its own
when the README says the construct is supported.

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

`pnpm fuzz` exits 1 on a mismatch, a Rust error or generated Rust that does not compile. CI runs it
nightly (`.github/workflows/fuzz.yml`) with 1,000 components and the date as the seed
(`FERROVUE_FUZZ_SEED=20261004`), and uploads `fuzz/failures/` when it fails.

`FERROVUE_FUZZ_PLANT=1` checks the harness itself: before building, it writes one escaped
interpolation per component unescaped (`out.push_str` for `fv::escape_into`). The run must then
report mismatches and shrink one to a lone `{{ s }}` with a value such as `">"`. Its failures go to
`target/fuzz/planted-failures/`, not `fuzz/failures/`.

### Turning a failure into a conformance case

1. Copy `fuzz/failures/<seed>-<case>/<Name>.vue` to `crates/ferrovue/tests/conformance/components/`
   under a name that says what it covers, and its `fixture.json` to
   `fixtures/<Name>/<case>.json`.
2. Run `pnpm conformance:generate` and `pnpm conformance:record`. The recorded `.html` must equal
   the saved `vue.html`.
3. `cargo test` fails until the compiler or runtime is fixed; then it is a regression test. Delete
   the directory from `fuzz/failures/`.

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
- **A new router case:** add it to `tests/vectors/router.json` and run `pnpm vectors:record`.
- **A new refusal:** add a `[what, source, /message/]` row to `refused` in `compiler.test.ts`.

Never re-record to make a failure go away. A changed `.html` means either Vue changed (after an
upgrade) or the compiler did, and the diff is the thing to review.

## Upgrading Vue or vue-router

1. Bump the exact versions in both `package.json` files and run `pnpm install`.
2. Run `pnpm conformance:record && pnpm vectors:record` and review the diff of every `.html` and of
   `router.expected.json`.
3. Run `pnpm conformance:generate`, then `cargo test --all-features`. A Rust failure here is a
   behaviour change in Vue that the compiler or runtime now needs to follow.
