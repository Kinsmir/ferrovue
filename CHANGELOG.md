# Changelog

All notable changes to this project are documented here. The crates and the npm package are
released together and share version numbers. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and the guide holds each change's detail.
The notes of 0.1.0 to 0.11.0 as first written, with more detail, are in
[CHANGELOG.md at v0.11.0](https://github.com/Kinsmir/ferrovue/blob/v0.11.0/CHANGELOG.md).

## [Unreleased]

### Added

- `unions` in `ferrovue.config.json` maps a union's `type` alias to an application's own Rust enum.
  The enum implements the new trait `ferrovue::props::Union`: [Unions mapped to existing enums](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#unions-mapped-to-existing-enums).

### Changed

- **Breaking:** every item is named at the module that defines it (`ferrovue::html::Html`), and
  generated code is version 6. Paths, npm entries and steps: [`upgrading_to_0_12`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_12/index.html).
- **Breaking:** a list of a union of string literals (`tones: Tone[]`) is a `Vec` of its enum.
  0.11.0 held strings, and passed one outside the union to a child as its last member: [`upgrading_to_0_12`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_12/index.html#5-build-lists-of-a-union-from-the-enum).

### Fixed

- A lookup table, a `?:`, a `??` and a `ref` of a union give its enum through a `match` over every
  variant, where 0.11.0's last arm took any other string: [Lookup tables](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#lookup-tables).
- A `computed`, a `ref`, a constant or a function holds the type of its annotation.
  0.11.0 refused `ref<Tone | "">(props.tone) === ""` with FV0637: [Unions of string literals](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#unions-of-string-literals).
- A value of a wider union reaches a child's prop of a narrower union once narrowed as TypeScript
  narrows it, which 0.11.0 refused with FV0515: [Unions of string literals](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#unions-of-string-literals).
- The README and the guide name the release they ship with in `$schema` and the `ferrovue`
  dependency, where the schema was 0.8.0's: [Quick start](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html#2-configure).

## [0.11.0] - 2026-10-25

### Added

- Loops and `let`s assigned again in a function's or a `computed`'s body: `for…of`, counting `for`
  loops, `break`, `continue` and `+=`, `++` and the others: [Loops and assignments](https://docs.rs/ferrovue/latest/ferrovue/guide/script_logic/index.html#loops-and-assignments).
- Constants worked out when compiling (`const HOUR = 60 * MINUTE`, template literals), constant
  `Map`s, `Object.hasOwn()` and `Object.keys()` of an object constant: [Constants](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#constants).
- A function's or a `computed`'s body may declare arrow functions of its own: [Functions](https://docs.rs/ferrovue/latest/ferrovue/guide/script_logic/index.html#functions).
- A string known to hold ASCII alone may be cut into characters and joined again, and `s[i]` reads
  a string's code unit: [Halves of surrogate pairs](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#halves-of-surrogate-pairs).
- Object literals where their type is known, each built as its interface's Rust struct, with
  FV0634, FV0635 and FV0636 for the rest: [Object literals](https://docs.rs/ferrovue/latest/ferrovue/guide/script_logic/index.html#object-literals).
- A union of string literals or a string `enum` is a Rust enum the compiler generates, parsed with
  `FromStr` into it or a `ferrovue::ParseUnionError`: [Unions of string literals](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#unions-of-string-literals).
- `Date`s inside lists, dictionaries and interfaces of the props and of a loader's result, revived
  in the browser from a `data-dates` plan: [Dates inside lists and objects](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html#dates-inside-lists-and-objects).
- Every component has a `try_render` that returns a [`Refused`](https://docs.rs/ferrovue/latest/ferrovue/render/struct.Refused.html)
  for props it cannot write as Vue does, so a server can answer `400`: [Refused at render time](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#refused-at-render-time).
- An element with no content given a custom directive listed in `clientDirectives` compiles, and
  FV0425 refuses one whose merged attributes may hold its content: [FV0425](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0425).
- The guide page [`upgrading_to_0_11`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_11/index.html).
- A documentation site at <https://kinsmir.github.io/ferrovue/> with the guide and the changelog,
  linked from the README.

### Changed

- **Breaking:** generated code is version 5, which the 0.10 crate refuses; the 0.11 crate builds
  versions 2 to 5: [The version check](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#the-version-check).
- **Breaking:** the generated `Props` and shared structs hold an enum for each union of string
  literals, where they held a `Cow<'a, str>`: [`upgrading_to_0_11`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_11/index.html#3-build-union-props-from-their-enums).
- **Breaking:** a comparison or a child's prop outside a union is refused as TypeScript refuses
  it (FV0637, FV0515), and so is a union with no enum to be (FV0323 to FV0325): [`upgrading_to_0_11`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_11/index.html#4-error-codes-your-ci-matches).
- **Breaking:** the npm package needs Node 22.23.4 or newer on 22, 24.22.1 on 24, or 26.12.1,
  where it needed 22.18: [Node.js](https://docs.rs/ferrovue/latest/ferrovue/guide/support/index.html#nodejs).
- `render` and its `Html` and `Page` methods panic with the refusal's message
  (`error[FV1803]: …`) where they panicked with one of their own: [Refused at render time](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#refused-at-render-time).
- FV1806 refuses a `Date` only in Pinia state, `provide`, `inject`, a typed `ref` and a
  `defineModel`, and `reviveDates` takes an island's `data-dates`: [Dates inside lists and objects](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html#dates-inside-lists-and-objects).
- A refusal inside a `computed`, a setup expression or a function carries its own code and place,
  where it was FV0613 or FV0601, and loops have FV1909 to FV1912: [`upgrading_to_0_11`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_11/index.html#4-error-codes-your-ci-matches).
- An object literal in the template is refused with FV0634 where it was FV0625: [FV0634](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0634).
- The messages of FV0316, FV0513, FV0614, FV0814, FV1901 and FV1902 say what to write:
  [Error codes](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html).
- Generated code names its locals after the JavaScript names they hold (`fv_sum`), so an edit to one
  component keeps the names in the others: [The locals of a render](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#the-locals-of-a-render).
- The npm package depends on postcss 8.5.31 and @intlify/message-compiler 11.4.16.

### Fixed

- `Math.max()` and `Math.min()` of integers keep a `-0`, so `1 / Math.max(n * 0, -1)` is
  `-Infinity`: [How numbers are computed](https://docs.rs/ferrovue/latest/ferrovue/guide/numbers/index.html#how-numbers-are-computed).
- Integer arithmetic beyond ±2⁶³ is written as JavaScript writes it, and refused at render time
  with FV0724 where the template needs an integer: [How numbers are written](https://docs.rs/ferrovue/latest/ferrovue/guide/numbers/index.html#how-numbers-are-written).
- A child's prop named like a listener (`on1`, `onSale`) is left out when falsy where Vue joins
  props with `mergeProps`, with FV0516 and FV0517 for what cannot be: [Types](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#types).
- A value outside a closed union reads the union's last member in every lookup table and
  `<component :is>`: [`upgrading_to_0_11`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_11/index.html#lookups-and-component-is-over-a-union).
- A test that narrows a value holds through a chain of `&&` or `||`, which was FV0609, and a
  root's `:class="a && b"` leaves out the attribute where `a` is `undefined`.
- Names holding `$` are written as Rust identifiers, and a prop starting with `$` is refused with
  FV0328: [Names](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#names).
- A prop or field with no type (FV0326) and `defineProps` of an imported type (FV0327) are refused
  at their place, where the compile stopped with an error of its own.
- `<template lang="pug">` is refused with FV0008 and `<template src>` with FV0009, where the
  template was written as HTML or rendered as nothing.
- A `<textarea>` or an `<input v-model>` at a component's root is refused with FV0424, which says to
  wrap it, where it gave several errors with no line: [FV0424](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0424).
- A component may render itself by its kebab-case or camelCase name, which was FV0513.
- Generated Rust builds for `list ?? [...]`, `[].length` and a union field read from an object
  literal, and a copied list of numbers passes clippy.
- An array literal of object literals typed as a list of other values is refused with FV0634,
  where the compiler overflowed its stack.
- A refusal of an attribute bound alone and in a `v-bind` object points at the later binding.

## [0.10.0] - 2026-10-22

### Added

- Loaders: a component may `await` a loader declared with `defineLoader` at the top of its setup.
  The Rust app implements the generated `Loaders` trait and renders with `ferrovue::load`; see [Loaders](https://docs.rs/ferrovue/latest/ferrovue/guide/loaders/index.html#the-rust-side)
- The client hydrates loaders' results from the page's `<script data-fv-loads>`.
  `readPage` returns them as `loads`, and `provideLoads`, `clearLoads` and `loadKey` are new; see [Loaders](https://docs.rs/ferrovue/latest/ferrovue/guide/loaders/index.html#the-client)
- Functions declared in `<script setup>` or exported from a `.ts` file, called from the template
  and from `computed`s, with no `helpers` entry; see [Script logic](https://docs.rs/ferrovue/latest/ferrovue/guide/script_logic/index.html#functions)
- Statements in a `computed`'s body and a list method's callback: `const`, `if`, early `return`
  and `switch`; see [Script logic](https://docs.rs/ferrovue/latest/ferrovue/guide/script_logic/index.html#what-a-body-may-hold)
- Lookup tables: an object constant read by a key typed as a union of literals or an `enum`
  (`PAD[size]`), compiled to a `match`; see [Props](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#lookup-tables)
- `?:` whose branches differ in type where the value is only written out: in `{{ }}`, a
  string-valued attribute and a template literal; see [Upgrading to 0.10](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_10/index.html#newly-supported)
- `Object.entries(r)` outside a `v-for`, read by the list methods, and `.flat()` and `.flatMap()`.
  `Object.values(r)` of a record of lists compiles; see [Strings](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#building-lists)
- Imports of constants and types through the tsconfig's `paths` and Vite's `resolve.alias`.
  `generate` and `write` take `{ aliases }`; see [Props](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#imports-through-aliases)
- FV0110 refuses a name imported from a module no relative path or alias leads to.
  The message names the specifier and where it was looked for; see [FV0110](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0110)
- A run reports every refusal it finds and ends with a line that counts them.
  `generate` throws the new `GenErrors`, which holds them all; see [Errors and limits](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#refused-at-compile-time)
- A `= help:` line gives the way around a refusal where it is short.
  `GenError` and each diagnostic of `--format json` have the new `help`; see [Errors and limits](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#refused-at-compile-time)
- Every code in the error index has a detail: what is refused, why, and the ways around it.
- The guide page [Upgrading to 0.10](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_10/index.html).
- The guide pages [Porting](https://docs.rs/ferrovue/latest/ferrovue/guide/porting/index.html), for moving a Vue 3 server-rendered app to ferrovue,
  and [Support](https://docs.rs/ferrovue/latest/ferrovue/guide/support/index.html), the support policy.

### Changed

- **Breaking:** generated code is version 4, which the 0.9 crate refuses. Generate every component
  again; see [Upgrading to 0.10](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_10/index.html#2-generate-every-component-again)
- **Breaking:** some refusals have new codes for the same source: FV0110 for unresolved imports, and
  a constant's own code at the constant for FV0613; see [Upgrading to 0.10](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_10/index.html#4-error-codes-your-ci-matches)
- Messages name syntax in words and say what to do. FV0601 says where the function a template
  calls comes from; see [Upgrading to 0.10](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_10/index.html#messages)
- FV0221, FV0803, FV0806, FV0815 and FV1509 are retired.
- The deprecation warnings FV1117 and FV1118 say a deprecated key or option is removed in a later
  minor release; see [Support](https://docs.rs/ferrovue/latest/ferrovue/guide/support/index.html)
- The guide says where a `<script>` element in a template is allowed: in a component that renders
  on the server only; see [Errors and limits](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#refused-at-compile-time)

### Fixed

- `?:` between two objects read from props builds, and a computed list chosen by `?:` is
  collected once.
- An object constant written with `__proto__:` is refused with FV0206.
- A child's optional or nullable prop accepts a value of the same optional or nullable type, which
  FV0511 refused.

## [0.9.0] - 2026-10-20

### Added

- `Date` props, required, optional or nullable, read with `.getTime()`, `.toISOString()` and the
  `.getUTC…()` methods. Their Rust type is `ferrovue::JsDate`, or the `dateType` key's: [Date props](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html#date-props).
- `reviveDates(component, props)`, from `ferrovue` and `ferrovue/client`, turns an island's ISO
  strings back into dates, as `mountIslands` and `mountPage` do: [In the island's props](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html#in-the-islands-props).
- The `chrono` feature, off by default, takes `chrono::DateTime<chrono::Utc>` as the `dateType`
  and converts it to and from `JsDate`: [chrono](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html#chrono).
- FV1806 refuses a `Date` inside a list, a dictionary, an object prop, Pinia state, `inject`, `ref`
  or `defineModel`, which would reach the client as a string: [FV1806](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv1806).
- `.toUTCString()`, `.toJSON()` and `JSON.stringify()` of a date, `Date.UTC()`, and `<`, `<=`,
  `>`, `>=` and `||` between dates: [Dates in a template](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html#dates-in-a-template).
- FV1809 refuses `===`, `!==`, `==` and `!=` with a `Date`, and says to compare `.getTime()`:
  [FV1809](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv1809).
- `.toPrecision()` and `.toExponential()` of a number, with their twins `js_to_precision` and
  `js_to_exponential`: [How numbers are computed](https://docs.rs/ferrovue/latest/ferrovue/guide/numbers/index.html#how-numbers-are-computed).
- `Number.isNaN()`, `Number.isFinite()`, `Number.isInteger()`, `Number.isSafeInteger()`, and the
  global `isNaN()` and `isFinite()` of a number: [How numbers are computed](https://docs.rs/ferrovue/latest/ferrovue/guide/numbers/index.html#how-numbers-are-computed).
- `Math.sqrt()`, `Math.sign()` with its twin `js_sign`, the constants of `Math` and `Number`, and
  `**` and `Math.pow()` of known integers: [How numbers are computed](https://docs.rs/ferrovue/latest/ferrovue/guide/numbers/index.html#how-numbers-are-computed).
- List items by index (`list[i]`, `list.at(i)`, `list?.[i]`) and optional chains that go on past
  `?.` (`user?.profile.bio`): [Optional chains and list items](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#optional-chains-and-list-items).
- `.indexOf()`, `.lastIndexOf()`, `.findLast()`, `.findLastIndex()` and `.concat()` of a list:
  [Slicing lists](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#slicing-lists).
- `.reduce()`, `.reduceRight()`, `.toReversed()`, `.toSorted()`, spread in array literals and
  `Math.max(...xs)`: [Building lists](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#building-lists).
- `encodeURIComponent()` and `encodeURI()`, with their twins `js_encode_uri_component` and
  `js_encode_uri`: [URIs](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#uris).
- `String()`, template literals and `.concat()` of a value that may be absent, written as
  `undefined` or `null`, and of a list: [Strings from values](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#numbers-from-strings-and-strings-from-values).
- Positions and limits in `.includes()`, `.indexOf()`, `.split()` and their kin, `.substr()`,
  `.charCodeAt()` and `.codePointAt()`: [Counting in UTF-16 code units](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#counting-in-utf-16-code-units).
- `typeof`, worked out from each value's type, which narrows an optional value in `v-if`, `&&` and
  `?:`: [typeof](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#typeof).
- The guide pages [`upgrading_to_0_8`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_8/index.html) and [`upgrading_to_0_9`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_9/index.html).

### Changed

- Generated code is version 3, which the 0.8 crate rejects. The 0.9 crate still builds modules of
  version 2: [Generate every component again](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_9/index.html#2-generate-every-component-again).
- `in`, `instanceof`, `**`, the bitwise operators, engine-rounded `Math` functions and parts of
  globals the server does not translate get their own codes, and FV1234 is retired: [Error codes your CI matches](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_9/index.html#4-error-codes-your-ci-matches).
- `.toFixed()` takes a fractional literal, truncated as JavaScript truncates it, and `undefined`,
  which is `.toFixed(0)`: [`.toFixed()`](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_9/index.html#tofixed).
- The README is a landing page, and its reference sections moved into the crate guide.

### Fixed

- `Boolean(user)` of an optional object, list or `Date` wrote a closure rustc warns on, and is now
  `is_some()`: [Fixes that change generated code](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_9/index.html#fixes-that-change-generated-code).
- `.includes(v)` of a computed list or a list of fractions, with a `v-for` item named `v`, was
  `true` for every list that was not empty: [Fixes that change generated code](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_9/index.html#fixes-that-change-generated-code).
- FV0604 of a field of an optional value says that the value may be absent, and to narrow it with
  `v-if` or read it with `?.`: [FV0604](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0604).
- **Breaking:** a template literal that joins two halves of a surrogate pair across a string that
  may be empty is refused with FV0706: [Halves of surrogate pairs](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#halves-of-surrogate-pairs).

## [0.8.0] - 2026-10-18

### Added

- Dates in templates: `new Date(s)` of an ISO string, `new Date(ms)`, `.toISOString()` and the UTC
  getters, which read the same on the server and in every browser: [Dates and prices](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html#dates-in-a-template)
- Refusals FV1801 to FV1805 for the current time, local time zones and locale formatting, each
  pointing to the guide: [Error codes](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv1801)
- The guide page `dates_and_prices`, with prices and formatted dates written in Rust or vue-i18n:
  [Dates and prices](https://docs.rs/ferrovue/latest/ferrovue/guide/dates_and_prices/index.html#prices-and-formatted-dates)

### Changed

- **Breaking:** generated code is version 2, so modules generated by 0.7 must be generated again.
  [Upgrading to 0.8](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_8/index.html#2-generate-every-component-again)
- **Breaking:** `RouteDef`, `i18n::Locale`, `Message`, `Args`, `HeadHtml` and `Link` are
  `#[non_exhaustive]`, built with constructors: [Upgrading to 0.8](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_8/index.html#3-rust-you-write-against-the-crates)
- **Breaking:** the runtime functions only generated code calls (`js_trim`, `class_into` and more)
  are `#[doc(hidden)]`: [Upgrading to 0.8](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_8/index.html#3-rust-you-write-against-the-crates)
- `Slot::new`, `Part::new`, `Page::slot` and four more constructors and getters are `#[must_use]`.
  [Upgrading to 0.8](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_8/index.html#3-rust-you-write-against-the-crates)
- A number compared with itself (`x === x`) compiles to `!x.is_nan()`, which Clippy accepts.
- A call of a setup binding the server cannot evaluate is refused as FV0613 with the reason, where
  it was FV0601: [Error codes](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0613)
- The npm package compiles with `@vue/compiler-sfc` 3.5.44, and the peer ranges move to `vue`
  `~3.5.44`, `vue-router` `~5.4.0` and `pinia` `~4.1.0`: [Upgrading to 0.8](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_8/index.html#1-bump-both-halves-and-the-peers-together)
- `ferrovue` and `ferrovue-router` require `serde_json` 1.0.154, and the `actix-web` feature
  actix-web 4.17.0.

### Removed

- **Breaking:** `ferrovue::ammonia`. A `Sanitised::with` policy takes `ammonia` 4 as a dependency
  of your own crate: [Upgrading to 0.8](https://docs.rs/ferrovue/latest/ferrovue/guide/upgrading_to_0_8/index.html#3-rust-you-write-against-the-crates)

### Fixed

- FV0613 gives one location, where the template reads the binding.
- A `computed` that throws in JavaScript no longer panics when the render does not read it (#112).
  [Errors and limits](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#at-run-time)

### Security

- The `ammonia` feature requires ammonia 4.2.4, which fixes CSS `url()` and SVG animation XSS in a
  `Sanitised::with` policy that allows `style` or SVG: [Escaping](https://docs.rs/ferrovue/latest/ferrovue/guide/escaping/index.html#ferrovuehtmlsanitised-with-the-ammonia-feature)

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

- Every compiler error has a stable `FV` code, which the CLI and the Vite plugin's overlay print
  with a link to its entry: [`error_codes`](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html).
- `ferrovue --format json` writes diagnostics as JSON, and the quick start gives a VS Code problem
  matcher: [Editor and CI diagnostics](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html#editor-and-ci-diagnostics).
- Whole-page hydration beside islands: `ferrovue::Page` records what a layout's slots hold, and
  `mountPage` hydrates the page from that record (#33): [Hydrating a page](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#hydrating-a-page).
- `hydrateRecordedPage` in `ferrovue/testing` hydrates a recorded page and throws on any mismatch:
  [Testing a page](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#testing-a-page).
- `T | null` in props, shared types and Pinia state is an `Option<T>` written as `null`, and
  templates test and read it as Vue does: [Nullable props](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#nullable-props).
- `props.x` in the template when `props` is bound to `defineProps()` or `withDefaults(…)`.
- Components with no `<script>`, or an empty `<script setup>`, compile as components without props.
- Refs that start empty are typed by their type argument: `ref<Row[]>([])`, `ref<Row>()`.
- Generic components: `<script setup generic="T extends Item">` renders each type parameter as its
  constraint: [Types](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#types).
- Constants imported from `.ts` files and TypeScript `enum`s are evaluated at compile time, and an
  enum may be a prop type: [Constants](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#constants).
- `useSlots()`: `slots.header` tests a slot's presence as `$slots.header` does.
- `"builders": false` in `ferrovue.config.json` leaves out the generated `new()` and setters
  (#35): [Building props](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#building-props).
- `linkRouter(routes, { navigate })` from `ferrovue/link-router`, for an application whose own
  navigation leaves the page (#34): [Links when the application navigates on its own](https://docs.rs/ferrovue/latest/ferrovue/guide/routing/index.html#links-when-the-application-navigates-on-its-own).
- `<ClientOnly>`: the server writes its `#fallback` slot, and the browser swaps in the default slot
  once mounted: [Client-only content](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#client-only-content).
- Rust twins: a component listed under `twins` in `ferrovue.config.json` is rendered by a Rust
  function of the project's: [Rust twins](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#rust-twins).
- `defineAsyncComponent(() => import("./X.vue"))` renders as the component it loads.

### Changed

- The `vue` peer is `~3.5.43`, and the optional peers are held to a minor: `vue-router` `~5.3.1`,
  `pinia` `~4.0.3`, `vue-i18n` `~11.4.13`: [Vue and its integrations](https://docs.rs/ferrovue/latest/ferrovue/guide/support/index.html#vue-and-its-integrations).
- Every refusal names a line and column in the `.vue` file, `new Date(…)` and `<component :is>`
  among those that had none.
- A component written with the Options API is refused with a message that asks for
  `<script setup lang="ts">` or no script at all.

### Fixed

- `undefined ?? x` gives `x`, and a value known to be `undefined` is falsy, as in JavaScript.
- `.includes()` of a list of numbers takes an integer or a `Float`, and compares `-0` equal to `0`.

## [0.4.0] - 2026-10-05

### Changed

- **Breaking:** the package root `ferrovue` is the browser API (`mountIslands`, `hydrateState`),
  and the compiler's API (`generate`, `write`, the configuration types) is `ferrovue/compiler`.
- The runtime is four crates released at one version, `ferrovue-core`, `ferrovue-router`,
  `ferrovue-i18n` and `ferrovue`, which re-exports the others: [One version line](https://docs.rs/ferrovue/latest/ferrovue/guide/support/index.html#one-version-line).
- `ferrovue` has the default features `router` and `i18n`; with `default-features = false` an
  application builds neither crate.

### Fixed

- A prop named after a Rust keyword compiles, as `r#type`, or `self_`, `Self_`, `super_` and
  `crate_` for the four with no raw form (#19): [Names](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#names).
- `ferrovue/testing` loads in a project that installs only `vue`, and imports each optional peer
  when a fixture needs it (#22).
- Generated code passes `cargo clippy -- -D warnings`: a `Props` with no required field derives
  `Default`, and string constants are folded into the render (#21).
- Generated Rust that did not compile: a child's attribute holding a string built in a `?:` or
  `&&` branch, and an arrow function's string item in a `?:` branch.

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
