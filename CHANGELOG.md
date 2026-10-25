# Changelog

All notable changes to this project are documented here. The crates and the npm package are
released together and share version numbers.

## [Unreleased]

### Changed

- Tests only: the Stryker survivors the compiler's fixes left in `template.ts` and `expr.ts` are
  closed. A compiler test refuses merged attributes on an SVG element whose tag holds a dash
  (FV0006), which only a `<textarea>` reached before FV0424; an `expr.test.ts` case holds
  `[].length` to an integer. The tests of a declaration's initialiser that FV0424 and the
  rendering of a client-only directive on an element with no content left unreachable are listed
  in `stryker-equivalent.txt`, under the reason of the declarations entry, brought up to date.
  Seven mutants of `constants.ts` and `dynamic.ts` that no test kills, which earlier runs reported
  as timeouts, are listed with their reasons.

### Fixed

- A prop or a field typed as a list of a union of string literals (`tones: Tone[]`) is a list of
  the union's enum: `Vec<Tone>`, `Option<Vec<Tone>>` when it is optional or nullable, and
  `Vec<Option<Tone>>` for `(Tone | null)[]`, with a constructor or setter taking
  `impl IntoIterator<Item = Tone>`. It was a list of strings, and an item handed to a child's
  union prop was converted with a `match` whose last arm took any other string, so a string
  outside the union rendered as the last member where Vue writes the string itself. A `v-for`
  item of such a list reaches a child's union prop as the enum, a lookup table read by it is a
  `match` over the variants, and the list reaches a child's list of the union as it is. This
  changes the generated `Props` of such a prop, which is a change in the generated code; the
  island's JSON is the same. A string the Rust caller holds where the render needs a union's enum
  (a value of a `Record<string, Tone>`, a store's state, a prop of a single literal) is parsed as
  the component renders, and one outside the union refuses the render with FV0518. Generated code
  calls no item 0.11.0 lacks, so `__compat!` stays at 5.
- The README and the guide's quick start name the schema of the current release in `$schema`;
  they named 0.8.0's. `release.ts bump` writes the new version into both, and `release.ts check`
  refuses a tag they do not match.
- The `ferrovue` dependency in the README and in the guide's `escaping` and `web_frameworks` pages
  is 0.11, and the bug report's version placeholder 0.11.0. `release.ts bump` and
  `release.ts check` cover them as they cover the schema URL. RELEASING.md and CONTRIBUTING.md write
  `X.Y.Z` in their example commands.
- A string of a wider union of string literals reaches a child's prop of a narrower union once it
  is narrowed as TypeScript narrows it, as 0.10 compiled it when the prop was a string. Given
  `const tone = ref<Tone | "">(…)`, these compile: `:tone="tone || undefined"`,
  `tone === '' ? undefined : tone`, `'' !== tone ? tone : undefined`, `tone ? tone : undefined`,
  `v-if="tone !== ''"`, a `v-else` after `v-if="tone === ''"`, an operand of `&&` after the test,
  and a `computed` annotated `Tone | undefined` whose body narrows it so. `||` leaves out a union's
  falsy members, and `===`, `!==` and a test of truth narrow a string of a union in each branch of
  `?:`, `&&`, `||` and `v-if`.
- A `computed`, a `ref` or a constant of setup annotated as a union of string literals is checked
  against its annotation. One whose body may give another string is refused at its declaration
  with the new FV0111, where a child's prop or an object literal's field takes it as the union.
  `ERRORS` in `ferrovue/compiler` holds FV0111. FV0515 names the members a value of a wider union
  may still hold and the narrowing that leaves them out. A constant table read as `undefined` for
  a member (`{ "": undefined }`) stays refused with FV0207.

## [0.11.0] - 2026-10-25

### Added

- Loops and `let`s assigned again in a function's or a `computed`'s body and in a list method's
  callback: `for (const x of list)` over a list, `list.entries()`, `Object.keys()`,
  `Object.values()` or `Object.entries()`; `for (const ch of text)` over a string by its
  characters, a character beyond U+FFFF one item; counting loops `for (let i = 0; i < n; i++)` to
  an integer bound, read again before each item; `break`, `continue`, nested loops and `return`
  inside a loop. A body assigns the `let`s it declares with `=`, `+=`, `-=`, `*=`, `/=`, `%=`,
  `??=`, `||=`, `&&=`, `++` and `--`, each a statement of its own, and a `let` has the type
  TypeScript gives it. A loop carries strings, numbers and booleans, present or optional, from one
  item to the next in Rust variables, numbers as `f64` computed as JavaScript computes them. Sums,
  the largest of a list, thousands separators and strings built character by character compile.
  FV1909 (a loop of another shape, such as a `for` loop that does not count), FV1910 (`for…of` over
  a value that is not a list or a string), FV1911 (a loop carrying or returning a list or an object)
  and FV1912 (a `let` assigned a value of another type, or starting as `undefined` with no type)
  are new entries of `ERRORS` in `ferrovue/compiler`. `while`, `do…while` and `for…in` loops stay
  refused with FV1901. The conformance components `Loops` and `LoopEdges` record them from Vue, and
  the fuzzer generates loops and `let` accumulators.

- Constants are worked out when the component is compiled, as JavaScript works them out: `+`, `-`,
  `*`, `/` and `%` of numbers, unary `-` and `+`, `**` where it gives an exact integer within
  ±2⁵³ (FV0720 for another power, which engines round in their own ways), strings joined with `+`
  and template literals of constants (`const HOUR = 60 * MINUTE`, `` `${BASE}/feed` ``), in a
  `.ts` file and in `<script setup>`.
- A function's or a `computed`'s body may declare arrow functions of its own
  (`const pad = (k: number) => …`), which read the body's names and are translated where it calls
  them.
- A string known to hold ASCII alone (the string of a number, `toFixed()`, an ASCII literal, and
  what slicing, trimming, padding, case mapping, joining and `split` make of them) may be cut into
  characters and joined again without FV0706, so a thousands separator can be written with
  `String(n).split("").reduce(…)` or slices; `s[i]` reads a string's code unit, `undefined`
  outside it.
- `Object.hasOwn(CONST, key)` of an object constant by a free-text string or integer key, compiled
  to a test of the constant's own keys, which narrows the key for `CONST[key]` in a `?:`, after
  `&&` and `||` and inside a `v-if`; `Object.hasOwn(record, key)` of a `Record` prop;
  `Object.keys()` of an object constant.
- Constant `Map`s (`new Map([["sm", 12], ["md", 16]])`, keys strings or integers), read with
  `.get(key)`, `undefined` for a key the map lacks, and `.has(key)`. FV0227, a new entry of `ERRORS` in
  `ferrovue/compiler`, refuses a constant `Map` read in another way.
- Object literals as values where their type is known, each built as the Rust struct of its
  interface (the component's own, or the shared one in `types.rs`): the result of a `computed`
  annotated with it (`computed<Card>(…)`, `computed((): Card => …)`, `ComputedRef<Card>`), of a
  function's return type or given to a parameter's, in `<script setup>` or a `.ts` file; the items
  of a `.map()` whose callback states its return type or whose list type is known
  (`computed<Row[]>`, a function returning `Row[]`, a child's `Row[]` prop); a child's prop typed
  with an interface (`:item="{ id, label }"`, `v-bind="{ item: { … } }"`); an annotated `const` in
  setup, and `satisfies`. Shorthand keys, computed keys the compiler knows, nested literals, array
  literals of objects and a spread of the same type before the other keys are supported; an
  optional field left out or given `undefined` is `None`, a nullable field takes `null`. The
  conformance components `ObjectLiterals` and `ObjectShapes` record them from Vue and hydrate them in
  the browsers.
- `FV0634`: an object literal whose type is not known, with a message that says where it is (the
  template, a `computed`, a function, setup, a `.map()` callback) and how to type it. `FV0635`: an
  object literal that does not match its interface (a key it does not declare, a required field
  left out, a key given twice, a method, `__proto__`, a computed key the compiler does not know, a
  spread of another type or after other keys). `FV0636`: a list method, an item or an optional
  chain of a value built from object literals in place, which a `computed` of its own holds.
  `ERRORS` in `ferrovue/compiler` lists the three, and the detail of FV0625 no longer names object
  literals among its causes.
- A prop or an interface's field typed as a union of two or more string literals is a Rust enum
  the compiler generates, with a variant per literal: a `type` alias keeps its name (`Size`,
  written once to `types.rs` for a `.ts` file, so components that import it share it), a union in
  place is named after its component and prop (`ButtonSize`) or its interface and field, and a
  string `enum` is one too, its variants named after its members. Each enum derives `Debug`,
  `Clone`, `Copy`, `PartialEq`, `Eq`, `Hash`, `serde::Serialize` and `serde::Deserialize`, with
  serde's names the literals, and has `as_str()`, `ALL`, `Display`, `FromStr` and
  `TryFrom<&str>`. The template writes it through `as_str()`; `===` and `!==`, `switch`, lookup
  tables and `<component :is>` read it as the enum, the last two as a `match` with no catch-all
  arm; it reaches a child's prop of its union as itself, of a wider union through a `match`, and
  of `string` as its literal. See the `props` guide's "Unions of string literals".
- `ferrovue::ParseUnionError`, what a generated enum's `FromStr` and `TryFrom<&str>` return for
  a string outside its union, with `union()`, `value()` and `members()`.
- Refusals with new codes, for what TypeScript refuses too and for unions with no enum: a literal
  with no letter or digit to name its variant (FV0323), two literals that name one variant, or an
  `enum` with two members of one value (FV0324), an enum named as another type of its module
  (FV0325), a value outside a child's union prop or a `string` given to one (FV0515), and a
  comparison with a literal outside the union (FV0637). A default outside the union is FV0322, and
  a constant list's field outside it FV0215.
- The guide page [`upgrading_to_0_11`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_11/index.html):
  bumping both halves (and the Node it needs), generating again for version 5 with every local
  renamed once, building union props from their enums (`Size::Md`, `"md".parse::<Size>()?`), the
  codes a CI may match that are new or changed (the refusals of FV0008, FV0009, FV0326, FV0327,
  FV0328 and FV0424 among them), what renders differently, and what compiles that 0.10 refused.
- The conformance components `UnionEnums` and `UnionChild`, recorded from Vue, and props of
  unions of string literals, required, optional and nullable, in the differential fuzzer, which
  compares them only with their members.
- An object literal's field typed as a union of string literals holds the union's enum: a literal of
  the union is its variant (`{ size: "md" }` is `Size::Md`), a value of the same enum is given as it
  is, and a narrower union or a `?:` of members goes through a `match`. A string that may be outside
  the union is refused with FV0635. `Object.hasOwn()` of a constant and `.get()` and `.has()` of a
  constant `Map` by a key of such a union match on its variants. The conformance components
  `UnionObjects` and `UnionStep` record these from Vue, and the differential fuzzer gives its
  `FzCardT` literals a union field.
- Dates inside lists, dictionaries and interfaces: a prop or a loader's result may hold `Date`
  fields (required, optional and nullable), `Date[]`, `(Date | null)[]`, `Record<string, Date>` and
  interfaces of them, shared and recursive ones included, each date the Rust type `dateType` names
  (a date that is a loader's result itself, or in its list, dictionary or optional, is a
  `ferrovue::JsDate`). The template reads such a date as it reads a `Date` prop, walks a list of
  dates with `v-for`, `[i]`, `.at()`, `.filter()`, `.find()`, `.findIndex()`, `.some()`, `.every()`,
  `.map()`, `.slice()`, `.concat()`, `.toReversed()` and `.reduce()`, a dictionary of them with
  `v-for` and `Object.keys()`, `.values()` and `.entries()`, hands them whole to a child's prop of the
  same type, and builds them in object literals and in lists a `.map()` makes. The compiler writes
  a plan of where the dates are: an island writes it in `data-dates` beside `data-props`, a page's
  record beside each part's props (`d`) and the layout's (`dates`), and the payload of loaders'
  results under `dates`, by loader. `mountIslands`, `mountPage`, `renderPage`, `provideLoads` and
  `ferrovue/testing`'s conformance suite turn the dates the plan names back into `Date`s, an invalid
  one written as `NaN` included, and leave every other string as it is. FV1810, a new entry of
  `ERRORS` in `ferrovue/compiler`, refuses a list of lists or dictionaries of dates. The conformance
  components `DateRows`, `DateDays`, `DateReplies`, `DateThread` and `LoadedDates` record them from
  Vue and hydrate them in Chromium, Firefox and WebKit in three time zones, `DateRows` and
  `DateDays` render with chrono's `DateTime<Utc>` too, the differential fuzzer generates dates in
  interfaces, lists, dictionaries, object literals and loaders' results, and the full-stack
  example's reviews carry the date they were posted and its stock the date it was counted, from a
  loader.
- Render-time refusals: props that ask for what cannot be written as Vue writes it, known only as
  the component renders, refuse the render with a value it returns, so a server can answer
  `400 Bad Request`. Every generated component has a `try_render` beside its `render`, with the
  same parameters, returning `Result<(), ferrovue::Refused>`. `ferrovue::Refused` is a
  `#[non_exhaustive]` error, `Display` and `std::error::Error`, whose `code()`, `message()`,
  `component()`, `file()`, `line()` and `column()` give the code, the message saying what to do, and
  the component and the place of the expression in its file. A refusal in a child, in slot content
  or in a loader's component reaches the page's `try_render`, and the first the render met is the
  one returned. `Html::try_render_to`, `Html::try_into_string`, `Page::try_render_to` and
  `PageHole::try_fill` return it as well, leaving the buffer as it was. The refusals are FV1803 (a
  date string outside the format browsers read alike), FV1808 (`Date.UTC()` parts engines compute
  differently), FV0714 (a `.repeat()` count JavaScript throws on), and four new entries of
  `ERRORS` in `ferrovue/compiler`: FV0724 (an integer beyond ±2⁶³ where the template needs an
  `i64`), FV0725 (a `.repeat()`, `.padStart()` or `.padEnd()` beyond the longest string V8 makes),
  FV1811 (`.toISOString()` of an invalid date) and FV1812 (a date a child's `Date` prop cannot
  hold). The guide's `errors_and_limits` page shows a handler answering one, and the full-stack
  example's `/delivery` route renders a date and a number from the query string with `try_render`
  and answers a refusal with `400`. The conformance component `LoadedStamps` records `Date.UTC()` of
  a loader's result in a child from Vue, and a Rust test checks that its refusal reaches the page's
  render.
- The differential fuzzer counts a render that returns a refusal as refused at render, apart from
  Rust errors and mismatches, and lists each refusal's code and message; it renders a child
  `FzWide` whose `number` prop is a product of integers, beyond ±2⁶³ for wide props.

### Changed

- CI only: a pull request runs the jobs the paths it changes reach, on Node 22.23.4 and 26, where it
  ran every job on every Node; a push to `main` runs the jobs the merged change reaches on every
  Node and OS; a `release/*` branch, a tag, a manual run and a new weekly run run everything, and so
  does a change to `ci.yml` or `.github/actions/`. **CI passed** fails when the change detection
  fails and takes a skipped job as passed. Coverage runs on `main` and weekly, where it ran on every
  pull request, and the release dry run also runs for a change to `Cargo.toml` or the npm
  package's manifest.
- CI only: the fuzz targets' dependencies are checked against `fuzz/deny.toml`, which holds their
  own licence exception, so neither `cargo deny` run warns about an entry the other one needs; CI
  runs cargo-deny 0.20.2, where it ran the newest release; `just deny` checks both workspaces.
- Development only: `release.ts bump` also updates `fuzz/Cargo.lock`, which locked `ferrovue` and
  `ferrovue-core` at 0.7.2, and `release.ts check` refuses a tag whose version `fuzz/Cargo.lock` does
  not lock the published crates at.
- Development only: the source archives (`git archive`, and the source zip and tarball of a GitHub
  release) leave out the GitHub templates and settings, the fuzz targets, the mutation-testing
  configuration, the site and AGENTS.md. They keep `.github/actions` and `.github/workflows`,
  which a workflow's `$/` references load from that archive. The crate and the npm package are
  packed as before. GitHub
  marks generated code, recorded fixtures, vectors, the error-code page and the API reports as
  generated, so a diff collapses them.
- The npm package supports Node 22.23.4 or newer on 22, 24.22.1 or newer on 24, and 26.12.1 or
  newer (`engines`: `>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1`), where it supported 22.18 or
  newer. CI's oldest Node is 22.23.4.
- The npm package depends on postcss 8.5.31 and @intlify/message-compiler 11.4.16. Development
  only: Vite 8.3.5, happy-dom 21.0.4, vue-i18n 11.4.16, fallow 3.35.0 and oxlint 1.89.0, each the
  newest release at least a day old. Every newer release of the crates' dependencies is younger
  than Dependabot's seven-day cooldown, so `Cargo.lock` is unchanged.
- Tests only: the Mutants workflow runs cargo-mutants in sixteen shards built without debug
  information, where eight shards of about 333 mutants each ran up to the 90-minute timeout. New
  unit tests kill the survivors in the 0.11 runtime: a `Refused`'s column without its line, two
  copies of one refusal, the `Debug` of `Refused`, `Refusals`, `Loads`, `LoadCall` and
  `LoadFuture`, `LoadCall::key`, `LoadError::source`, a loader argument given by reference, the
  `*_fallible` constructors of `Html`, a page part that refuses, `Date.UTC` at the last date with a
  part beyond 2⁵³ ms, and `lastIndexOf` from inside a surrogate pair.
  `.cargo/mutants-equivalent.txt` gives the reasons for the survivors in `Date.UTC` and
  `lastIndexOf` that cannot change a result.
- Tests only: the fuzzer gives a string a loop builds a value to append that does not read the
  string itself, so a generated loop no longer doubles it on every item (`acc += acc`), which ran
  seed 4242 out of memory. A `?:` of a union value and a string literal keeps the members of both,
  and a `?:` whose test is `true` or `false` the members of the branch it takes, so a comparison of
  it is with one of them.
- Development only: the workspace runs pnpm 12.15.0, where it ran 12.5.1; CI takes the version from
  `packageManager`.
- CI only: the workflows reach their own actions and reusable workflows as `$/.github/…`, which
  GitHub resolves from the repository at the workflow's commit, where `./.github/…` loaded them from
  the working copy. zizmor fails CI on a finding of any severity; `.github/zizmor.yml` ignores the
  three npm installs no lockfile can describe (the package job installing the packed tarball as a
  user does, and the release's pinned npm), each with its reason.
- CI only: the browser job and the instruction-count job take `azure.archive.ubuntu.com` out of the
  runner's APT mirror list before installing packages, so APT downloads from
  `https://archive.ubuntu.com`, which the list already holds. The Azure mirror can serve packages so
  slowly that APT's timeout never fires (actions/runner-images#14823), which spent whole attempts of
  the browser job's install. Where the list is missing or holds no such archive, the step leaves it
  as it is and warns.
- FV1806 refuses a `Date` only in Pinia state, `provide`, `inject`, a typed `ref` and a
  `defineModel`, which reach the browser with no plan of where their dates are; a `Date` inside the
  props or a loader's result compiles. FV0317 accepts a dictionary of dates, FV2004 no longer
  refuses a result that holds dates, and `.toSorted()` of a list of dates without a comparator is
  FV1804. The public API changes: `reviveDates(component, props, dates?)` takes an island's
  `data-dates`, `PagePart` gains `d` and `PageRecord` gains `dates` (`ferrovue`,
  `ferrovue/client`, `ferrovue/testing`).
- The `ferrovue` crate gains the hidden items generated code calls for dates inside the props:
  `Html::dates`, `Load::DATES`, `DateShape` and `dates_in`. `Html` writes `data-dates` on an island
  and into a page's record, and `Loads::script_into` writes `dates` into the payload, when
  generated code gives them a plan.
- FV1902 is titled "Assignment the server does not translate", and refuses an assignment inside an
  expression, to a `const`, a parameter, a prop, a ref, a `computed`, a field or an item, from a
  function inside the body to a `let` of the body, and a function declared in the body that reads
  a `let` the body assigns again, each message saying which. FV1901 names a `while`, `do…while` or `for…in` loop with what to write instead.
- A refusal inside a `computed`, a setup expression or a function the template calls carries that
  refusal's own code and place (FV0710 for a regular expression, FV1902 for an assignment, FV0634
  for an object literal), with where the template reads the value or calls the function; it was
  FV0613 or FV0601, with the inner code in parentheses. Messages say where the construct is ("in a
  `computed`", "in a function", "in setup"), `await` inside an expression suggests awaiting a
  loader as a statement of its own, a bare regular expression is FV0710, and a refusal is reported
  once per place and code, however often the template reads it.
- FV0513 names the tag the template resolves by name; FV0316 suggests an interface for a tuple
  prop type; FV0814 says what `Object.keys()`, `Object.values()`, `Object.entries()` and
  `Object.hasOwn()` were given; FV0614 says why `&&` after a value that may be falsy while present
  is refused; FV1901 suggests `const f = (…) => …` for a `function` declared inside a body. The
  detail of FV0613 no longer lists a function declared in setup, which compiles.
- An object literal in the template is refused with `FV0634` where it was `FV0625` ("an object
  literal is not supported in a template"), also in a `computed` or a function. An untyped object
  constant setup cannot evaluate keeps `FV0207`, with a hint to annotate it with an interface.
- Generated code is version 5 (`ferrovue::__compat!(5)`), which the 0.10 crate refuses; the 0.11
  crate builds versions 2 to 5.
- `render`, `Html::render_to`, `Html::into_string`, `Page::render_to` and `PageHole::fill` panic with
  the message of a refusal at render time, `error[FV1803]: components/X.vue:3:9: …`, where a date
  string, `Date.UTC()`, `.toISOString()`, `.repeat()`, `.padStart()`, `.padEnd()` or a chrono
  `Date` prop panicked with a message of its own. Generated components call `try_render` and
  `try_render_scoped`, which replaces the hidden `render_scoped`; the generated `html()` of a
  component with slots or render parameters returns `Html<'p, Props, impl ferrovue::Renderer<Props>>`,
  which renders as before. `Html`'s methods, `Page::render_to` and `Part::new` take a renderer
  through the hidden `ferrovue::Renderer` trait, which every `Fn(&mut String, &P)` implements.
- The generated `Props` and shared structs hold an enum for each union of string literals, where
  0.10 held a `Cow<'a, str>`; a struct with no other borrowed field loses its lifetime. A Rust
  caller passes `Size::Md` where it passed `"md"`, as `upgrading_to_0_11` shows. Lists and records
  of such a union, single literals, unions with `string`, integer unions and the fields of a
  store's own interfaces are unchanged. The `closed_unions` test now checks that every `match`
  over an enum names each variant, that props holding a string outside a union do not
  deserialise, and that an integer union still reads a value outside it as its last member. In
  the conformance suite, `Catalog`'s `enum Tone` is `Volume`, so that it no longer shares a name
  with `Lookups`'s, its `empty` and `hostile` fixtures give it members of the union, and
  `FallSwitch`'s `hostile` fixture, a value outside its union, is gone.
- Generated code names its locals after the JavaScript names they hold: `let sum` is `fv_sum`,
  `for (const r of rows)` binds `fv_r` and `v-for="item in items"` binds `fv_item`, where a counter
  numbered them before (`fv_m1`, `fv_a3`, `n2`, and a bare `item` for a `v-for` item). A value the
  compiler makes for itself is named by its role (`fv_returned`, `fv_next_a`, `fv_tag`,
  `fv_slot_props`), and a name a function holds already takes `_2`, `_3`, …, counted per function,
  so an edit to one component or one part of a template keeps the names of the locals it leaves
  alone. Only Rust identifiers change: every render writes what it wrote, and generated code calls
  no new crate item. The guide's page on generated code describes the scheme.
- CI only: the jobs that run one Node.js, the release, the canary and the release dry run among them,
  run Node 26, the active LTS from 2026-10-28, where they ran Node 24. The test matrix still runs
  Node 22.18, 22, 24 and 26.
- CI only: a retry of the browser job's system libraries first stops the `apt-get` the timed-out
  attempt left running and waits for the package lock, which that `apt-get` held so the next
  attempts failed at once.
- Tests only: Stryker mutation-tests the compiler. `pnpm mutants:ts` mutates `attrs.ts` and
  `template.ts` (`stryker.config.json`), runs the vitest suite against each mutant with per-test
  coverage, and fails on a survivor `stryker-equivalent.txt` does not list with its reason, and on
  an entry no survivor uses (`scripts/stryker-survivors.ts`). The Mutants workflow runs it every
  Monday beside cargo-mutants and uploads the HTML report. The vitest runner is patched to name a
  nested test as vitest 5 matches it. New compiler tests (`attrs.test.ts`) and conformance
  components (`AttrObjects`, `AttrQuirks`) kill the survivors in both modules; `vite.test.ts`
  replaces `process.chdir` with a mocked `process.cwd`, which also runs in worker threads.
- Tests only: Stryker also mutates `constants.ts`, `dynamic.ts` and `expr.ts`. `pnpm mutants:ts`
  takes the modules to mutate by name (`pnpm mutants:ts expr`), and holds only those to
  `stryker-equivalent.txt`; the Mutants workflow runs the five modules in three jobs, each within
  its two hours. New compiler tests (`constants.test.ts`, `dynamic.test.ts`, `expr.test.ts`,
  `operators.test.ts`) and the conformance component `ListFallback` kill the survivors. The
  conformance tests compile the components' date plans when a test first reads them, where they
  compiled them as the test file loaded, which made Stryker run every test against most mutants
  of the compiler.

- Documentation: a site at <https://kinsmir.github.io/ferrovue/>, built with VitePress from the
  private workspace package `site/`: a landing page, the guide and the crate's front page generated
  at build time from `crates/ferrovue/docs/` in the order `guide.rs` lists them, with rustdoc's
  hidden doctest lines left out and intra-doc links pointing at the site's pages and at docs.rs for
  the API, and the changelog. Each page has its title, description, canonical link and Open Graph
  tags, and the site a sitemap and a robots.txt. The Pages workflow builds it in pull requests that
  touch it and deploys it from `main`. The README links it after docs.rs.

### Fixed

- `Math.max()` and `Math.min()` of integers keep a `-0` that integer arithmetic gives
  (`Math.max(n * 0, -1)` of a negative `n`), so `1 / Math.max(n * 0, -1)` is `-Infinity`, as in
  JavaScript. They compared the integers as `i64`, which has no `-0`.
- A refusal of an attribute bound both alone and in a `v-bind` object, whose later value Vue
  renders, no longer points at the earlier binding.
- An array literal of object literals given a list of other values (`[{ label: "x" }] as
  string[]`, a `computed` or function typed `string[]` that returns one, a child's `string[]` prop
  bound to one) is refused with FV0634. The compiler gave the list its type again each time it read
  it, and stopped with a stack overflow.
- `list ?? [...]`, an optional list falling back to an array literal of the same type, is written
  as `?:` writes it. The Rust ferrovue wrote passed the array where a reference to the list was
  taken, and did not compile.
- A list of numbers, booleans or dates that a `?:` or `??` copies is written as `.to_vec()`. It was
  written as `.iter().copied().collect()`, which clippy's `iter_cloned_collect` lint rejects.

- A child's prop named like a listener (`on1`, `onSale`, `:on-sale`) in props Vue joins with
  `mergeProps` (the child is a component's root, or is given `v-bind` of an object or `v-on` of an
  object beside other props) is left out when its value is falsy (`0`, `-0`, `NaN`, `""`,
  `false`), as `mergeProps` leaves out a listener, so the child takes the prop's default. ferrovue
  passed the value on, and `<Kid :on1="n" />` at a root wrote `0` where Vue wrote the default. Two
  new entries of `ERRORS` in `ferrovue/compiler` refuse what cannot be rendered so: FV0516 a prop
  named like a listener given twice in merged props, which Vue joins into a list, and FV0517 a
  required one that may be falsy there, which the child reads as `undefined`. FV0502 also refuses a
  name like a listener's that a component is passed beyond its props and hands on to a child that
  declares it, which ferrovue dropped where Vue passes it on as the prop. The conformance
  components `OnProps`, `OnPropsKid`, `OnPropsRoot` and `OnPropsBare` record both paths from Vue.
- Integer arithmetic whose result is beyond ±2⁶³ (`n * n` of a large `n`) is written into the page
  as JavaScript writes it (`16000000000000000000`, `8.112963841460666e+31`). The result was cast to
  `i64`, which stopped at `9223372036854775807`.
- Such a result chosen by `??`, `?:` or `||` is written from its double too, as one held in a
  `computed` or returned by a function is (the conformance component `WideChoices`). Where the
  template needs it as an integer, given to a child's `number` prop or used as an index or as the
  count of a `v-for`, it is refused at render time with FV0724, where it was cast to `i64` and
  rendered as `9223372036854775807`, which Vue does not write.
- A component may render itself by any name Vue resolves to it: its kebab-case or camelCase name
  (`<tree-node>` or `<treeNode>` in `TreeNode.vue`), which was refused with FV0513.
- A value outside a closed union renders as the union's last member wherever a lookup table or
  `<component :is>` reads it, as the `props` guide says. A lookup table defaulted by `??` (`T[k ??
  "c"]`) put the default first and read another member; a lookup table and `<component :is>` whose
  last member shared its value with an earlier one read the value of the group that came last; a
  table of booleans read `false`, and `v-if` of a table that lacks some members read its member
  absent, where the last member's is `true` and present. A new Rust test renders components that
  read closed unions in each of these ways with values outside the union.
- A test that narrows a value holds in every operand after it in a chain of `&&` or `||`:
  `n != null && n > 1 && n < 9` and `n == null || n < 1 || n > 9` compiled with FV0609, as did a
  `?:` whose test is such a chain. `a && b` of an `a` whose present values are all truthy gives
  `undefined` where `a` is absent (`kind && ICONS[kind]`, which was FV0223), and `b` where `a`
  cannot be absent, in text, attributes and `:class`.
- A component's root `:class="a && b"` left out the attribute where `a` is `undefined`, as
  `mergeProps` does, where it wrote `class=""`.
- A prop or a field of an interface written with no type (`defineProps<{ tag }>()`,
  `interface Row { id }`, in the component or in a `.ts` file) is refused with FV0326, a new entry
  of `ERRORS` in `ferrovue/compiler`, located at the field. The compile stopped with a `TypeError`.
- `defineProps<P>()` and `defineEmits<E>()` of a type imported from another file (a `.ts` file, a
  component or a package), directly, in an intersection, through a local alias or as the base an
  interface extends, are refused with FV0327, a new entry of `ERRORS` in `ferrovue/compiler`,
  located where the type is named. The compile stopped with Vue's "No fs option provided to
  `compileScript`" error and no FV code. Declare the props in the component, as
  `defineProps<{ row: Row }>()` or an interface of the component, whose fields may have imported
  types.
- Names holding `$` are written as Rust identifiers: a `<script setup>` binding (`const $label =
  computed(…)` is the local `s_label`), a prop (`price$` is the field `price`), a field of an
  interface or a constant list's objects (`$meta` is `meta`), a slot prop, a store's state and a
  loader's parameters keep their ASCII letters and digits, as the locals of a render do. A name that
  then comes to a Rust name another one holds takes `_2`, `_3`, …: `$tag` beside `tag` is `tag_2`.
  Fields keep `#[serde(rename)]` to the JavaScript name, so islands' props are unchanged. The Rust
  ferrovue wrote kept the `$` and did not compile, and a binding read in the template was not
  declared. A prop whose name starts with `$`, which Vue leaves out of the props and renders as an
  attribute, is refused with FV0328, a new entry of `ERRORS` in `ferrovue/compiler`. The
  conformance component `DollarNames` records names holding `$` from Vue.
- A `<template>` in another language than HTML (`<template lang="pug">`) is refused with FV0008,
  and a `<template src="./x.html">` with FV0009, both at the `<template>` tag. ferrovue compiled
  the pug source as HTML text and wrote it into the page, and rendered nothing for `src`, where
  Vite renders the template. `<template lang="html">` compiles as before. The two codes are new
  entries of `ERRORS` in `ferrovue/compiler`.
- A `<textarea>`, or an `<input>` with `v-model`, at a component's root is refused with FV0424,
  located at the element, which says to wrap it in an element. It was refused with two or three
  errors with no line (FV0513, FV0006, FV0631, FV0407) that did not name the cause: Vue's server
  renderer reads the `<textarea>`'s content, and the `<input>`'s `type` and `value`, from the
  attributes passed to the component. FV0424 also refuses such a control given `v-bind` of an
  object, an attribute named at run time or a custom directive, whose attributes Vue reads the
  same way. The README's Forms row says so. FV0424 is a new entry of `ERRORS` in
  `ferrovue/compiler`. The conformance components `FormWrapped` and `FormRoot` record the shapes
  that compile from Vue.
- A field typed as a union of string literals, read from a value built from an object literal
  (`function one(): R { return { t: props.s, e: "a" }; }` read as `{{ one().e }}` or
  `one().e === "a"`), is read through the generated enum's `as_str()` and compared by its variants.
  The Rust ferrovue wrote read the enum as a string and did not compile. The conformance component
  `LiteralEnumField` records it from Vue.
- `[].length`, and the length of `[]` handed to a parameter whose items have no type
  (`function f(xs: unknown[]) { return xs.length; }` read as `{{ f([]) }}`), is 0, as in
  JavaScript. The Rust ferrovue wrote gave the empty array no item type, and rustc refused it with
  E0282. The conformance component `EmptyArrays` records it from Vue.
- An element with no content given a custom directive listed in `clientDirectives`
  (`<b v-focus class="x" :id="id" />`) compiles, and renders its attributes and no content, as
  Vue does. It was refused with FV0513, with no line and a message about a component resolved by
  name. Vue's server renderer writes such an element's content from a `textContent` or
  `innerHTML` among the attributes it merges, so FV0425 refuses one whose merged attributes may
  hold them, at the attribute: those passed to the component, when the element is its root, a
  `v-bind` of an object, an attribute named at run time, and a bound `textContent` or
  `innerHTML`. FV0425 is a new entry of `ERRORS` in `ferrovue/compiler`. The conformance component
  `DirectedEmpty` records the shapes that compile from Vue.

## [0.10.0] - 2026-10-22

### Added

- The crate's side of loaders, for components that load their own data with a top-level
  `await` (the compiler's side is below): `ferrovue::load` renders, starts each call the render
  asks for, and renders again once calls have finished, until a render has every result; each
  loader starts when Vue's server would start it (siblings together, a component's children after
  its own loads, the awaits of one component in order), every call finished by a render is taken
  by it, so a render follows at most once per finished call, and a call is made once per key. The
  first loader to fail drops the others and returns a `LoadError`. `Loads::script_into` writes the
  results the render read as `<script type="application/json" data-fv-loads>`, escaped as the
  state script is, each under its key as the client's `JSON.stringify([name, ...args])` writes it.
  What only generated code calls (`Load`, `Loads::get`, `LoadKey`, `LoadArg`, `load_key`,
  `LoadCall`, `LoadFuture`) is hidden from the documentation.
- The compiler's side of loaders: a component may `await` a loader at the top of its
  `<script setup>` (`const post = await loadPost(props.slug)`, or destructured into plain names),
  where a loader is declared in a `.ts` file with `defineLoader("loadPost", async (slug: string,
  lang?: string): Promise<Post> => …)`, the new export of `ferrovue` and `ferrovue/client`. Its
  arguments are strings, numbers and booleans, optional or `null`, and its result any type a prop
  may have. The generated `loaders.rs` has a struct per loader's call, the `Loaders` trait the app
  implements with a method per loader, `dispatch` and `load`, which renders with
  `ferrovue::load`; each component that awaits a loader, or renders one that does, takes a
  `&Loads` after its other parameters, and is not an island. The render stops where the
  component awaits a result it does not have yet. In the browser, `defineLoader` answers a call
  from the page's `<script data-fv-loads>` by its key (`loadKey`), so the component hydrates from
  what the server read, and runs the loader otherwise; `createPageApp`, `mountPage` and
  `renderPage` wrap the layout in a `<Suspense>` when the page carries results (the new
  `suspense` option says otherwise), `readPage` gives a page's payloads as `loads`, which
  `renderPage` takes, and `provideLoads` and `clearLoads` add and forget results. A fixture gives
  results under `$loads`. Refusals have the new area FV20: an `await` of anything but a loader
  (FV2001), a declaration the compiler cannot read (FV2002), a parameter or result it cannot
  carry (FV2003, FV2004), two loaders with one name (FV2005), a call whose arguments do not match
  (FV2006) and a result bound to another pattern (FV2007). Generated code is version 4
  (`ferrovue::__compat!(4)`), which a 0.9 crate refuses. The conformance components `Loaded` and
  `LoadedComments` hold fixtures recorded from Vue, rendered by both and hydrated. The crate's new
  [`loaders`](https://docs.rs/ferrovue/latest/ferrovue/guide/loaders/index.html) guide describes
  both sides.
- The full-stack example awaits loaders. On the staff picks page, `StockLevel` awaits `loadStock`
  for the featured book and `Shipping` awaits `loadWarehouse` for the warehouse that result names,
  so the server renders the page in two rounds. The axum app implements `Loaders` from its
  catalogue, renders the page with `loaders::load`, writes `Loads::script_into` after the app, and
  answers the browser's loaders at `/api/stock/{id}` and `/api/warehouses/{code}`. Its tests
  hydrate the page in happy-dom, Chromium, Firefox and WebKit with no request to those routes, and
  follow a link to another pick, which renders from the results in the document it fetches. With
  it, `Loads` is covariant in its lifetime, so a component's `html()` takes the `&Loads` that
  `load` hands its closure; the client reads each `<script data-fv-loads>` once, one put into the
  document after an earlier read included; and `renderRecordedPage` compares a page inside a
  `<Suspense>` as the `<Suspense>` resolves, where `<ClientOnly>` still shows its fallback.
- Functions the template or a `computed` calls: declared in `<script setup>` (`function f(…) {}`,
  `const f = (…) => …`) or exported from a `.ts` file the component imports, whose bodies hold what
  a `computed`'s may and read props, refs, `computed`s, constants and other such functions. A call
  is translated where it is written, its arguments evaluated once and in order with the types they
  have there; parameters may be optional, have defaults, or be object patterns. A function from a
  `.ts` file thus needs no `helpers` entry. A function whose body the server cannot evaluate is
  refused where it is called, with FV0613 or FV0601 as before, the message naming the statement or
  expression and its line; recursion (FV1906) and `...rest`, `async`, generators, spread arguments
  or too many of them (FV1907) are refused, and so is a function declared with `const` that setup
  calls above its declaration, where JavaScript throws a `ReferenceError` (FV1908). A function only
  an event handler calls stays client-only. `ERRORS` in the `ferrovue/compiler` API report gains
  the three codes. The fuzzer generates local functions and calls them from templates and
  `computed`s.
- Statements in a `computed`'s body and in a list method's callback (`.map()`, `.filter()`,
  `.find()`, `.some()`, `.reduce()`, a `.toSorted()` comparator and the others): `const`, and
  `let` never assigned again, of any value the template may compute, destructured too; `if` /
  `else if` / `else` and early `return`, which narrow what follows as TypeScript narrows it (`if
  (!user) return ""; return user.name`); `switch` over a string or a number, with stacked `case`s,
  `default` and `break`. Each `const` is a Rust `let`, evaluated once where JavaScript evaluates
  it and only on the path that reaches it, and a `computed` that may throw is still evaluated
  where the render first reads it. Loops, assignments, `try`, `throw`, `var`, code after `return`
  and a path that ends without `return` are refused with the new codes FV1901 to FV1904, each
  naming the statement, and a body whose `if`s and `break`ing `case`s continue after them on more
  than 4096 paths (a run of such `switch`es) with FV1905, before translating it would take
  seconds; FV0806, an arrow function with a block body, is retired. The crate's new
  [`script_logic`](https://docs.rs/ferrovue/latest/ferrovue/guide/script_logic/index.html) guide
  describes what a body may hold. It needs no new version of generated code. `ERRORS` in the
  `ferrovue/compiler` API report gains the five codes and marks FV0806 retired.
- Lookup tables: an object constant, imported from a `.ts` file or declared with `const` in
  `<script setup>`, read by a key whose type is a closed set (a union of string or integer
  literals, or an `enum` of them), as `PAD[size]` with `size: "sm" | "md" | "lg"`. The object may
  be `as const`, typed `Record<Size, T>` or `Partial<Record<Size, T>>`, or untyped, with keys
  computed from enum members (`[Tone.Warn]: …`); the key may be a prop, a `computed`, a `v-for`
  item's field, or a `?:` or `??` of such values and literals. The read compiles to a `match` over
  the members, in text, attributes, `:class` and `:style`, and reads on by field
  (`THEME[tone].fg`). A member the object lacks reads `undefined`, as in JavaScript, narrowed with
  `??`, `?.` and `v-if` (`v-if="ICONS[kind]"`, then `ICONS[kind].label`). A key typed `string` or
  `number` stays refused (FV0222), now with a message that names the prototype fields such a key
  could reach and suggests a union type; a key that may be absent (FV0223), a field read without
  `?.` of a member that may be `undefined` (FV0224), members whose values differ in type (FV0225)
  and a missing member named like a field every object has, as `toString` (FV0226) are refused.
  `v-if` now also narrows a value read by a computed key, `list[i]` and `PAD[size]` alike. The
  conformance component `Lookups` holds fixtures recorded from Vue, and the fuzzer writes lookup
  tables keyed by its enum.
- `?:` whose branches differ in type where the value is only written out: in `{{ }}`, in a
  string-valued attribute (on an element, a component's root, a `<RouterLink>`, or falling through
  to a child) and in a template literal. Each branch is written as JavaScript writes it there:
  `{{ n > 0 ? n : "none" }}` writes the number by JavaScript's rules, an absent branch writes
  nothing in `{{ }}` and leaves an attribute out, and a template literal writes `undefined`,
  `null` and a list joined by `,`. Where the value is used otherwise (a child's prop, a
  comparison, a method, a boolean attribute, `:class`) the branches still have to be of one type
  (FV0623), and so do a list and a string in `{{ }}`, which Vue writes as JSON. The conformance
  component `MixedTernary` holds fixtures recorded from Vue, and the fuzzer writes such `?:` in
  text, attributes and template literals.
- `Object.entries(r)` outside a `v-for`: the list methods read its `[key, value]` pairs, in the
  record's order, with arrow functions that destructure each pair (`([key, value]) => …`,
  `([, value]) => …`, `([key, { id }]) => …`) or read its parts (`pair[0]`, `pair[1]`,
  `pair.length`): `.map()`, `.filter()`, `.reduce()`, `.some()`, `.find()` and the others, `.at()`,
  `.slice()`, `.toReversed()` and `.toSorted()` with a comparator of either part
  (`(a, b) => b[1] - a[1]`, `([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)`). A `computed` may keep the
  pairs and a `v-for` walk them (`[key, value] in Object.entries(r).filter(…)`), and `?.[1]` reads a
  pair `.find()` may not find. Each pair borrows from the record. A method that writes or compares
  whole pairs, `.join()`, `.includes()`, `.toSorted()` without a comparator and `.map()` to the
  pairs, is refused with FV0816, retitled for it.
- `.flat()` and `.flatMap()`. `.flat()` joins a list of lists to the depth it is given, a literal
  number or `Infinity` (1 when none); `.flatMap(f)` joins the lists `f` gives and keeps any other
  value as `.map()` would. `Object.values(r)` of a record of lists, which FV0815 refused, is now a
  list of lists, which `.flat()` joins and `v-for` walks; FV0815 is retired. A depth that is not a
  literal, and items that are optional, records or pairs, are refused with the new FV0834. The
  conformance components `Pairs` and `Flattened` hold fixtures recorded from Vue, and the fuzzer
  writes `Object.entries()` read by `.filter()` and `.map()`, and `.flatMap()`. They need no
  new version of generated code: both are Rust iterator adaptors.
- Imports through aliases. A component may import constants and types from a `.ts` file through an
  alias the project declares: the `compilerOptions.paths` and `baseUrl` of the tsconfig.json
  nearest it, after its `extends` (Nuxt's generated `.nuxt/tsconfig.json` included) and through
  the projects it `references` (create-vue's `tsconfig.app.json`), and, with the Vite plugin, the
  build's `resolve.alias`. `import { LABEL } from "@/lib/format"` used to be refused with a
  misleading FV0601 ("not available when rendering on the server"), where the same import by a
  relative path compiled. `--watch` and the Vite plugin regenerate on a change to those tsconfig
  files. See the crate's
  [`props`](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#imports-through-aliases)
  guide.
- FV0110: a name the server reads that is imported from a module no relative path or alias leads
  to a `.ts` file of the project (a package, a missing file, an alias the project does not
  declare). The message names the specifier and where it was looked for; FV0601 or FV0315 refused
  such a name without saying the import could not be resolved.
- `generate` and `write` of `ferrovue/compiler` take a last, optional argument, `{ aliases }`: the
  aliases tried before tsconfig's `paths`, as Vite's `resolve.alias` lists them (the types
  `ResolveOptions` and `Alias`), which the Vite plugin passes.
- A run reports every refusal it finds. Each component is checked on its own, and within a template
  each statement of the compiled render and each interpolation in it, so the CLI, `--check`,
  `--format json`, the Vite plugin and the `ferrovue/volar` plugin show all of a run's errors at
  once. The text output ends with a line that counts them (`3 errors in 2 components`). A component
  that uses a refused one is checked once that one compiles, and the count line says how many were
  left unchecked. Nothing is written while any error remains, and the exit status is unchanged.
  `generate` raises the new `GenErrors`, a `GenError` that carries the first refusal's code,
  location and message and holds every refusal in `errors`.
- A `= help:` line after a refusal's quoted line gives the way around it where one is short, for
  the template's calls of functions the server cannot run (FV0601, FV0613) and a list read by a
  date's month. `GenError` has the new `help`, and
  each diagnostic of `--format json` the new field `help` (`null` where there is none).
- Every code in the error index has a detail: what is refused, why, and the ways around it.
- The guide page [`upgrading_to_0_10`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_10/index.html):
  the steps from 0.9 (both halves bumped together, every component generated again for version 4),
  the error codes that changed for the same source, what behaves differently (every refusal at
  once, `GenErrors`, `readPage`'s `loads`), and what a component may now use.
- The guide pages [`porting`](https://docs.rs/ferrovue/latest/ferrovue/guide/porting/index.html)
  and [`support`](https://docs.rs/ferrovue/latest/ferrovue/guide/support/index.html). `porting`
  moves an existing Vue 3 server-rendered app to ferrovue: what is replaced and what stays, the
  configuration, the generated Rust, the server's data loading, routing, state and translations,
  how the client hydrates, the ways around a refusal, and a checklist for holding the output to
  Vue. `support` states the policy: one version line on npm and crates.io, fixes in a patch of the
  newest minor, the supported Vue, Node and Rust versions, deprecations, security reports, and how
  to report a bug or ask for a construct. The guide's index and the README's list of guides link
  to both.
- AGENTS.md, the instructions for coding agents working on ferrovue: the layout of the repository,
  and the rules for comments, prose, generated files, checks, pull requests and releases.

### Changed

- Generated code is version 4 (`ferrovue::__compat!(4)`), for loaders. The 0.10 crate builds
  versions 2 to 4, and the 0.9 crate stops the build of a version 4 module with a message that
  says what to do. Generate every component again after upgrading; the
  [`upgrading_to_0_10`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_10/index.html)
  guide gives the steps.
- Messages say what to do: FV1107 lists the types a helper or twin takes, FV1511 says
  `<ClientOnly>` leaves out the fallback there, FV1905 says to end the cases in `return`, and
  `release.ts members` says to use `version.workspace = true`. The guides and the code lose the
  comments that said what the code does.
- FV0601 names what the template wrote, and says where it comes from: `` `fmt()` calls a function
  imported from `./util`, a module the server does not run ``, where it named Vue's internal
  `$setup`.
- Messages name syntax in words: "an arrow function", "an object literal", "a tuple type", where
  they gave Babel's node types (`ArrowFunctionExpression`).
- A template's read of a constant the compiler cannot evaluate, from the component or a `.ts` file,
  is refused with the constant's own code (FV0201 to FV0222) at the constant, and names where the
  template reads it; `ferrovue/volar` shows it at the read. It was FV0613 at the read.
- FV0824 for a list read by `[d.getUTCMonth()]` says the index is `NaN` for an invalid date.
- FV0221, FV0803 and FV1509 are retired: no input could raise them. FV1001's title is "Spread or
  method in a class object", and FV0908's covers a provided value too.
- The `errors_and_limits` guide says where a `<script>` element in a template is allowed: Vue's
  server keeps it, its client compiler drops it, so a component that writes the document with its
  `<script type="module">` renders on the server only and never hydrates.
- The deprecation warnings FV1117 and FV1118 say a deprecated key or option goes in a later minor
  release, and their entries in the error index, the README and CONTRIBUTING.md say it goes in a
  later minor release before 1.0 and only in a major release from 1.0, as RELEASING.md says. They
  said "the next major release".
- The README's note on upgrading moves from its introduction to the Versions section, without
  naming a release: what a minor and a patch release may change, and where the CHANGELOG and the
  upgrade guides are.
- Tests only: the CLI's three `--watch` tests share one helper that repeats each change until the
  watcher reports it, since macOS can miss a change made just after a watch starts.
- Tests only: the differential fuzzer generates loaders. A case may have a `fz-loaders.ts` of
  `defineLoader` declarations over string, number, `Float` and boolean parameters (plain,
  optional, `| undefined` and `| null`) returning any type a prop may have, awaited at the top of
  `<script setup>` with arguments read from props, literals, `null`, `undefined`, arguments left
  out and earlier results, sometimes the same call twice, destructured or bound to nothing, and
  read in `computed`s and the template. A child awaits loaders of its own and may render a child
  that does too. Each fixture's `$loads` has a result for each call the render makes, keyed with
  `loadKey`, and the shrinker shrinks the awaits, their arguments and the results.
- Tests only: a TypeScript test may take 30 seconds, where vitest's default is 5, so a test that
  runs the CLI as a child process passes on a slow Windows runner.
- CI only: the browser job's system libraries install in up to three attempts of six minutes each,
  so a package mirror that stalls fails one attempt and the job tries again.

### Fixed

- `?:` between two objects read from props hands out a reference to the one chosen, where it
  moved it out of the props and did not build; a computed list chosen by `?:` is collected once.
- An object constant written with `__proto__:` is refused (FV0206): the key sets the object's
  prototype, whose fields JavaScript reads as the object's own.
- A child's prop typed `n?: number`, `n?: Float` or `n: number | null` (and `b: boolean | null`)
  may be given a value of the same optional or nullable type, such as a loader result's optional
  field: it was refused with FV0511. FV0511 names both types in words.
- In the generated `render_json`, which renders a component that awaits loaders once per round of
  `ferrovue::load`, each round collects its own teleports and head, so a `<Teleport>` or `useHead`
  is written once; they were written once per round. The generated `loaders::from_fixture` reads
  each result from the fixture's own JSON text, so a `Record` in a result keeps JavaScript's order
  of keys; it went through `serde_json::Value`, which sorts them. The `ferrovue` crate enables
  `serde_json`'s `raw_value` feature, which `from_fixture` uses. The conformance components
  `LoadedRanks` and `RankLine` hold fixtures recorded from Vue, found by the fuzzer.

## [0.9.0] - 2026-10-20

### Added

- `Date` props: a prop the component types `Date`, optional (`edited?: Date`) or nullable
  (`deleted: Date | null`) too, read with `.toISOString()`, `.getTime()`, `.valueOf()` and the
  `.getUTC…()` methods in the template, a `computed`, `v-if` and `v-for`, and handed to a child's
  `Date` prop. Its Rust field is `ferrovue::JsDate` by default: a JavaScript time value, invalid
  dates included, built with `JsDate::from_millis`, `JsDate::parse` (the strings the template's
  `new Date(s)` accepts), `JsDate::now` or `From<SystemTime>`, with `Serialize` and `Deserialize`.
  The new configuration key `dateType` names another Rust type, which implements the new trait
  `ferrovue::JsTime`, through which generated code reads either, clipping what it returns as
  `new Date(value)` does. An island's `data-props` carries a date as its ISO string and an invalid
  one as `NaN`, and `mountIslands`, `mountPage`, `renderPage` and `fixtureApp` turn each prop the
  component declares a `Date` back into one before Vue hydrates, so the browser reads the time
  value the server read, in any time zone.
  `reviveDates(component, props)`, exported from `ferrovue` and `ferrovue/client`, does the same
  for an app that reads a component's props from JSON itself.
- The `chrono` feature, off by default: `JsTime` for `chrono::DateTime<Utc>`, to name as
  `"dateType": "chrono::DateTime<chrono::Utc>"`, `From<DateTime<Utc>>` for `JsDate`, and
  `TryFrom<JsDate>` for `DateTime<Utc>`, which fails with `ferrovue::DateOutOfRange` for an invalid
  date and for one beyond chrono's ±262,142 years. JavaScript's dates reach from −271821 to
  +275760, so the parsing and the `getUTC…` twins stay ferrovue's own, held to `dates.json`.
- FV1806, for a `Date` anywhere but a component's own prop: inside a list, a dictionary or an
  object prop, in Pinia state, `inject`, `ref` or `defineModel`, which would reach the client as a
  string.
- `.toPrecision()` and `.toExponential()` of a number, with no argument or a literal one, written
  as V8 writes them: rounded from the exact value of the double, an exact tie away from zero, with
  JavaScript's choice between fixed and exponential notation and its `e+N` exponent.
  `toPrecision()` without an argument is `String(x)`, and `toExponential()` without one writes the
  shortest digits that read back as the number. The crate gains their twins, `js_to_precision` and
  `js_to_exponential`, held to 9,672 vectors recorded from Node in `precision.json`: hand-written
  edges (ties, carries, `-0`, subnormals, 10²¹ and beyond, the largest double), every argument from
  0 to 100 for a third of them, and 1,500 numbers drawn across the exponents.
- FV0716 and FV0717, for `.toPrecision()` with an argument other than a literal from 1 to 100 and
  `.toExponential()` with one other than a literal from 0 to 100, where JavaScript throws a
  `RangeError` or the compiler cannot know the argument.
- More of `Date`, as V8 computes it: `.toUTCString()` (`Thu, 01 Jan 1970 00:00:00 GMT`, years
  beyond four digits and before year 0 as V8 writes them, `Invalid Date` for an invalid date);
  `.toJSON()`, a `string | null` that is `null` for an invalid date, written as nothing in `{{ }}`
  and leaving a bound attribute out; `JSON.stringify()` of a date, its ISO string quoted or `null`;
  `Date.UTC()` of one to seven numbers, each truncated, a year from 0 to 99 read as 1900 to 1999,
  parts carried into the next, `NaN` beyond the range, and literal parts worked out when compiling;
  and `<`, `<=`, `>` and `>=` between two dates, which compare their time values and are false when
  either is invalid. The runtime's `js_to_utc_string`, `js_to_json`, `js_json_date` and
  `js_date_utc` are held to new vectors in `dates.json`, recorded from Node and read alike by
  Chromium and Firefox, and to the new `DateFormats` conformance component.
- FV1807, for `Date.UTC()` of no parts, more than seven, or a part that is not a number that is
  present; FV1808, for literal parts of `Date.UTC()` that V8 computes by rules Firefox and Safari do
  not share (a year beyond ±1,000,000, a month beyond ±10,000,000, a year before −399,999, or a
  part beyond 2⁵³ ms brought back within the range), on which `js_date_utc` panics when they come
  from the props; FV1809, for `===`, `!==`, `==` and `!=` with a `Date`, which compare whether two
  dates are one object, with a message that says to compare `.getTime()`.
- `Number.isNaN()`, `Number.isFinite()`, `Number.isInteger()` and `Number.isSafeInteger()` of a
  number, an integer or a `Float`, present or optional (`false` when absent), and the global
  `isNaN()` and `isFinite()` of a present number, wherever a boolean goes: text, attributes,
  `v-if`, `v-show`, `computed`, arrow functions, `&&`, `||` and `!`. A date's validity is now
  tested with `!Number.isNaN(d.getTime())` too, beside `d.getTime() === d.getTime()`.
- `||` between dates, the left one optional or nullable too (`edited || posted`): a date is always
  truthy, an invalid one included, so it gives the left date when present, as `??` does.
- FV0718, for `Number.isNaN()` and its kin of a value that is not a number, for which they are
  always `false` (`Number.isNaN(s)` of a string, `Number.isFinite(d)` of a date), and for the
  global `isNaN()` and `isFinite()` of anything but a present number, which they would convert:
  the message points to `Number.isNaN(Number(s))` and `Number.isNaN(d.getTime())`.
- List items by index: `list[i]` with an integer `i`, and `list.at(i)`, which counts from the end
  when `i` is negative. Either is `T | undefined`, `undefined` outside the list, narrowed by `v-if`
  (`v-if="rows[0]"`) and taken by `??`, `?.` and `{{ }}` as other optional values are; `list?.[i]`
  reads an item of an optional list. An index that is a `Float`, a string or a value that may be
  absent is refused with FV0824, and `.at()` given anything but one number with FV0825.
- Optional chains that go on past `?.`: `s?.length`, `s?.trim()`, `user?.profile.bio`,
  `s?.trim().length`, `tags?.at(-1)?.toUpperCase()`, with every property and method the value has
  when present. Once the value is absent, the whole chain is `undefined`, as in JavaScript.
  `f?.()` is refused with FV0629, and `??` from a list such a chain computes to another list with
  FV0630 (`?? []` is accepted).
- `.indexOf()` and `.lastIndexOf()` of a list, compared with `===`: `NaN` is found nowhere and `-0`
  is found as `0`. A value of another type, or a position to start from, is refused with FV0826.
  `.findLast()` and `.findLastIndex()` take what `.find()` and `.findIndex()` take. `.concat()`
  joins lists of one item type, or of numbers whether `number` or `Float`, and refuses others with
  FV0827. Generated code calls the new `#[doc(hidden)]` `js_item_at` for `.at()`, part of
  version 3.
- `.reduce()` and `.reduceRight()` of a list with an initial value, whose arrow function takes the
  accumulator, the item and its index. The accumulator is a string, a number or a boolean, its type
  fixed from the initial value and the function's body: an integer start whose body gives a
  fraction, or may give `-0`, accumulates a `Float`, and strings join by `+` with the rules of
  `+` itself, so a function joining strings that may hold halves of surrogate pairs is refused
  with FV0706. Without an initial value either is refused with FV0828, since JavaScript throws on
  an empty list, and an accumulator of another type, or a body that changes its type, with FV0829.
- `.toReversed()`, and `.toSorted()` without a comparator, which orders the items by `String(x)`
  compared by UTF-16 code unit as JavaScript does (`[10, 9, 1]` sorts to `[1, 10, 9]`, `NaN` among
  the letters), or with a comparator of a shape the server orders by exactly: `(a, b) => a - b`,
  `b - a`, `a.k - b.k` and `b.k - a.k` over integers, and `?:` over `<`, `>`, `<=`, `>=`, `===`
  and `!==` of integers or strings giving numbers whose signs make a consistent order (`a < b ? -1
  : a > b ? 1 : 0`). The sort is stable, as in V8 and SpiderMonkey. Other comparators are refused
  with FV0830, a `Float` key among them, since a `NaN` makes the comparator inconsistent and each
  engine orders the items its own way; a list of objects without a comparator with FV0831; and a
  `localeCompare` comparator with FV1805. `[...list].sort(…)` and `[...list].reverse()` are the
  same as `.toSorted(…)` and `.toReversed()`, and `.sort()` and `.reverse()` of a prop or state,
  which change it in place, are refused with FV0832, pointing to them.
- Spread in array literals, `[...a, x, ...b]`, of lists and values of one item type, numbers whether
  `number` or `Float`, and of lists of objects of one type; anything else is refused with FV0833.
  `Math.max(...xs)` and `Math.min(...xs)`, beside other numbers too, fold the items as JavaScript
  does: `-Infinity` and `Infinity` for no items, `NaN` when any is, and `-0` below `0`. Generated
  code calls the new `#[doc(hidden)]` `js_reduce`, `js_sorted`, `js_sorted_by_string` and
  `js_order`, part of version 3.
- `encodeURIComponent()` and `encodeURI()` of a string, or of anything `String()` writes, encoded
  as JavaScript encodes them: each byte of a character's UTF-8 as `%XX` in upper case, except the
  ASCII letters and digits, `-_.!~*'()` and, for `encodeURI()`, `;/?:@&=+$,#`. `ferrovue-core`
  gains `js_encode_uri_component` and `js_encode_uri`, re-exported by `ferrovue`, held to the new
  `uri.json`: every ASCII character, hand-written edges and 450 strings drawn at random, 1,202
  vectors recorded from Node. A string that may hold half of a surrogate pair, on which JavaScript
  throws a `URIError`, is refused with FV0706.
- `String()`, template literals and `.concat()` of a value that may be absent, which JavaScript
  writes as `undefined`, or `null` for a nullable one, and of a list of strings, numbers, booleans
  or nullable items, written as its items joined by `,` with an absent item as nothing. `{{ x }}`
  keeps Vue's own rule, nothing for an absent value. A value that may be either `null` or
  `undefined` is refused with FV0721, and one `String()` cannot write, such as an object, with
  FV0723. Generated code calls the new `#[doc(hidden)]` `JsOr` for an optional number or boolean.
- Positions and limits in string methods, counted in UTF-16 code units and clamped as JavaScript
  clamps them: `.includes(x, i)`, `.startsWith(x, i)`, `.endsWith(x, i)`, `.indexOf(x, i)` and
  `.lastIndexOf(x, i)`, a position inside a surrogate pair included, and `.split(x, n)` with the
  limit taken as `ToUint32` takes it; a position or a limit that is `undefined` or an absent
  optional number is JavaScript's default. Also `.substr()`, `.trimLeft()`, `.trimRight()`,
  `.concat()` of strings, `.charCodeAt()` and `.codePointAt()`, the last two refused with FV0706 of
  a string that may hold half of a pair. Generated code calls the new `#[doc(hidden)]`
  `js_includes_from`, `js_starts_with_at`, `js_ends_with_at`, `js_index_of_from`,
  `js_last_index_of_from`, `js_split_limit`, `js_substr`, `js_char_code_at` and
  `js_code_point_at`, held to 8,208 new vectors in `strings.json`.
- `Math.sqrt()`, `Math.sign()` (`ferrovue-core`'s new `js_sign`, re-exported by `ferrovue`: `0`,
  `-0` and `NaN` are their own sign), the eight constants of `Math` and those of `Number`, and the
  globals `Infinity` and `NaN`. `**` and `Math.pow()` are worked out when compiling, of an integer
  and a whole exponent from 0 that are both known, with a result within ±2⁵³, which every engine
  gives exactly. `math.json` gains 1,458 vectors recorded from Node: `Math.sqrt` and `Math.sign` of
  hand-written edges and drawn doubles, the constants, and 776 such powers; the browser tests check
  that each browser computes `math.json` and `uri.json` as Node recorded them.
- `typeof`, worked out from each value's type: `"string"`, `"number"`, `"boolean"`, `"object"` for
  objects, lists, records, dates and `null`, and of an optional value its type when present and
  `"undefined"` (or `"object"` for a nullable one) when absent, so that `typeof x === "string"` and
  `typeof x !== "undefined"` narrow it in `v-if`, `&&` and `?:`. FV0722 refuses a comparison that
  depends on whether a value that may be `null` or `undefined` is which, and `typeof` of a value of
  a plugin's own type.
- FV0719, for `Math.cbrt()`, `Math.hypot()`, `Math.exp()`, `Math.log()`, the trigonometric
  functions and their kin, which engines round by their own routines; FV0720, for any other `**`
  or `Math.pow()` (Node 22 writes `10 ** -20` as `1.0000000000000001e-20`); FV0631, for `in` and
  `instanceof`; FV0632, for the bitwise and shift operators; FV0633, for a part of `JSON`, `Math`,
  `Number`, `String`, `Array` and JavaScript's other globals that the server does not translate,
  naming what it translates of the one used.
- The guide pages [`upgrading_to_0_9`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_9/index.html)
  and [`upgrading_to_0_8`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_8/index.html),
  for a project moving from 0.8 and from 0.7: the steps to take (the versions to bump, the modules
  to generate again, the Rust and the error codes that change), the behaviour that changed, and
  what is newly supported, each linking to the page that covers it. The README's list of guides,
  its versions paragraph and the `generated_code` page's version check link to them, and
  CONTRIBUTING.md names the Node versions CI tests: 22.18, 22, 24 and 26.

### Changed

- Generated code is version 3 (`ferrovue::__compat!(3)`): a `Date` prop calls `JsTime`, the
  `#[doc(hidden)]` `js_time_of` and `js_date_prop` and the serde helpers `date_prop` and `opt_date_prop`, which the
  0.8 crate lacks. The crate still builds modules of version 2, which call nothing that changed.
- The API reports gain `reviveDates` (`ferrovue`, `ferrovue/client`) and `Config.dateType` and
  FV0629 to FV0633, FV0716 to FV0723, FV0824 to FV0833 and FV1806 to FV1809, FV0604's title names
  a value that may be absent, FV0610's names a hole alone, FV0706's and FV0708's titles name what
  they now cover, and FV1234 is retired (`ferrovue/compiler`).
- `in`, `instanceof`, `**` and the bitwise operators are refused with FV0631, FV0720 and FV0632,
  whose messages say what each does, where FV0619 named `==`; FV0619 is now raised for `==` and
  `!=` alone. A part of `JSON`, `Math`, `Number`, `String` or another global that the server does
  not translate (`JSON.stringify(x, null, 2)`, `JSON.parse()`, `String.fromCharCode()`,
  `decodeURIComponent()`) is refused with FV0633, naming what it translates, where FV0601 said the
  whole global was not available. `typeof` of anything but a query value, which the router refused
  with FV1234, is the core's now, and FV1234 is retired.
- `Math.exp()`, `Math.log()`, the trigonometric functions and their kin are refused with FV0719
  where they were FV0704. A `Date` prop compiles where it was refused with FV0315, and a `Date`
  inside a list, a dictionary or an object prop is refused with FV1806 where it was FV0315.
- Generated code of version 3 also calls the `#[doc(hidden)]` `js_to_utc_string`, `js_to_json`,
  `js_json_date` and `js_date_utc`. FV0609 names two dates beside two numbers and two strings, and
  `==` or `!=` with a date is refused with FV1809 where it was FV0619.
- `.toFixed()` takes a fractional literal, truncated as JavaScript truncates it (`toFixed(2.5)` is
  `toFixed(2)`), and `undefined`, which is `toFixed(0)`; it refused both before.
- The guide's examples of a refusal (the CLI's message, `--format json` and the editor) show
  `{{ n.toLocaleString() }}`, refused with FV1805, now that `.toPrecision()` compiles.
- The README is a landing page: what ferrovue is and why to use it, the quick start, what a
  component may use, a list of the guides, performance, versions and the licence, with the
  crates.io and npm version badges side by side, then docs.rs, CI and the licence. Its reference
  sections moved into the crate guide: constants into `props`, `<ClientOnly>` and Rust twins into
  `errors_and_limits` (which also holds the list of what is refused), fixtures in an application's
  own vitest tests (`fixtureApp`) into `testing`, an island whose name is unknown and the islands'
  stylesheets into `islands_and_hydration`, and the `stream` feature into `streaming`; the other
  sections were covered by their guide pages already. The repository layout and the benchmark
  commands moved into CONTRIBUTING.md. The quick start names the 0.8.0 schema, and the guide's
  `Cargo.toml` lines version 0.8.
- Tests only, with no change to the crates or the npm package: the differential fuzzer generates
  dates. Components get required, optional and nullable `Date` props, read with `.getTime()`,
  `.valueOf()` and the `.getUTC…()` methods in text, attributes, conditions and loops, narrowed in
  `v-if`, chosen with `?:` and `??`, held in a `computed` and handed to a child's `Date` prop that
  hands it on to its own child; `new Date()` of an ISO literal, of a number and of another date,
  and `Date.parse()` of an ISO literal, in any component. `.toISOString()` is read from a date the
  template has tested with `d.getTime() === d.getTime()`, directly or through a `computed` the
  render reads only under that test. Each fixture's dates come from `test/date-inputs.ts`, the
  strings and time values `dates.json` records: ISO strings across the range of years, expanded
  years and both edges, numbers with fractions, and invalid dates. It also writes
  `.toUTCString()`, `JSON.stringify()` and `.toJSON()` of any date, `Date.UTC()` of one to seven
  parts wherever a number goes, and `<`, `<=`, `>` and `>=` between two dates in conditions.
- Tests only: the differential fuzzer generates `.toPrecision()` and `.toExponential()` of any
  number, without an argument and with whole and fractional literals in range, and the conformance
  suite gains `Precision`, ten fixtures recorded from Vue.
- Tests only: the differential fuzzer generates `Number.isNaN()`, `Number.isFinite()`,
  `Number.isInteger()` and `Number.isSafeInteger()` of integers, fractions and optional numbers,
  `isNaN()` and `isFinite()` of numbers, wherever a boolean goes, tests a date's validity with them
  as well as with `d.getTime() === d.getTime()`, and chooses dates with `||`.
- Tests only: the differential fuzzer generates `encodeURIComponent()` and `encodeURI()`,
  `String()` and template literals of optional and nullable values and of lists, `.substr()`,
  `.concat()`, `.trimLeft()`, `.trimRight()`, `.charCodeAt()`, `.codePointAt()`, positions in
  `.includes()`, `.startsWith()`, `.endsWith()`, `.indexOf()` and `.lastIndexOf()`, limits in
  `.split()`, `Math.sqrt()`, `Math.sign()`, the constants of `Math` and `Number`, `**` and
  `Math.pow()` of literals, and `typeof` compared with each type's name and narrowing in `v-if`;
  the conformance suite gains `UriParts`, `StringOf`, `StringSearch`, `MathMore` and `TypeofTests`,
  23 fixtures recorded from Vue.
- Tests only: the differential fuzzer generates list items by index (`[i]` with literal, negative and computed indices, and `.at()`) read with
  `??`, with a method after `?.` and by a field of an object; `.indexOf()`, `.lastIndexOf()`,
  `.findLast()`, `.findLastIndex()` and `.concat()`; and optional chains from optional and nullable
  strings and numbers through string methods, `.split()` and list reads.
- Tests only: the differential fuzzer generates `.reduce()` and `.reduceRight()` into strings,
  numbers and booleans, `.toReversed()`, `.toSorted()` with and without comparators of each shape
  the compiler accepts, `[...list].sort()` and `[...list].reverse()`, spread in array literals and
  `Math.max(...xs)` and `Math.min(...xs)`. A name the template reads only after `...` is now
  declared in the component's script, as any other name it reads is. The conformance suite gains
  `ListBuilding`, seven fixtures recorded from Vue.
- Tests only: the CLI's `--watch` test writes a component again until the watcher reports it, since
  macOS can miss a change made just after a watch starts.
- FV0610's title and message name a hole in an array literal alone: a spread compiles now, or is
  refused with FV0833.

### Fixed

- A truthiness test that is not a narrowing, such as `Boolean(user)`, of an optional or nullable
  object, list or `Date` wrote a closure whose parameter it never read (`is_some_and(|v| true)`),
  on which rustc warns; it is now `is_some()`.
- `.includes()` of a computed list, or of a list of fractions, looking for a `v-for` item named `v`
  compared each item with itself, and was `true` for every list that was not empty.
- FV0604 for `.length` or another field of an optional value says that it may be absent, and to
  narrow it with `v-if` or read it with `?.`. It said the value was not an object.
- A template literal that joined two strings that may each hold half of a surrogate pair with only
  a string that may be empty between them (`` `${a.charAt(0)}${b}${a.slice(1)}` ``) was accepted,
  and wrote two U+FFFD where JavaScript, given an empty `b`, joins the halves into one character;
  it is refused with FV0706, as two such strings side by side are.
- Tests only: the differential fuzzer drew a list to spread beside another (`[...a, ...b]`), and
  the fallbacks of `.at()`, `.codePointAt()` and list reads and the count of `.repeat()`, each time
  it printed the component rather than once, so the props it pruned as unread could differ from
  those the printed template read. The nightly run of 2026-10-20 failed on such a component,
  refused for reading `l0` after `l0` was pruned.

## [0.8.0] - 2026-10-18

### Added

- Dates in templates, in the part of `Date` that reads the same on the server and in every
  browser: `new Date(s)` and `Date.parse(s)` of a string in ECMAScript's date time string format
  (a date alone, or a date and time with a `Z` or an offset; four-digit and expanded years),
  `new Date(ms)` of a number, and `.toISOString()`, `.getTime()`, `.valueOf()` and the
  `.getUTC…()` methods, invalid dates included. Generated code calls the runtime's twins
  (`js_date_parse`, `js_time_clip`, `js_to_iso_string` and `js_utc_full_year` to
  `js_utc_milliseconds`, `#[doc(hidden)]` as the other twins are), held to vectors recorded from
  Node (`tests/vectors/dates.json`), which Chromium, Firefox and WebKit read alike in four time
  zones. A date literal outside the format is refused when compiling (FV1803), and
  `js_date_parse` panics on a string from the props outside it, which browsers may each read
  differently. Both refuse a date and time whose fields, read as UTC, lie beyond ±8.64 × 10¹⁵ ms
  while its offset brings it within (`+275760-09-13T01:00+01:00`), which Safari reads as an invalid
  date and the other engines as a valid one.
- Error codes in a new area, FV18xx, each pointing to the new guide page `dates_and_prices`:
  FV1801 for the current time (`new Date()`, `Date.now()`), FV1802 for `new Date` of anything but
  one present string or number, FV1803 for a date string outside the format, FV1804 for the local
  getters and the other `Date` methods, and FV1805, permanent, for `Intl`, `.toLocaleString()`,
  `.toLocaleDateString()`, `.toLocaleTimeString()`, `.localeCompare()` and vue-i18n's `$d` and
  `$n`. `new Date(…)` used to be refused as FV0624 and `.toLocaleString()` as FV0602.
- The guide page `dates_and_prices`: dates in a template, prices and formatted dates written in
  Rust and passed as strings or filled into vue-i18n messages, end to end, with the `Dates` and
  `Prices` conformance components.

### Changed

- **Breaking:** generated code is version 2 (`ferrovue::__compat!(2)` at the top of `mod.rs`): it
  calls the date twins this release adds, and builds `RouteDef`, `i18n::Locale`, `i18n::Message`
  and `i18n::Args` with their constructors. The `ferrovue` crate accepts version 2 alone, so
  modules generated by 0.7 must be generated again: run `ferrovue` with the 0.8 npm package. A
  0.8 crate stops a 0.7 module at that line, and a 0.7 crate stops a 0.8 module there, each with
  what to do.
- **Breaking:** `ferrovue::RouteDef` (`ferrovue_router::RouteDef`) and `ferrovue::i18n::Locale`,
  `Message` and `Args` (`ferrovue_i18n::…`) are `#[non_exhaustive]`, so a later release can add a
  field. Their fields stay public to read. Code outside the crates can no longer build one with a
  struct literal, and a pattern that destructures one ends in `..`. Build them with the new `const`
  constructors: `RouteDef::new(path)` with `.with_name(name)`, `.with_view(false)` and
  `.with_children(&[…])`; `Locale::new(name, &[(key, message), …])`; `Message::new(&[case, …])`;
  and `Args::new()` with `.with_named(&[…])`, `.with_list(&[…])` and `.with_plural(n)`, which
  replaces `Args { plural: Some(n), ..Args::default() }`.
- **Breaking:** `ferrovue::HeadHtml` and `ferrovue::Link` (`ferrovue_router::Link`) are
  `#[non_exhaustive]`, so a later release can add a field. Their fields stay public to read. Code
  outside the crates can no longer build either with a struct literal, and a pattern that
  destructures one ends in `..`. Start from `HeadHtml::default()` and set its fields, and take a
  `Link` from `Route::link`, `link_named` or `link_path`.
- **Breaking:** the runtime functions only generated code calls are `#[doc(hidden)]`, outside the
  API `cargo-semver-checks` holds to semver: `js_length`, `js_trim`, `js_trim_start`,
  `js_trim_end`, `js_slice`, `js_substring`, `js_at`, `js_char_at`, `js_index_of`,
  `js_last_index_of`, `js_split`, `js_replace`, `js_replace_all`, `js_pad_start`, `js_pad_end`,
  `js_repeat`, `js_cmp`, `js_json_string`, `js_json_number`, `js_number`, `js_parse_int`,
  `js_parse_float`, `js_slice_range`, `js_slice_items`, `class_into`, `class_object`,
  `class_names`, `style_text_into`, `merge_props`, `scope_attrs`, `slot_into_slotted`,
  `scoped_slot_into`, `scoped_slot_into_slotted`, `teleport_into` and `trusted_into`. Each keeps its
  path and signature in this release, so code that calls one still compiles; from now on a release
  may change one along with the version of generated code that `__compat!` checks. An application
  that calls one of them itself (a test holding its own helper to JavaScript's `trim`, say) keeps
  its own copy, or asks for the function to be made public again. What an application calls or
  implements stays documented: the numbers of `ferrovue-core`, `slot_into`, `attrs_into`,
  `passed_attrs_into`, `query_into`, and every type. CONTRIBUTING.md's new "The crates' contract"
  section sets out the rules.
- `Slot::new`, `Part::new`, `Page::slot`, `PageRecord::script`, `HeadValue::object`,
  `Chunks::for_islands` and `Chunks::for_source` are `#[must_use]`: a call whose result is dropped
  warns.
- A number compared with itself (`x === x`, true unless `x` is `NaN`) compiles to `!x.is_nan()`,
  which Clippy accepts in generated code.
- A call of a setup binding the server cannot evaluate (`const { d } = useI18n()`, then `d(x)`)
  is refused as FV0613 with the reason, where it was refused as FV0601 naming `$setup`.
- The npm package compiles with `@vue/compiler-sfc` 3.5.44, and the conformance fixtures are
  recorded from Vue 3.5.44, vue-router 5.4.0, Pinia 4.1.0, vue-i18n 11.4.15 and `@unhead/vue`
  3.4.3, which render every fixture as the previous versions did. The peer ranges follow them:
  `vue` `~3.5.44`, `vue-router` `~5.4.0` (was `~5.3.1`), `pinia` `~4.1.0` (was `~4.0.3`),
  `vue-i18n` `~11.4.15` and `@unhead/vue` `~3.4.3`. The package depends on `postcss` `^8.5.30`
  and `@intlify/message-compiler` 11.4.15.
- `ferrovue` and `ferrovue-router` require `serde_json` 1.0.154, and `ferrovue`'s `actix-web`
  feature actix-web 4.17.0. The repository develops and tests with tokio 1.53.3, proptest 1.12,
  happy-dom 21, vitest 5.0.5, Playwright 1.64.1, oxlint 1.88 and fallow 3.34, and its `Cargo.lock`
  and `pnpm-lock.yaml` take the latest patch and minor releases Rust 1.89 and pnpm's one-day
  minimum release age allow.
- CI only, with no change to the crates or the npm package: CI installs Rust with
  `dtolnay/rust-toolchain` at its current `master` commit, which zizmor checks the pin's comment
  against.
- CI only, with no change to the crates or the npm package: the weekly mutation-testing workflow
  runs each test binary with 4 GiB of address space, on any runner architecture. A mutant that
  allocates without end now aborts its test, which counts as caught, where it used to exhaust the
  runner's memory and end the whole shard.
- CI only, with no change to the crates or the npm package: the mutation-testing workflow runs in
  eight shards, which take turns through the list of mutants, and gives each mutant's tests 90
  seconds. Two of its four shards used to reach the job's 90-minute limit before they finished.
- CI only, with no change to the crates or the npm package: the mutation-testing workflow posts no
  GitHub annotation for each surviving mutant, which put a warning on every run for each of the 47
  known equivalents. A survivor `.cargo/mutants-equivalent.txt` does not list is still named in
  the shard's summary and fails the job.
- CI only, with no change to the crates or the npm package: performance budgets. The
  **Instruction counts** job runs the benchmark scenarios under Callgrind with gungraun 0.20, built
  with Rust 1.99.0 for `x86_64-unknown-linux-musl` on `ubuntu-24.04`, uploads the counts as the
  `instructions` artifact, and fails when one runs more than 5% more instructions than
  `crates/ferrovue/benches/instructions.json` records (`pnpm bench:instructions`). The committed
  counts come from that artifact (`pnpm bench:instructions:from-ci`); while the file is a
  placeholder the job only records, and on a release tag it fails. The **Build-time budgets** job
  generates a 500-component project and fails when `ferrovue` takes over 10 s on it, or
  `cargo build` of the generated modules over 60 s (dev) or 90 s (release) (`pnpm budget:build`).
  TESTING.md describes both.
- Tests only, with no change to the crates or the npm package: vectors recorded from Vue and
  vue-router for attribute and style keys in capitals, a `--` custom property with capitals and a
  child route with an absolute path under a matchable parent, `BasicHtml` references of the
  longest length, `ManifestError::source` and a debug build's panic on props serde_json refuses.
  Each closes a gap the mutation run found; `.cargo/mutants-equivalent.txt` gives the reason for
  five more survivors that cannot change what the code returns, and no longer lists `plural_choice`
  with its `-` deleted, which a unit test catches.
- Tests only, with no change to the crates or the npm package: `TESTING.md` traces each row of the
  README's "What a component may use" table to the conformance components that exercise it, and
  `scripts/traceability.test.ts`, part of `pnpm test`, fails on a row left out, a row the README no
  longer has, or a component that is not in the suite with fixtures. Two conformance components
  are new, with fixtures recorded from Vue: `BoundObject` (`v-bind` of an object literal on
  elements, beside their own attributes, class and style) and `HeadServer` (`useServerHead` and
  `useServerSeoMeta` beside `useHead`, `tagPriority` and `tagDuplicateStrategy`).
- Tests only, with no change to the crates or the npm package: `fuzz/` holds cargo-fuzz targets
  for `escape_into`, an island's `data-props`, the state script and the attribute writers, each
  checked against a reference written in the fuzz crate and read back (escaped text to its input,
  JSON to its value through serde_json). The nightly fuzz workflow runs each for ten minutes, and
  CI checks the fuzz crate's formatting and, with cargo-deny, its dependencies; `deny.toml` allows
  the NCSA licence of `libfuzzer-sys`'s bundled libFuzzer.
- CI only, with no change to the crates or the npm package: the workflows run
  `actions/setup-node` 7.1.0, `actions/upload-artifact` 7.0.2, `actions/download-artifact` 8.0.2
  and `taiki-e/install-action` 2.87.27, each pinned to the commit its tag names.
- CI only, with no change to the crates or the npm package: `.github/zizmor.yml` lets the
  `dtolnay/rust-toolchain` pin in `.github/actions/rust/action.yml` name `master`, a branch with no
  release tags, without failing zizmor's `ref-version-mismatch` check each time upstream pushes to
  it.
- Tests only, with no change to the crates or the npm package: every Vitest config turns off
  Vitest 5's `fsModuleCache`, which kept `import.meta.glob` results from an earlier run, so a
  conformance component added since then was left out and a check over all of them passed without
  it.
- CI only, with no change to the crates or the npm package: each nightly cargo-fuzz job starts
  from the corpus the last good run of its target saved, minimised with `cargo fuzz cmin`, so the
  nights build on one another. The jobs build for `x86_64-unknown-linux-gnu`: the prebuilt
  cargo-fuzz that CI installs targets musl by default, where AddressSanitizer cannot run, so no
  cargo-fuzz job had built on CI before. libFuzzer may use 6 GiB: under AddressSanitizer the
  `json` and `state_script` targets pass libFuzzer's default 2 GiB within ten minutes, while
  without it they stay at 33 MiB over 1.5 million runs.

### Removed

- **Breaking:** `ferrovue::ammonia`, the `ammonia` feature's re-export of the ammonia crate. A
  `Sanitised::with` policy of your own takes `ammonia` 4 as a dependency of your own crate
  (`ammonia = "4"`, which Cargo resolves to the release ferrovue uses), and names it
  `ammonia::Builder` in place of `ferrovue::ammonia::Builder`. The crates re-export no other
  third-party crate.

### Fixed

- FV0613 for a setup binding the server cannot evaluate gives one location, where the template
  reads the binding. It used to repeat the location and source line of the expression inside the
  setup, after the reason.
- A `computed` that throws in JavaScript no longer panics when the render does not read it (#112).
  Generated code worked out every `computed` before the render, where Vue works one out when the
  render first reads it, so `new Date(s).toISOString()` of an invalid date or `.repeat()` of a
  negative count panicked under a `v-if` that is false, where Vue renders the page. A `computed`
  whose expression may panic (`.repeat()`, `.padStart()`, `.padEnd()`, `new Date(s)`,
  `Date.parse(s)`, `.toISOString()`, `t()` and helpers, or another such `computed`) is now a
  `std::cell::LazyCell`, worked out at its first read and kept for the rest of the render; one a
  `v-bind()` in `<style>` reads is worked out as the render starts, as Vue's server works out the
  style variables. Every other `computed` is generated as before. The `Unread`, `UnreadFold` and
  `UnreadVar` conformance components hold the cases, and the `dates_and_prices`, `strings` and
  `errors_and_limits` guides drop the advice to call a throwing method under a `v-if`.

### Security

- The `ammonia` feature requires ammonia 4.2.4, which fixes RUSTSEC-2021-0157 and RUSTSEC-2026-0373
  (CSS `url()` escaped and matched wrongly in a `style` attribute) and RUSTSEC-2021-0158 (XSS
  through SVG `animateMotion`, `animateTransform` and `animateColor`). `Sanitised::new` cleans
  with ammonia's default policy, which allows no `style` attribute and no SVG; a `Sanitised::with`
  policy that allows either was exposed with ammonia 4.2.1 to 4.2.3.

## [0.7.2] - 2026-10-11

### Added

- `ferrovue::Chunks` reads Vite's manifest and says which chunks an island needs (its own and,
  transitively, those it imports statically, never the entry), so a page can name them with
  `<link rel="modulepreload">` in place of the browser finding them one round trip at a time (#96).
  `Chunks::preloads()` writes the links of one page, each URL once, in `<head>` and after the
  app's container alike; `for_islands` and `for_source` give the URLs, the latter for a chunk the
  entry imports dynamically; `with_base` serves them under Vite's `base`. The islands guide's
  "Preloading the islands" says which islands to preload (those that hydrate at once) and where
  the links may go, and the full-stack example preloads them on each page.
- A client build with a manifest writes `.vite/ferrovue-islands.json` beside it (beside the
  manifest's own path when `build.manifest` names one): each island's name with the file of the
  chunk that holds it, which `Chunks` reads with the manifest. An island another component imports
  is bundled into a chunk they share, which the manifest does not key by the island's source. In
  an app build (`vite build --app`), the client environment's build writes it, as that
  environment's `build.manifest` says, and the server's does not.
- `PageRecord::island_names()` names the components a page's record holds so far, and
  `Part::name()` a part's.

### Changed

- The npm package depends on `postcss` `^8.5.29`.
- The repository develops and tests with oxlint 1.87, Playwright 1.64 and vscode-uri 3.2, and its
  `Cargo.lock` takes the latest patch and minor releases Rust 1.89 builds.
- CI runs cargo-deny from its released binary. The action it used before built a Docker image from
  Docker Hub on every run, and Docker Hub's limit on anonymous pulls failed the job.

## [0.7.1] - 2026-10-09

### Fixed

- `conformanceSuite`'s client-render check and `renderRecordedPage` read the selection of a
  recorded `<select>` from its `selected` attributes, as the HTML parser does. happy-dom 20.14
  selects the second option on parsing a `<select>` whose `selected` option comes later, so a
  correct client render was reported as differing (#91).

## [0.7.0] - 2026-10-09

### Added

- The types the public API names are exported where it names them: `ErrorCode` and
  `SourceLocation` (a `GenError`'s `code` and `at`) from `ferrovue/compiler`, with `ERRORS`, the
  table of every code and its title, and `docsUrl(code)`; `FileRoute` from `ferrovue/vite`;
  `RouteEntry` from `ferrovue/routes`; and `IslandComponent`, `MountOptions`, `PageOptions`,
  `PagePart`, `PageRecord` and `RenderPageOptions` from `ferrovue/testing`.

- `ferrovue/volar`, a plugin for Vue's language tools (`@vue/language-core` 3.3, the Vue (Official)
  extension's language server): named in `vueCompilerOptions.plugins` in `tsconfig.json`, it
  compiles the project as a component is edited, with the editor's unsaved text, and underlines what
  ferrovue refuses in it, with the error's code linked to its documentation. An error in the
  template is underlined on the construct; one in `<script setup>` or `<style>` on the block's
  opening tag, with its line and column in the message. `config` names another configuration file
  and `codeLinks: false` gives the code as plain text. `generate` takes the text of components in
  place of their files as a third argument. The full-stack example enables the plugin, and its
  README describes restarting the server with bacon when the generated Rust changes.
- Generated code checks its version against the `ferrovue` crate's: `mod.rs` opens with
  `ferrovue::__compat!(1)`, and generated code of a version the crate does not support stops the
  build at that line with one message saying to use the npm package and the crate of one release
  and generate the code again, in place of a list of type errors. The version changes only when
  generated code changes in a way the crate must match (RELEASING.md). Code generated before this
  release has no check; regenerate it.
- The generated-code guide states the contract: which files, modules and items are stable (`NAME`,
  `Props` with its fields, `new` and setters, `Slots`, `…SlotProps`, `…Slot`, `render` and the order
  of its parameters, `html`, `island`, `into_html`, `into_island`, `types.rs`, `route_table.rs`,
  `stores.rs`, `i18n.rs`, `provides.rs`, `twins.rs`, `render_json`), and that `render_scoped`, the
  `#[doc(hidden)]` items and parameter names are outside it. It now covers page modules' names, the
  `…Slot` types of a component that passes on `Provides`, and the derives of `Props` and `Slots`.
- `crates/ferrovue-contract`, an unpublished crate that generates every item of that contract and
  uses each from hand-written Rust, run in CI with its generated code checked by `ferrovue --check`.
- `v-bind()` in `<style>`, scoped or global: the variables are written into the `style` of the
  component's root (each root of a fragment, a root `<template v-if>`'s elements, a root that is a
  component, `<component :is>`, an async component or a `<RouterLink>`) where Vue's server writes
  them, merged after the root's own `style` and what a parent passes, with `undefined` and `null`
  as `initial` and an empty string as a space. Their names follow the component's id and the new
  `isProduction` key of `ferrovue.config.json`, which says whether plugin-vue compiles for
  production (`vite build`, the default) or development; the Vite plugin fails a build in which
  either differs from plugin-vue's. A `v-bind()` of a value that is not a string or a number is
  refused (FV1006).
- CSS modules: `<style module>`, `<style module="name">`, `$style.x` and `useCssModule()`, when
  `cssModules` in `ferrovue.config.json` (`{ generateScopedName, hashPrefix?, context? }`) mirrors
  Vite's `css.modules`. Each class is a constant computed as postcss-modules computes it in Vite, with
  the same libraries, recorded from Vite as vectors (`packages/ferrovue/test/css-modules.json`). The
  Vite plugin fails a build whose `css.modules` names the classes otherwise (another pattern or
  `hashPrefix`, another working directory for a pattern that hashes the path, `localsConvention`,
  global scoping, the lightningcss transformer). `<style module>` without `cssModules` stays refused
  (FV1005), and a module in another file, one a preprocessor compiles, one that imports from another
  file (FV1014) and `useCssModule` of a module the component lacks (FV1015) are refused.
- `attachSsrRender` (`ferrovue/testing`) compiles `v-bind()` in `<style>` with the names plugin-vue
  gave the component, and gives hydration in Node the variables Vue's Node build leaves out; a
  fresh client render (`conformanceSuite`, `renderRecordedPage`) sets them as a browser's Vue does
  once mounted, and compares custom properties by name in any order.
- `Boolean` is taken as the function of `.filter()`, `.map()`, `.some()`, `.every()`, `.find()` and
  `.findIndex()`, as `x => !!x`, and `Boolean(x)` as a call. `.filter(Boolean)` of a list whose items
  may be `null` or `undefined`, or of an array literal holding optional values
  (`[name, title, city].filter(Boolean).join(" · ")`), keeps the items present and truthy as a list
  of the values, which the other list methods then take.
- The Vite plugin takes `config`, the configuration file relative to `root`, as `ferrovue --config`
  does: `ferrovue({ config: "config/ferrovue.json" })`.
- Release assets carry build provenance: the `.tgz` and `.crate` files attached to a GitHub release
  are attested (`gh attestation verify ferrovue-X.Y.Z.tgz --repo Kinsmir/ferrovue`), and npm stages
  the same tarball the release attaches, packed once.
- `rust-toolchain.toml`, `.node-version`, `.editorconfig` and a `justfile` whose `just check` runs
  the pull request checklist; versions repeated across the workspace's manifests come from a pnpm
  catalog.
- A release dry run (`.github/workflows/release-dry-run.yml`): on pull requests that change the
  release's workflows or script, weekly and by hand, it packs every package for a throwaway
  pre-release through the release's own `pack.yml` and has npm stage it with `--dry-run`.
- The criterion benchmark times the runtime's attribute merging, number writing and head rendering
  on their own, each checked against the output it writes.
- A JSON Schema of `ferrovue.config.json`, shipped in the npm package as `ferrovue/schema.json` and
  published with each version at `https://cdn.jsdelivr.net/npm/ferrovue@<version>/schema.json`.
  `ferrovue init` writes that URL as `$schema`, which ferrovue accepts and does not read, so VS Code
  completes and describes the keys with no extension. The configuration's validation reads its keys
  from the same definition, and a test fails when the schema and the `Config` type disagree on a key,
  a type, a required key or a description, or a default differs from what the compiler does without
  the key.
- An API report of the npm package: `packages/ferrovue/api` holds an API Extractor report of each
  export and `ferrovue --help`, which `pnpm api:report` writes and `pnpm api:check` checks in CI.
- A deprecation policy (README, CONTRIBUTING.md, RELEASING.md): a crate item carries `#[deprecated]`,
  and a configuration key or command-line option warns, for at least one minor release before it
  is removed in a major one. A deprecated key warns with `warning[FV1117]` and a deprecated option
  with `warning[FV1118]`, each naming its replacement; `--format json` lists warnings in
  `diagnostics` with the `severity` `"warning"`, the Vite plugin through Vite's logger, and
  `loadConfig` takes a function to hand them to (`console.warn` by default). The JSON Schema marks a
  deprecated key for editors, and `--help` a deprecated option.
- `release.ts bump` and `release.ts check` accept a changelog's subsections only as Keep a Changelog
  names and orders them: Added, Changed, Deprecated, Removed, Fixed, Security.
- `ScopeIdMode`, the type of `scopeId`, is exported from `ferrovue/compiler`.
- Navigating between pages (#74). `readPage(html)` from `ferrovue` reads a fetched document's
  `PageRecord` and Pinia state text with no `DOMParser`, finding each script as the HTML parser
  does, past comments, attribute values, raw text and script escapes. `renderPage(layout,
  components, record, { previous })` shows the next page from its record with the app
  `createPageApp(…, { hydrate: false })` builds, the same tree the first page hydrated, in place of
  the container, mounting it before `previous` is unmounted so a router both use stays started.
  `hydrateState(pinia, { text })` reads fetched state with the same `NaN` and `Infinity` handling,
  and `linkRouter` takes the next page's `location`. `renderRecordedPage` from `ferrovue/testing`
  checks that a page rendered from its record on the client shows the recorded HTML, comments and
  empty text aside, and `conformanceSuite` with `clientRender: true` checks a fresh client render of
  every fixture the same way, with `clientDiffers` for the fixtures whose client render Vue itself
  writes differently.
  `examples/fullstack` features one staff pick after another without a reload.

### Changed

- CI pins `dtolnay/rust-toolchain` to its current `master`, which hardens how it handles its inputs.
- `ferrovue` removes from `out` only the `.rs` files it wrote itself, the ones that start with its
  `// @generated by ferrovue` header, so a module of the app's own put there by mistake (with
  `"out": "src"`, say) is no longer deleted. `--check` still reports such a file as not generated,
  and says that `ferrovue` leaves it.
- `ferrovue.config.json` is checked when it is read: a file that is not an object (FV1113), a key
  ferrovue does not read, with the key it most likely means (FV1114), and a value of the wrong type
  (FV1115, FV1107 for a helper or twin type) are refused. A string of `clientDirectives` and a
  helper without `params` used to fail later, or not at all.
- `ferrovue --watch` and the Vite plugin's dev server regenerate only on a change to what a run
  reads: the configuration, components, stores, locale messages, pages or routes file, and the
  `.ts` files read for types. A change to `vite.config.ts` or `package.json` no longer regenerates,
  and an `out` written as `./src/generated` is recognised as the output. The undocumented `affects`
  export of `ferrovue/vite` is removed.
- `ferrovue` refuses `--check` with `--watch`, and `init` with `--check`, `--watch`, `--diff` or
  `--format json`.
- The minimum supported Rust version is 1.89, the oldest that builds generated code, down from 1.99.
  CI reads it from `Cargo.toml`, and also tests Node 22.18 (the `engines` floor) and 26, and the
  TypeScript tests on Windows and macOS; a nightly job builds the docs as docs.rs does.
- `#[must_use]` on the runtime's pure public functions, and `Attr`, `HeadValue`, `Query`,
  `i18n::Part` and `i18n::Value` are `#[non_exhaustive]`: generated code only builds them, but a
  `match` over them outside their crate needs a wildcard arm.
- Fewer allocations when merging attributes, writing fractions, rendering the head and writing an
  island's props; the output is unchanged.
- `release.ts bump` moves the changelog's `[Unreleased]` link to the new version and adds the new
  version's link, and `release.ts check` refuses a changelog that has links but none for the
  version.
- `fixtureApp`'s `pinia`, `vueRouter` and `vueI18n` options and `conformanceSuite`'s `record` accept
  `undefined`, for a project type-checked with `exactOptionalPropertyTypes`, which the workspace now
  uses itself.
- A `.ts` file's types are translated only when the server render reaches them (#77): through a
  component's props or model and their fields, a component's own interfaces, a provided or injected
  value, a `ref` the server computes, or a constant list declared with an interface. `types.rs`
  holds only those types, so an exported interface nothing reaches is no longer written there, and
  `types.rs` is not written at all when nothing reaches one. A type nothing reaches is no longer
  refused: a module imported for its functions may declare `type Row = Record<string, unknown>`.
  Two files declaring a type of one name are refused (FV0319) once the name is reached.
- A threat model, the guide's `security` page, which `escaping` and `SECURITY.md` link to: the trust
  boundaries, every place the runtime and generated code write data that may come from a reader
  (text, attribute values and names, CSS, island props, the state script and page record, the head,
  `<RouterLink>`, translated messages, `v-html`, teleports, holes, scope ids, twins and helpers),
  the guarantee there with the code and tests behind it, what ferrovue inherits from Vue, and where
  an external review should start. The `Unsanitised` conformance component holds the inherited
  cases to Vue (`javascript:` URLs, `srcdoc`, a bound `onclick` on an element and falling through,
  CSS); the head vectors gain hostile attribute names and `<!--<script>` in scripts; the compiler's
  tests refuse an unsafe bound attribute name, a name chosen at run time and `v-bind` of an object
  that is not a literal.
- A twin without a string `rust` is refused when the configuration is read (FV1110), with the
  other configuration errors.
- `ferrovue --format` without a value is refused as `--config` without one is ("option '--format'
  requires an argument"), and a value given to an option that takes none (`--check=yes`) is
  refused.

### Fixed

- A component's own interfaces and object type aliases are translated only when the server render
  reaches them (#77), as a `.ts` file's are: a type only an event handler uses is neither written
  nor refused, and the component's module holds only the reached ones. A field whose type has no Rust counterpart (`items: HTMLElement[]`) is left out of
  a type reached only by values the server computes, such as `shallowRef<Cat[]>([])`, and reading
  it on the server is refused where it is declared. A type a prop or `defineModel` reaches keeps
  every field, and such a field is still refused there.
- A component whose `render` takes more than seven arguments (slots, the route, stores,
  translations, teleports, `Provides` and the head, through its children) generates code that
  passes `cargo clippy -- -D warnings`: its `render`, `render_scoped` and `html` allow
  `clippy::too_many_arguments`, as a props constructor with more than seven required props does.
- A components, stores or messages directory that does not exist is FV1116, and a routes file
  that is missing or not JSON is FV1246 or FV1247, each naming the path, where these were a raw
  ENOENT or an FV0001 with no file. A store or type file that does not parse is FV0001 with its
  file, line and column.
- `ferrovue --watch` and the Vite plugin's dev server no longer stop on an error that is not a
  refusal, such as a file read while half written: they show it, and regenerate on the change that
  puts it right. A watch that fails (out of inotify watches) says so instead of crashing.
- `mountIslands` reports an island that throws as it mounts (its `setup`, a plugin) through
  `onError` and goes on to hydrate the islands after it, where it used to stop at the first.
- A `Page`'s record holds `null` for props serde_json refuses (a map keyed by lists, say), where
  the whole record became unreadable JSON; a debug build panics with serde's error. `PageRecord`
  and `PagePart` in `ferrovue/client` type such props as `null`.
- A vue-i18n plural choice with a count of `NaN` over three cases picks what `Math.min` does.
- On Windows, paths in generated code, diagnostics, `init`'s output, the conformance suite's diffs
  and the watch filters are written with `/`, as everywhere else; a `.gitattributes` keeps text
  files at LF line endings, as the generated Rust and the recorded fixtures are compared byte for
  byte.
- The release job installs an exact npm version while it holds the publishing token.
- Listeners on a component are skipped whatever form its props take: `@loaded`, `v-on:x.once`,
  `@update:x`, `v-on="handlers"` and `@[name]` beside a `v-bind` of the child's own `Props`
  (a component rendering itself included) compile, where they were FV0503 (#75). A prop the child
  declares with a name like a listener (`onSale`) takes the value bound to it, as Vue gives it,
  where it was left out; a listener whose name is chosen at run time, or comes from `v-on` of an
  object, given to such a child is FV0514.
- The quick start's table of configuration keys lists `twins`, and says that `out` keeps files
  ferrovue did not write.
- An empty array literal takes its element type from the list it stands beside, so
  `shallowRef(props.item ? props.item.children : [])` compiles (#76). It does so in either branch of
  `?:` and after `??`, in setup, `computed` and the template, and also takes the type from
  `[] as T[]`, `[] satisfies T[]`, a typed constant (`const none: T[] = []`) and the type argument
  of `ref`, `shallowRef` and `computed`. The generated Rust borrows the chosen list as a slice and
  takes `&[]` for the empty one. A `?:` between two lists and a `??` falling back to a list borrow
  them the same way, and a list or object read through `?.` is borrowed. `as` and `satisfies` are
  read in expressions: one that states the type the value already has is accepted, and one that
  states another is FV0628.

### Security

- A value in the page head could move a streaming hole. unhead escapes only `"` in an attribute
  value and only the closing tag in `<script>`, `<style>` and `<noscript>` content, and ferrovue
  writes the head exactly as unhead does, so a `useHead` value holding `<fv-hole>` (a title in
  `og:title`, say) put a hole marker into a page whose head is rendered into the string
  `HtmlStream` and `split_holes` cut. The first hole's content was then written inside the head
  attribute, ending it, and what followed the marker in the value was read as markup. The marker
  is now `<fv-hole"</script</style</noscript>`, which no value ferrovue or unhead writes can hold.
- A value in the page head could move a streaming hole. unhead escapes only `"` in an attribute
  value and only the closing tag in `<script>`, `<style>` and `<noscript>` content, and ferrovue
  writes the head exactly as unhead does, so a `useHead` value holding `<fv-hole>` (a title in
  `og:title`, say) put a hole marker into a page whose head is rendered into the string
  `HtmlStream` and `split_holes` cut. The first hole's content was then written inside the head
  attribute, ending it, and what followed the marker in the value was read as markup. The marker
  is now `<fv-hole"</script</style</noscript>`, which no value ferrovue or unhead writes can hold.

## [0.6.0] - 2026-10-06

### Added

- A conformance suite for applications (#45), in two calls over a `fixtures/<Component>/<case>.json`
  directory. `await conformanceSuite({ config, components })` from `ferrovue/testing` registers
  vitest tests that fail on a component with no fixtures, a fixture naming no component or no
  components at all, on generated Rust that differs from what `ferrovue` writes now (with the
  diff), on a fixture Vue renders differently from its recorded `.html` (saying where they first
  differ), and on a recorded `.html` that hydrates with any warning or with its first node
  replaced, once `<ClientOnly>` and async components have settled; `FERROVUE_FIXTURES_WRITE=1`
  records the `.html` files instead. It takes the application's own `pinia`, `vueRouter` and `vueI18n` modules, as
  `fixtureApp` now does in its options, so the fixtures install the instances the application's
  stores and composables read. vitest is an optional peer, loaded only by `conformanceSuite`.
  `ferrovue::conformance!("fixtures", generated::render_json, at_least = n)` writes the Rust test
  that renders every fixture through the generated `render_json` and compares the bytes, listing
  each fixture that differs, and fails when fewer than `n` fixtures are found;
  `ferrovue::check_fixtures` is the same check as a function. The crate guide's new `testing` page
  describes both, `examples/fullstack` replaces its hand-written fixture tests with them and has
  fixtures for every component, loading ferrovue from its built package as an external, as an
  application's vitest run does; ferrovue's own Rust conformance test uses the macro.
- Islands that hydrate later. `island(&props).hydrate(Hydrate::Visible)` writes
  `data-hydrate="visible"` on the island's wrapper, after `data-props`; `Hydrate::Idle`,
  `Hydrate::Interaction` (the first `pointerenter`, `click` or `focus` within the island),
  `Hydrate::InteractionOn(&["keydown"])`, `Hydrate::media("(min-width: 60rem)")` and
  `Hydrate::visible_with("200px")` (a root margin) write `idle`, `interaction`,
  `interaction:keydown`, `media:(min-width: 60rem)` and `visible:200px`, escaped as any attribute
  is. The markup inside the wrapper is unchanged. `mountIslands` waits on such an island with Vue's
  `hydrateOnVisible` (given the root margin, if any; one the browser rejects is reported and the
  island hydrates at once), `hydrateOnIdle` (200 ms where the browser has no `requestIdleCallback`)
  and `hydrateOnMediaQuery`, or its own listeners for interaction, and calls the island's loader
  only when the trigger fires, so its chunk is fetched then. Events that reach an island waiting for
  interaction before it has hydrated are dispatched again once it has, so the click that woke it
  reaches its handler. It resolves once the other islands have mounted; the waiting ones join `apps`
  as they hydrate, `unmount()` stops waiting for them, and a `data-hydrate` it does not know is
  reported and hydrates at once. Islands without the attribute hydrate as before, and `Page` parts
  hydrate with their page. Dioxus's `to_element` writes the same attribute. In `examples/fullstack`
  the home page's buttons hydrate on interaction and the book page's reviews once visible, and the
  browser test checks that their chunks are requested only on a click and after scrolling the
  reviews into view on a short screen; a browser test of the package (`browser/lazy.test.ts`) does
  the same for islands waiting for idle and for a media query.
- `provide` and `inject`, resolved through the component tree at build time. A key is a string
  literal or a `Symbol` exported from a `.ts` file and typed `InjectionKey<T>`; a value is a prop, a
  ref, a `computed`, a constant, or an object of them under an interface (`reactive()` unwraps the
  refs in it, as in Vue). `inject` takes a default, or a factory with `true`; under a key whose type
  is an interface, the default may be an object of it (`inject(LookKey, { size: "md", tone: "plain"
  })`), given as it is or returned by the factory, whose fields are values the server computes.
  Every component that provides or injects, or renders one that does, takes the generated `Provides`
  after its other parameters, overlays what it provides, and hands it to its children and to its
  slots' content, which sees what the component rendering the slot provides, as Vue resolves it. A
  page rendered from Rust passes `Provides::default()`, or the values its client app gives
  `app.provide`. A key holding a function is client-only, for event handlers. What cannot be exact
  is refused with codes FV1601 to FV1620: other keys, `inject(key)!`, values that may be absent, a
  ref and a plain value under one key, setup that assigns to an injected value, a provider holding
  `<RouterView>`, a string key injected inside a Rust twin's slot. The guide's new `provide_inject`
  page explains it; the conformance suite has a `Tabs`/`Tab` pair and a themed button, with and
  without providers, recorded from Vue, and `Swatch` and `SwatchShelf` cover object defaults.
- `<component :is>` over a closed set of choices, compiled to a `match`: an imported component, an
  HTML element's name, a prop typed as a union of string literals (an `as` prop), an object of
  imported components or element names declared in setup or exported as a constant from a `.ts` file
  and read by such a prop (`ICONS[name]`), and a `computed` or `?:` choosing among them. Each choice
  gets props, fallthrough attributes, slots and scope ids as a static child would, inside
  `<KeepAlive>` and `<Transition>` too. An element it chooses renders its content, and the slot
  content a parent gives a `<slot>` inside it, by the rules Vue's server applies to virtual nodes
  (`<!--v-if-->`, bare empty attributes, slot scope ids written once each). Anything open (a
  `string`, a `Component`, a key that is not a literal union) is still refused under FV0418, with a
  message naming what is accepted; new codes refuse a prop that may be absent (FV0420), a key the
  object lacks (FV0421), a tag that is not an HTML element (FV0419), `v-html` and `v-text` on
  `<component :is>` (FV0422), `v-show` and `v-model` on a `<select>` in content rendered from
  virtual nodes (FV0423), and a `<slot>` inside a chosen element that has fallback content (FV0919)
  or is also rendered outside one (FV0920). The conformance suite covers every form with a fixture
  per choice (`ShapePicker`, `ShapeRoot`, `TagHeading`, `TagGallery`, `TagContent`, and
  `ThemedChoice` with provide and inject), and the fuzzer writes `<component :is>` choosing between
  a helper component and another one or an element.
- The page head: `useHead`, `useServerHead`, `useSeoMeta` and `useServerSeoMeta` from
  `@unhead/vue` 3 in `<script setup>`, with values the server computes: props, setup bindings,
  getters (`title: () => props.title`), and `list.map(x => ({ … }))` for a list of tags. A component
  that calls one, or renders a child that does, takes a `ferrovue::Head`, which collects the calls
  in the order Vue's server runs them; after the body renders, `Head::render()` gives what unhead's
  `renderSSRHead` gives: the tags for `<head>`, the start and end of `<body>`, and the attributes of
  `<html>` and `<body>`, in unhead's order (its capo weights, `tagPriority`, `tagPosition`),
  deduplicated by its keys (`key`, a meta's `name` or `property`, `canonical`, `charset`, …), with
  the title template applied and every value escaped as unhead escapes it. `Head::new()` holds
  unhead's defaults, as `createHead()` does, and `Head::without_defaults()` none. Conformance
  components (`HeadPage`, `HeadArticle`, `HeadSeo`) and 458 heads recorded from unhead's server
  renderer (`tests/vectors/head.json`, hand-written and drawn at random with markup-breaking values
  in every field) hold it to unhead. `useHeadSafe`, options given to `useHead`, `templateParams`, a
  `titleTemplate` function, event handlers, a `class` or `style` that may be `null` and an object
  given to a `useSeoMeta` key are refused with codes `FV1701` to `FV1711`. `@unhead/vue` is an
  optional peer of the npm package: `fixtureApp` and `conformanceSuite` install its server head
  when it is installed, and record the head after the fixture's HTML; hydrating a fixture installs
  its client head over the recorded tags, which it takes over with no change. The guide's `head`
  page shows a page and the client; `examples/fullstack` sets its titles and meta tags from its
  components.
- `ferrovue::Sanitised`, with the crate's new `ammonia` feature: HTML cleaned by ammonia, to name as
  `"trustedHtml": "ferrovue::Sanitised"` for `v-html` props. `Sanitised::new(untrusted)` cleans with
  ammonia's default policy (no scripts, event handlers or `javascript:` URLs) and
  `Sanitised::with(&builder, untrusted)` with an `ammonia::Builder` of your own; `ferrovue::ammonia`
  re-exports the crate. It renders the cleaned string unchanged and serialises as that string, so an
  island's `data-props` carries exactly the HTML the server wrote and the client's `v-html` writes
  the same. Deserialising one cleans the string again. The guide's `escaping` page says what the
  default policy keeps; a component compiled with it (`tests/sanitised`) checks the render and the
  props the client receives.
- `ferrovue::BasicHtml`, a `TrustedHtml` with no dependency and no feature: `"trustedHtml":
  "ferrovue::BasicHtml"`. `BasicHtml::new(untrusted)` never parses its input as HTML: it escapes
  every character and writes as tags only `<b>`, `<i>`, `<em>`, `<strong>`, `<code>`, `<br>`, `<p>`,
  `<ul>`, `<ol>` and `<li>`, written exactly so with no attributes, closing what is left open,
  leaving out end tags with nothing to close, and keeping blocks and list items where a browser
  reads them back as written (32 elements deep at most). `BasicHtml::from_text(text)` escapes
  everything and writes paragraphs and line breaks. Both serialise as the string; deserialising
  builds it again, which gives the same HTML. Property tests check that every `<` in the output
  starts one of those tags, balanced, and that html5ever parses it back to the same tags and text.
  The guide's `escaping` page has a table choosing between `BasicHtml`, `Sanitised` and a type of
  your own, and a recipe for the last with its three rules: sanitise before render, the client
  receives the same string, sanitise again on `Deserialize`.
- Routes from a folder of pages, as vue-router's file-based routing builds them:
  `"routes": { "pages": "client/pages" }` (or the same under `router.routes`). `index.vue`,
  `[id].vue`, `[[id]].vue` (an optional parameter), `[...path].vue`, `(group)` folders, a
  `name.vue` beside `name/` as its layout, `_parent.vue` and `users.edit.vue` give the paths and
  names vue-router's plugin gives them (`/books/[id]`), held to routes recorded from
  `vue-router/unplugin` for a set of folders that uses each convention. Each page is compiled as a
  component named after its path (`books/[id].vue` is `BooksId`, in `books_id.rs`). The Vite plugin
  writes `ferrovue/routes` for the client: `routes`, vue-router's records with each page loaded
  lazily, and a default export listing the routes as a routes file does, for `routeRecords` and
  `linkRouter`. The router matches optional parameters (`:id?`, absent from `Route::param` when the
  location leaves them out) and routes that only group others, which it never matches itself, both
  held to new vectors recorded from vue-router. What the server cannot build from a file's path is
  refused with codes FV1238 to FV1245: a parameter beside text in one part of the path, repeatable
  parameters, an optional catch-all, parameter parsers, named views, `definePage()`, a `<route>`
  block, and a page whose component name is taken. The routing guide's new section explains it;
  `examples/fullstack` builds its routes from `client/pages` instead of `routes.json`.
- `InlineHtml` from `ferrovue/types`, trusted HTML of inline tags only, and its server type
  `ferrovue::InlineHtml`. `InlineHtml::new(untrusted)` builds it as `BasicHtml::new` does, keeping
  only `<b>`, `<i>`, `<em>`, `<strong>`, `<code>` and `<br>` as tags; `<p>`, the lists and their
  end tags stay text. An `InlineHtml` prop is always `ferrovue::InlineHtml`, with no `trustedHtml`
  configured, and `"trustedHtml": "ferrovue::InlineHtml"` makes every `TrustedHtml` prop inline.
  It is the HTML `v-html` may write inside a `<p>` (below). Property tests check that building it
  again gives the same HTML, that every `<` it writes starts one of its tags, and that html5ever
  reads it inside a `<p>` back as written. The conformance suite records it inside a `<p>`
  (`InlineProse`) and HTML in a `<td>`, a `<foreignObject>` and an `<mtext>` (`PlacedHtml`), each
  hydrated in browsers.

### Changed

- **Breaking:** `ferrovue::RouteDef` has a `view` field, whether the route shows a component; the
  generated `route_table.rs` writes it, and a `RouteDef` written by hand needs `view: true`.
  `Route::link_named` takes a required parameter missing from `params` from the current location,
  as vue-router does.
- **Breaking:** a `provide(…)` not imported from `vue` is refused (FV0105); it used to be ignored
  as client-only. Content of a `<RouterLink>` or of a Rust twin's slot that uses `v-show`, or
  `v-model` on a `<select>`, is refused (FV0423): Vue renders that content from virtual nodes, and
  ferrovue wrote it as a template would.
- **Breaking:** the generated slot types of a component that takes `Provides` carry the context as
  the closure's last argument, so Rust code filling those slots passes it on. A component that
  provides, injects or calls `useHead` has no `island()`.
- Repository hygiene. The full-stack example's README builds the client before its hydration test,
  which reads the build's manifest, and lists `NotFound.vue` and `catalogue.rs`; the README's
  repository layout lists every compiler module and `scripts/inspect.ts`. The greeting example
  follows the workspace lints like the other examples. `cargo deny` skips the duplicate versions of
  `convert_case`, `http` and `syn` that dioxus, actix-web and the move to syn 3 bring in, each with
  its reason, so its output shows only new duplicates. The esbuild build approval, the root
  `fallow` script and lint ignore patterns that `.gitignore` already covers are gone.
- `scripts/ferrovue-in.ts <directory> [arguments]` runs the `ferrovue` command in a project of the
  repository; `pnpm conformance:generate`, `pnpm conformance:check` and CI's checks of the examples
  use it. `pnpm typecheck` also checks the conformance suite's TypeScript (stores, types, vendor
  components), with `erasableSyntaxOnly` off for its enums. The README links repository files by
  their GitHub URL, so the links work on crates.io and npm. The crates leave `missing_docs` to the
  workspace lints and no longer set `homepage`, which repeated `repository`; the crates without
  features drop their docs.rs settings, which changed nothing in their documentation. The issue
  and pull request templates name current versions, error codes and `pnpm lint`, and the
  full-stack example restarts its server with bacon.
- `pnpm lint` covers the examples: oxlint checks their TypeScript and components with the
  repository's rules, and fallow knows the full-stack example's entry points (the Vite client
  entry, its components and its browser and adopter tests).
- The published crates leave out the test data they do not need to build or document: the
  conformance suite, the literal-props project, the recorded vectors and the benchmark's expected
  HTML. The `ferrovue` crate goes from 1134 files (2.0 MiB, 386 KiB compressed) to 64 (620 KiB,
  171 KiB compressed); `ferrovue-core` and `ferrovue-router` drop their vectors. The test and
  benchmark targets stay in the package so it builds without warnings; they run from the
  repository.
- CI checks the npm dependencies with `pnpm audit` and the workflows with zizmor. An advisory that
  reaches the npm package's dependencies or peers shows in the run without failing a pull request
  and fails a release, as a RustSec advisory does; one in development tooling only shows. The
  workflows check out without keeping the token, the release workflow's Node setup restores no
  cache, and Dependabot waits seven days before proposing a new version.
- **Breaking:** `v-html` where the browser's parser rebuilds the HTML is refused, since the page
  then holds other nodes than the server wrote and hydration mismatches, in Vue too. On a
  `<table>`, `<thead>`, `<tbody>`, `<tfoot>`, `<tr>` or `<colgroup>` (whose markup the parser moves
  out of the table), a `<select>` or `<optgroup>` (whose tags it drops), an SVG element other than
  `<foreignObject>`, `<desc>` and `<title>`, or a MathML element other than `<mi>`, `<mo>`, `<mn>`,
  `<ms>`, `<mtext>` and an `<annotation-xml>` with a static HTML `encoding`, it is refused with
  FV1512, which names the element to use instead. In a `<p>`, or an element inside one up to a
  `<button>`, a table cell or another element that keeps blocks from ending the `<p>`, HTML that is
  not `InlineHtml` is refused with FV1513, since a block in it ends the `<p>`. Slot content a child
  places inside its own `<p>` is not seen at compile time. The escaping guide's new section lists
  where `v-html` may go and with which type.

### Fixed

- `fixtureApp` from `ferrovue/testing` takes the application's own `pinia`, `vueRouter` and
  `vueI18n` modules in its options (`{ pinia: await import("pinia") }`) and installs those. In a
  vitest run that loads `ferrovue/testing` from `node_modules` with Node while a peer goes through
  Vite, the instance `fixtureApp` imported itself was not the one the component's stores,
  `useRoute()` and `useI18n()` read, and a fixture with `$stores` failed with "there was no active
  Pinia" (#47). Without the options it imports the peers as before. The README's new section on
  fixtures in an application's vitest run describes both the options and `server.deps.inline:
  ["ferrovue"]`, and `examples/fullstack` tests both peers with ferrovue loaded from its built
  package, as an application loads it.
- A fixture's slot content given as `""` hydrates. `fixtureApp` rendered it as a static node of
  no nodes, which Vue's hydrator compares with the slot's closing `<!--]-->` and reports as a
  mismatch; it is now an empty text node, which Vue hydrates against nothing, and the server
  writes the same bytes as before. A `routerView` of `""` still mismatches, in Vue too: the server
  writes no node for the page, and the client takes the page, a component, to begin at one. The
  conformance suite records both (`Frame/empty-slots`, `App/empty-view`), and the testing guide
  says so.
- The page head of a component `defineAsyncComponent` loads comes in the order Vue's server gives
  it. Vue runs such a component's setup, and the setup of everything it renders, after the
  components rendered without waiting, one level of nesting at a time, so its `useHead` entries
  come after theirs and its title wins over a sibling's; ferrovue pushed them in the order of the
  tree. The generated code renders it inside `Head::deferred()`, whose entries `Head::render` places
  after the others, level by level. The conformance suite records it (`HeadLater`, `HeadNest`,
  `HeadLeaf`).
- Content Vue renders from virtual nodes (in an element `<component :is>` chooses, a
  `<RouterLink>` or a twin's slot) writes what Vue's server writes there: attribute names in lower
  case on HTML elements and as written on SVG elements and custom elements (`dataFoo` was written
  as given, and a bound `:viewBox` on `<svg>` in lower case), a static `class` written before a
  bound one first, and slot content given to a compiled component inside it rendered from virtual
  nodes too. `:selected` on an `<option>` there is no longer refused as `v-model` (FV0423), and a
  `<ClientOnly>` with a `#fallback` there, for which Vue's server writes an empty fragment that the
  client then replaces, is refused (FV1511). The conformance suite records it (`TagCasing`).
- A component whose file is named after a Rust keyword (`Type.vue`, `Match.vue`) is written to
  `type.rs`, which its module `r#type` reads; it was written to `r#type.rs`, which did not compile.
  A file name that is not a Rust name (`user-card.vue`), two names with the same snake case
  (`FooBar.vue` and `Foo_bar.vue`, one of which overwrote the other), `Mod.vue` and a name a
  module ferrovue writes already has are refused (FV0007).
- `mountIslands` no longer dispatches the events that woke an island waiting for interaction again
  when `unmount()` was called while its component loaded.
- A `.vue` file that is empty or holds only a `<style>` is refused (FV0002) at line 1, column 1,
  and Vue's message names it by its path relative to the project, where it had no location and
  the absolute path.
- In content Vue renders from virtual nodes, a static `class` written before `:class` with other
  attributes between the two is refused (FV1013): Vue writes the class where the static one
  stands, and ferrovue where `:class` stands. A `:class` array there keeps the static names first
  too (`class="a" :class="[x, y]"` is `class="a x y"`). Found by the fuzzer; `VnodeClass` records
  it.
- A setup value or a provided value that is a string built from another temporary
  (`props.label.toLowerCase().padStart(6, "0")`) compiles: the generated Rust borrowed a value
  dropped at the end of its statement. Setup strings built by `format!` and the like are held as
  the `String` itself.
- An integer setup value computed through JavaScript's arithmetic (`props.n * -1`, `(-1) * 0`)
  keeps `-0`, so `1 / value` is `-Infinity` as in Vue; it was cast to an integer first.
- Strings holding bidirectional controls (U+202A to U+202E, U+2066 to U+2069) in a template,
  a constant or a setup value compile: they are escaped in the generated Rust, whose compiler
  rejects them written out. `SetupValues` records these three.
- A string `:class` given to a component loaded with `defineAsyncComponent` is written twice when
  it has whitespace around it (`:class="' a '"` is `class="… a a"`), as Vue's async wrapper hands
  it on once trimmed and once as written; ferrovue wrote it once. Where Vue merges the props first
  (the component is its parent's root, or takes `v-bind` or a static `class` too), the class
  arrives trimmed and is written once, as before. `AsyncClass` and `AsyncClassRoot` record both.
- An attribute that falls through holding `??` whose fallback ends in another `??`
  (`note ?? (tags.find(…) ?? "-")`) compiles: the generated Rust wrapped a `Cow` in another.
  `AsyncClass` records it.
- A component that reads Pinia stores compiles when no store's state holds a string: `stores.rs`
  writes `Stores` without a lifetime then, and the component took `&Stores<'_>`. The
  `literal_props` test project has such a store.
- The messages a message links to (`@:key`, at any depth) are looked up from the locale where
  `t()` found that message, as vue-i18n does: with `nl` falling back to `en`, an English-only
  message linking to `common.hi` writes the English `common.hi`, where ferrovue wrote the Dutch
  one. `Translated` records it, with a Dutch message linking through an English one.
- `.map()` over strings whose arrow returns the item on one branch and a new string on the other
  (`words.split(" ").map((w) => (on ? w.toUpperCase() : w))`, or `$t(…)` in place of
  `toUpperCase()`) compiles: the generated Rust returned a borrow of the item from the closure.
  `MappedChoice` records it.
- A `v-for` inside another, over a list the outer item holds that is filtered or mapped with a
  value narrowed by a `v-if` around it (`shelf.tags.map((t) => note + t)` under `v-if="note"`),
  compiles: the size the generated `render` reserves up front read that value outside the `if`.
  `NarrowedRows` records it.

## [0.5.0] - 2026-10-05

### Added

- Stable error codes. Every error the compiler raises has a code, `FV` and four digits grouped by
  area (`FV00xx` components and parsing, `FV01xx` script setup, `FV02xx` constants, `FV03xx` props
  and types, `FV04xx` templates and attributes, `FV05xx` child components, `FV06xx` expressions,
  `FV07xx` strings and numbers, `FV08xx` lists and loops, `FV09xx` slots, `FV10xx` classes and
  styles, `FV11xx` configuration and helpers, `FV12xx` the router, `FV13xx` Pinia, `FV14xx`
  vue-i18n, `FV15xx` raw HTML, `<ClientOnly>`, `<Teleport>` and Rust twins), and a code is never
  reused. The CLI and the Vite plugin's overlay show it as `error[FV0602]: file:line:column: …`
  with a link to its entry in the crate guide's new `error_codes` page, which `pnpm
  errors:generate` writes from the compiler's list; `pnpm test` fails when the two differ or a
  code is raised but not listed. `ferrovue --format json` (with or without `--check`) writes
  diagnostics with the file, line, column, end where known, code, title, message and docs link,
  keeping the exit status; the quick start gives a VS Code problem matcher for `tasks.json`, which
  a test runs against the CLI's output. A syntax error in `<script setup>` is reported with its
  file and line as `FV0001`.
- Whole-page hydration beside islands (#33). `ferrovue::Page` takes the components a layout's
  slots hold as `Part`s, each made from the `Html` value that writes its markup, so the record of
  `(component, props)` per slot comes from what rendered the page; `Page::hole` leaves a slot to
  fill while an `HtmlStream` sends the page, and `PageRecord` writes the record as a
  `<script type="application/json">` escaped as `state_script_into` escapes the state, at once or
  as the stream's last hole. `mountPage(layout, loaders, options)` from `ferrovue` reads the record,
  loads only the components it names, and hydrates the layout with each slot rendered as a plain
  array, with `pinia`, `router` and `plugins` as `mountIslands` takes them. `hydrateRecordedPage`
  from `ferrovue/testing` hydrates a recorded page and throws on any mismatch. Page fixtures
  recorded from Vue check the Rust render and the record, in happy-dom and in real browsers, and
  `examples/fullstack` serves a page hydrated whole. A part written where Vue would give it a
  `:slotted()` scope id panics, and a `TrustedHtml` prop is carried in the record in full; the
  guide's `islands_and_hydration` page states the cost.
- A weekly CI job (`.github/workflows/canary.yml`) installs the newest patch of Vue 3.5, vue-router,
  Pinia and vue-i18n that ferrovue's peer ranges allow, re-records the conformance fixtures and
  vectors from them, hydrates the committed HTML with them, and opens an issue when anything differs.
- `null` and nullable data: `T | null` in props, interfaces, shared types and Pinia state is an
  `Option<T>` whose `None` the island's props and the state script write as `null` (an optional
  value's `None` is still left out), so the client hydrates with the `null` the server rendered.
  Templates test it with `x !== null`, `x === null`, `x != null`, `x == null` and truthiness, and
  `??`, `?.`, `{{ }}` and bound attributes treat it as Vue does; `null` may be a `?:` branch, a
  `??` fallback and a child's prop. A type that may be both `null` and `undefined`
  (`T | null | undefined`, `x?: T | null`), a default for a nullable prop and a strict comparison
  of a value that may be either are refused with an error saying why. The fuzzer generates nullable
  props.
- `props.x` in the template when `props` is bound to `defineProps()` or `withDefaults(…)`, as
  script code could already read it.
- Components with no `<script>`, or an empty `<script setup>` (an icon, a divider), compile as
  components without props.
- Refs that start empty are typed by their type argument: `ref<Row[]>([])` is an empty list of
  `Row` that `v-for`, `.length` and `.join()` read, and `ref<Row>()`, `ref<T | undefined>()` and
  `ref<T>(undefined)` are absent on the server.
- Generic components: `<script setup generic="T extends Item">` renders each type parameter as its
  constraint, which is all the template can rely on. A parameter without one is refused.
- Constants imported from `.ts` files and TypeScript `enum`s (imported, or declared in the
  component) are evaluated when the component is compiled: strings, numbers, booleans, lists of
  them and objects of them read field by field are written where the template reads them
  (`LABELS.save`, `Tone.Loud`, `Rank[5]`), and a list of objects becomes a `const` in `types.rs`,
  typed by the interface it is declared with or by a struct named after it. An enum is also a prop
  type: a string, or a number. A field that is `null` in some of a list's objects is nullable, as
  `T | null` is. A constant that is not a literal is refused where it is read.
- `useSlots()`: `slots.header` tests a slot's presence, in the template or in `computed`, as
  `$slots.header` does.
- A `builders` key in `ferrovue.config.json`: with `false`, props structs, shared types and store
  state are written without the `impl` holding `new()` and the chainable setters, for an app that
  builds its props as struct literals. The fields stay public and the derives, `Default` included,
  are unchanged. `true`, today's output, is the default; a value that is not a boolean is a config
  error (#35).
- `linkRouter(routes, { navigate })` from `ferrovue/link-router`, for an application whose own
  navigation layer leaves the page: a vue-router router over the routes file the compiler reads,
  every route rendering nothing, on a memory history at the page's location. Its first navigation
  resolves the page the server rendered; every later one, a `<RouterLink>` click included, is
  handed to `navigate` with its `href` and aborted, so active links, `aria-current` and `useRoute()`
  keep matching the page on screen. It takes the base and link classes of the config's `router`.
  The routing guide explains why each part is there (#34).
- `<ClientOnly>`, from `ferrovue/client` (and `ferrovue`): the server writes its `#fallback` slot,
  or `<!---->` without one, and the browser hydrates that fallback and swaps in the default slot once
  mounted. The compiler does not read the default slot, so a component library's components, or any
  other import or expression the compiler refuses, may go there. It takes no attributes.
- Rust twins: components the compiler does not compile, listed under `twins` in
  `ferrovue.config.json` with their props and slots, are rendered by a Rust function of the project's,
  which the generated parent calls with the props, the slots and the attributes and scope ids its
  root takes. `twins.rs` holds each twin's props, slots and the signature its function must have.
  ferrovue cannot check that a twin writes what Vue writes; the full-stack example holds one to Vue
  with fixtures recorded through `ferrovue/testing`.
- `defineAsyncComponent(() => import("./X.vue"))`, and its `{ loader }` form, renders as the
  component it loads, as Vue's server renderer waits for it.

### Changed

- The `vue` peer dependency is `~3.5.43` instead of exactly `3.5.43`, so a later Vue 3.5 patch no
  longer fails the install. The optional peers are held to the minor the fixtures were recorded
  from: `vue-router` `~5.3.1` (was `^5.3.1`), `pinia` `~4.0.3` (was `^4.0.3`) and `vue-i18n`
  `~11.4.13` (was `^11.0.0`). The README's "Versions" lists them.
- Every refusal names a line and column in the `.vue` file. Errors that had none now point at the
  construct: `new Date(…)` (now "`new Date(…)` builds an object the server has no twin for"), an
  object interpolated with `{{ }}`, a non-literal default in `withDefaults`, `<style module>` and
  `v-bind()` in CSS, `<component :is>`, a component or custom directive the template cannot
  resolve, `<RouterView>` in a scoped component, and expressions whose start the template's source
  map does not cover.
- A component written with the Options API is refused with "a child component must have
  `<script setup lang="ts">`, or no script at all" when another component imports it, and "an
  island needs …" otherwise, instead of a message about islands for both. A child that is not
  among the compiled components says so instead of asking for an "imported island".
- CI's jobs set up Rust and pnpm through shared composite actions, each job has a timeout, and a
  final **CI passed** job sums up the others. Only runs on `main` save the cargo, pnpm and
  Playwright caches; pull requests restore them without writing their own.
- Every Rust dependency of the workspace, dev-dependencies included, is declared once in the root
  `Cargo.toml`'s `[workspace.dependencies]`, and `node scripts/release.ts members` fails on one a
  crate declares itself.

### Fixed

- `undefined ?? x` gives `x`, and a value known to be `undefined` is falsy, as in JavaScript; the
  compiler kept `undefined` for both.
- `.includes()` of a list of numbers takes any number: a `Float` in a list of `number`s, a `number` in a
  list of `Float`s, or in a list mapped to fractions (`nums.map((v) => -v).includes(0)`), which were
  refused as a value of another type than the list's. It compares as JavaScript's `includes` does, `-0`
  equal to `0`.

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
- Fallthrough attributes: what a parent passes a child beyond its props falls through as in Vue:
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
- Testing: every conformance fixture is hydrated in real browsers (Chromium, Firefox and WebKit,
  through Playwright) as well as in happy-dom, failing on a mismatch Vue reports and on any change
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

[Unreleased]: https://github.com/Kinsmir/ferrovue/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/Kinsmir/ferrovue/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/Kinsmir/ferrovue/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Kinsmir/ferrovue/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Kinsmir/ferrovue/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/Kinsmir/ferrovue/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/Kinsmir/ferrovue/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Kinsmir/ferrovue/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Kinsmir/ferrovue/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Kinsmir/ferrovue/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Kinsmir/ferrovue/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Kinsmir/ferrovue/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Kinsmir/ferrovue/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Kinsmir/ferrovue/releases/tag/v0.1.0
