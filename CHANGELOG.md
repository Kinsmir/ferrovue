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
- FV0623's detail says a `?:` whose branches differ in type compiles where it is only written out:
  [FV0623](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0623).
- An `enum` member set to a constant of its component or to an earlier member is evaluated as TypeScript does.
  0.11.0 refused it with FV0315, and read a member named like a constant as that constant: [Constants](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#constants).

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

- `ferrovue::Chunks` reads Vite's manifest and writes the `<link rel="modulepreload">` tags of the
  chunks a page's islands need (#96): [Preloading the islands](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#preloading-the-islands).
- A client build with a manifest writes `.vite/ferrovue-islands.json` beside it, naming the chunk
  that holds each island, which `Chunks` reads: [Preloading the islands](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#preloading-the-islands).
- `PageRecord::island_names()` names the components a page's record holds so far, and
  `Part::name()` a part's: [`PageRecord`](https://docs.rs/ferrovue/latest/ferrovue/page/struct.PageRecord.html).

### Changed

- The npm package depends on `postcss` `^8.5.29`.

## [0.7.1] - 2026-10-09

### Fixed

- `conformanceSuite`'s client-render check and `renderRecordedPage` read a recorded `<select>`'s
  selection from its `selected` attributes, as the HTML parser does (#91): [Testing a page](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#testing-a-page).

## [0.7.0] - 2026-10-09

### Added

- `ferrovue/volar`, a plugin for Vue's language tools, underlines what ferrovue refuses as a
  component is edited, with the error's code linked to its documentation: [Diagnostics in your editor](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html#diagnostics-in-your-editor).
- Generated code checks its version: `mod.rs` opens with `ferrovue::__compat!(1)`, which stops a
  build against another release's crate with one message: [The version check](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#the-version-check).
- The generated-code guide states which files, modules and items of generated code are stable: [What is stable](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#what-is-stable).
- `v-bind()` in `<style>`, scoped or global, with the `isProduction` key naming its variables as
  plugin-vue does. A value that is not a string or a number is FV1006: [`v-bind()` in `<style>`](https://docs.rs/ferrovue/latest/ferrovue/guide/scoped_styles/index.html#v-bind-in-style).
- CSS modules (`<style module>`, `$style.x`, `useCssModule()`), when `cssModules` in
  `ferrovue.config.json` mirrors Vite's `css.modules`: [CSS modules](https://docs.rs/ferrovue/latest/ferrovue/guide/scoped_styles/index.html#css-modules).
- `attachSsrRender` and the client-render checks of `ferrovue/testing` give a component the
  `v-bind()` variables in `<style>` that plugin-vue and a mounted Vue give it: [Testing a page](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#testing-a-page).
- Navigating between pages (#74): `readPage`, `renderPage` and `hydrateState` show a fetched page
  from its record with no reload: [Navigating between pages](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#navigating-between-pages).
- `Boolean` is taken as the function of `.filter()`, `.map()`, `.some()`, `.every()`, `.find()`
  and `.findIndex()`, and `Boolean(x)` as a call: [Slicing lists](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#slicing-lists).
- The Vite plugin takes `config`, the configuration file relative to `root`, as
  `ferrovue --config` does: `ferrovue({ config: "config/ferrovue.json" })`.
- A JSON Schema of `ferrovue.config.json`, shipped as `ferrovue/schema.json`, which
  `ferrovue init` names in `$schema` for editors: [Configure](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html#2-configure).
- A deprecated configuration key warns with FV1117 and a deprecated command-line option with
  FV1118, each naming its replacement: [Deprecations](https://docs.rs/ferrovue/latest/ferrovue/guide/support/index.html#deprecations).
- The types the npm package's API names are exported where it names them (`ErrorCode` and
  `SourceLocation` from `ferrovue/compiler`), with the table `ERRORS` and `docsUrl(code)`.
- The `.tgz` and `.crate` files of a GitHub release carry build provenance, which
  `gh attestation verify ferrovue-X.Y.Z.tgz --repo Kinsmir/ferrovue` checks.

### Changed

- **Breaking:** `Attr`, `HeadValue`, `Query`, `i18n::Part` and `i18n::Value` are
  `#[non_exhaustive]`, and the runtime's pure public functions are `#[must_use]`.
- The minimum supported Rust version is 1.89, down from 1.99: [Rust](https://docs.rs/ferrovue/latest/ferrovue/guide/support/index.html#rust).
- `ferrovue.config.json` is checked as it is read: a file holding no object (FV1113), an unknown
  key (FV1114) and a value of the wrong type (FV1115, FV1107, FV1110) are refused.
- `ferrovue` removes from `out` only the `.rs` files that open with its `// @generated by ferrovue`
  header, and `--check` reports any other file there: [The output directory](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#the-output-directory).
- `ferrovue --watch` and the Vite plugin's dev server regenerate only on a change to a file a run
  reads: the configuration, components, stores, messages, pages, routes and `.ts` type files.
- `ferrovue` refuses `--check` with `--watch`, `init` with `--check`, `--watch`, `--diff` or
  `--format json`, an option missing its value, and a value given to an option that takes none.
- A type in a `.ts` file or a component is translated, and written to `types.rs`, only when the
  server render reaches it (#77). Two files declaring a reached name are FV0319: [Shared types](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#shared-types).
- The `security` guide page is a threat model: the trust boundaries, and the guarantee at each place
  data is written: [Security](https://docs.rs/ferrovue/latest/ferrovue/guide/security/index.html).
- `fixtureApp`'s `pinia`, `vueRouter` and `vueI18n` options and `conformanceSuite`'s `record`
  accept `undefined`, for a project type-checked with `exactOptionalPropertyTypes`.
- Fewer allocations when merging attributes, writing fractions, rendering the head and writing an
  island's props. The output is unchanged.

### Removed

- The undocumented `affects` export of `ferrovue/vite`.

### Fixed

- A component whose `render` takes more than seven arguments generates code that passes
  `cargo clippy -- -D warnings`.
- A missing components, stores or messages directory is FV1116, and a missing or invalid routes
  file FV1246 or FV1247, each naming the path. A store or type file that does not parse is FV0001.
- `ferrovue --watch` and the Vite plugin's dev server show an error that is not a refusal and
  regenerate once it is put right, and a watch that cannot start says so.
- `mountIslands` reports an island that throws as it mounts through `onError` and hydrates the
  islands after it.
- A `Page`'s record holds `null` for props serde_json refuses, and a debug build panics with serde's
  error: [At run time](https://docs.rs/ferrovue/latest/ferrovue/guide/errors_and_limits/index.html#at-run-time).
- A vue-i18n plural choice with a count of `NaN` over three cases picks what `Math.min` does.
- On Windows, paths in generated code, diagnostics, `init`'s output, the conformance suite's diffs
  and the watch filters are written with `/`.
- Listeners on a component compile beside a `v-bind` of the child's own `Props`, where they were
  FV0503 (#75), and a prop named like a listener (`onSale`) takes the value bound to it.
- An empty array literal takes its element type from the list beside it (#76), and an `as` or
  `satisfies` that states another type than the value's is FV0628: [`FV0628`](https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0628).

### Security

- A `useHead` value holding `<fv-hole>` could move a streaming hole. The marker is
  `<fv-hole"</script</style</noscript>`, which no value ferrovue or unhead writes can hold: [Holes](https://docs.rs/ferrovue/latest/ferrovue/guide/security/index.html#holes).

## [0.6.0] - 2026-10-06

### Added

- A conformance suite for applications (#45): `conformanceSuite` from `ferrovue/testing` and
  `ferrovue::conformance!` hold each component's fixtures to Vue's render: [Testing](https://docs.rs/ferrovue/latest/ferrovue/guide/testing/index.html).
- Islands that hydrate later: `island(&props).hydrate(Hydrate::Visible)`, `Idle`, `Interaction` or
  a media query, with the island's chunk loaded when it fires: [Hydrating later](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#hydrating-later).
- `provide` and `inject`, resolved through the component tree at build time, under a string key or
  an `InjectionKey<T>`: [Provide and inject](https://docs.rs/ferrovue/latest/ferrovue/guide/provide_inject/index.html).
- `<component :is>` over a closed set of choices (imported components, element names, a union
  prop, an object of them), compiled to a `match`: [`<component :is>`](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#component-is).
- The page head: `useHead`, `useServerHead`, `useSeoMeta` and `useServerSeoMeta` from `@unhead/vue`
  3, collected by `ferrovue::Head`, which renders what unhead's server renders: [Head](https://docs.rs/ferrovue/latest/ferrovue/guide/head/index.html).
- `ferrovue::Sanitised`, with the crate's new `ammonia` feature: HTML cleaned by ammonia, for
  `v-html` props: [`Sanitised`](https://docs.rs/ferrovue/latest/ferrovue/guide/escaping/index.html#ferrovuehtmlsanitised-with-the-ammonia-feature).
- `ferrovue::BasicHtml`, a `TrustedHtml` with no dependency that escapes its input and keeps a few
  formatting tags: [`BasicHtml`](https://docs.rs/ferrovue/latest/ferrovue/guide/escaping/index.html#ferrovuehtmlbasichtml).
- `InlineHtml` from `ferrovue/types` and `ferrovue::InlineHtml`, trusted HTML of inline tags only,
  which `v-html` may write inside a `<p>`: [Where `v-html` may go](https://docs.rs/ferrovue/latest/ferrovue/guide/escaping/index.html#where-v-html-may-go).
- Routes from a folder of pages, as vue-router's file-based routing builds them:
  `"routes": { "pages": "client/pages" }`: [File-based routes](https://docs.rs/ferrovue/latest/ferrovue/guide/routing/index.html#file-based-routes).
- The router matches optional parameters (`:id?`) and routes that only group others, as
  vue-router does: [Configuring the routes](https://docs.rs/ferrovue/latest/ferrovue/guide/routing/index.html#configuring-the-routes).

### Changed

- **Breaking:** `ferrovue::RouteDef` has a `view` field, which a `RouteDef` written by hand sets.
  `Route::link_named` takes a missing required parameter from the current location: [The generated route table](https://docs.rs/ferrovue/latest/ferrovue/guide/routing/index.html#the-generated-route-table).
- **Breaking:** a component's slot closures take `Provides` last when it takes `Provides`, and a
  component that provides, injects or calls `useHead` has no `island()`: [Slots](https://docs.rs/ferrovue/latest/ferrovue/guide/provide_inject/index.html#slots).
- **Breaking:** a `provide(…)` not imported from `vue` is refused (FV0105), where it was ignored.
- **Breaking:** `v-show`, and `v-model` on a `<select>`, in the content of a `<RouterLink>` or of a
  Rust twin's slot are refused (FV0423), since Vue renders that content from virtual nodes.
- **Breaking:** `v-html` where the browser's parser rebuilds the HTML is refused (FV1512), and HTML
  in a `<p>` that is not `InlineHtml` (FV1513): [Where `v-html` may go](https://docs.rs/ferrovue/latest/ferrovue/guide/escaping/index.html#where-v-html-may-go).
- The published crates leave out the test data they do not need: the `ferrovue` crate goes from
  1134 files (2.0 MiB) to 64 (620 KiB).

### Fixed

- `fixtureApp` takes the application's own `pinia`, `vueRouter` and `vueI18n` modules, so a fixture
  with `$stores` finds its Pinia (#47): [Fixtures in your own vitest tests](https://docs.rs/ferrovue/latest/ferrovue/guide/testing/index.html#fixtures-in-your-own-vitest-tests).
- A fixture's slot content given as `""` hydrates.
- Content Vue renders from virtual nodes (in a `<RouterLink>`, a twin's slot, `<component :is>`)
  writes attribute names and classes as Vue's server does. `<ClientOnly #fallback>` there is FV1511.
- In content Vue renders from virtual nodes, a static `class` written before `:class` with other
  attributes between the two is refused (FV1013).
- A component whose file is named after a Rust keyword (`Type.vue`) compiles, and a file name that
  is not a Rust name or clashes with another module is refused (FV0007).
- A `.vue` file that is empty or holds only a `<style>` is refused (FV0002) at line 1, column 1,
  named by its path relative to the project.
- A setup or provided string built from another temporary
  (`props.label.toLowerCase().padStart(6, "0")`) compiles.
- An integer setup value computed through JavaScript's arithmetic (`props.n * -1`) keeps `-0`.
- Strings holding bidirectional controls (U+202A to U+202E, U+2066 to U+2069) compile.
- A string `:class` with whitespace around it, given to a component loaded with
  `defineAsyncComponent`, is written twice, as Vue's async wrapper writes it.
- A fallthrough attribute holding a `??` whose fallback ends in another `??` compiles.
- A component that reads Pinia stores compiles when no store's state holds a string.
- The messages a vue-i18n message links to (`@:key`) are looked up from the locale where `t()`
  found that message, as vue-i18n does.
- `.map()` over strings whose arrow returns the item on one branch and a new string on the other
  compiles.
- A `v-for` inside another, over a list filtered or mapped with a value a `v-if` around it
  narrows, compiles.

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

- `ferrovue init` writes a starter `ferrovue.config.json` and `components/Hello.vue`:
  [2. Configure](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html#2-configure).
- CLI options `--config` (`-c`), `--check --diff` (`-d`), `--version` (`-v`) and `--help` (`-h`),
  and a missing or invalid `ferrovue.config.json` is reported without a stack trace.
- `VERSION`, exported from `ferrovue`.
- `typeof route.query.q === "string"` narrows a query value to a single string:
  [`typeof`](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#typeof).
- `Html` is an axum `IntoResponse` and an actix-web `Responder`, and `ferrovue::HtmlStream`
  streams a page with holes, each behind a feature: [`web_frameworks`](https://docs.rs/ferrovue/latest/ferrovue/guide/web_frameworks/index.html).
- `into_html(props)` and `into_island(props)` take the props by value, so a handler returns the
  page it builds: [A component](https://docs.rs/ferrovue/latest/ferrovue/guide/web_frameworks/index.html#a-component).
- `Debug` for every public type in the crate; `Link` also derives `Clone`, `PartialEq` and `Eq`.
- `ferrovue/islands`, written by the Vite plugin, loads each island's component lazily, and
  `mountIslands` takes loaders beside components: [Islands](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#islands).
- Fallthrough attributes reach a child's root as in Vue, `inheritAttrs: false` and `$attrs`
  included: [Fallthrough attributes](https://docs.rs/ferrovue/latest/ferrovue/guide/generated_code/index.html#fallthrough-attributes).
- Dioxus 0.7: with the `dioxus` feature, an island goes straight into `rsx!`:
  [`dioxus`](https://docs.rs/ferrovue/latest/ferrovue/guide/dioxus/index.html).

### Changed

- **Breaking:** an attribute bound to a value that may be an array or an object, a `route.query`
  value included, is refused, as Vue's client rewrites it on hydration: [`typeof`](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#typeof).
- `ferrovue::Js` derives `Clone`, `Copy` and `Debug`.

### Fixed

- A `Float` that is `NaN` or infinite reaches the client as itself in `data-props` and the state
  script: [Keeping islands exact](https://docs.rs/ferrovue/latest/ferrovue/guide/numbers/index.html#keeping-islands-exact).
- A root's `:class` of an absent optional string writes no `class=""`, and a root's `:style`
  string is written as Vue's `mergeProps` normalises it.
- A string built by a runtime routine compiles as the left side of `||`:
  `text.slice(1).toLowerCase() || "-"`.
- Slot content that writes nothing visible shows the slot's fallback exactly when Vue's does:
  [What generated parents do](https://docs.rs/ferrovue/latest/ferrovue/guide/slots/index.html#what-generated-parents-do).

## [0.2.0] - 2026-10-04

### Added

- `<style scoped>`: `data-v-` ids as Vue's server renderer writes them, computed as
  `@vitejs/plugin-vue` computes them: [The id, and matching the client build](https://docs.rs/ferrovue/latest/ferrovue/guide/scoped_styles/index.html#the-id-and-matching-the-client-build).
- `fixtureApp` in `ferrovue/testing` takes `client: true`, and `attachSsrRender` compiles a
  `<style scoped>` component with its `__scopeId`.
- Fractional numbers: a `Float` prop is an `f64`, and `/`, `%`, `Math` and `.toFixed()` work as in
  JavaScript, written by `ferrovue::push_number`: [How numbers are computed](https://docs.rs/ferrovue/latest/ferrovue/guide/numbers/index.html#how-numbers-are-computed).
- `ferrovue::class_object`, for a `class` object with computed names.
- Errors point into the `.vue` file, with the line quoted and a caret under the construct.
- `mountIslands` in `ferrovue/client` hydrates every island on the page, sharing one Pinia and one
  router: [Islands](https://docs.rs/ferrovue/latest/ferrovue/guide/islands_and_hydration/index.html#islands).
- `ferrovue --watch`, and a Vite plugin (`ferrovue/vite`) that regenerates on change and shows a
  refusal in the error overlay: [4. Generate](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html#4-generate).
- Generated props and types have `new(required…)` and a setter per optional field:
  [Building props](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#building-props).
- The crate's documentation stands on its own on docs.rs, with a quick start and the guide
  `ferrovue::guide`, whose examples run as doctests: [`guide`](https://docs.rs/ferrovue/latest/ferrovue/guide/index.html).
- `route.query` and `route.fullPath`, parsed as vue-router parses them:
  [`useRoute()` and `$route`](https://docs.rs/ferrovue/latest/ferrovue/guide/routing/index.html#useroute-and-route).
- vue-i18n: `$t` and `useI18n()`, with messages compiled by vue-i18n's own message compiler:
  [What is supported](https://docs.rs/ferrovue/latest/ferrovue/guide/i18n/index.html#what-is-supported).
- Nested routes, with the active and exact-active classes `useLink` gives them. The generated
  `route_table::ROUTES` is a tree of `RouteDef`s: [Configuring the routes](https://docs.rs/ferrovue/latest/ferrovue/guide/routing/index.html#configuring-the-routes).
- `<Teleport>`, its content collected by `ferrovue::Teleports` for the page to place:
  [`teleports`](https://docs.rs/ferrovue/latest/ferrovue/guide/teleports/index.html).
- Pinia setup stores: [Configuring](https://docs.rs/ferrovue/latest/ferrovue/guide/pinia/index.html#configuring).
- Narrowing as TypeScript narrows: `x !== undefined`, `!x` and `x === undefined`, in `?:`, `&&` and
  `||` as well as `v-if`.
- String methods counted in UTF-16 code units, `.slice()`, `.indexOf()`, `.split()`, `.replace()`
  and `.padStart()` among them: [Counting in UTF-16 code units](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#counting-in-utf-16-code-units).
- `<`, `>`, `<=` and `>=` between strings, by UTF-16 code unit:
  [Ordering](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#ordering).
- Array methods with arrow functions: `.filter()`, `.map()`, `.some()`, `.every()`, `.find()`,
  `.findIndex()` and `.slice()`, chained and nested.
- `Record<string, T>` props as `ferrovue::Record`, which keeps JavaScript's order of keys:
  [Dictionaries](https://docs.rs/ferrovue/latest/ferrovue/guide/props/index.html#dictionaries).
- `Number()`, `parseInt()`, `parseFloat()` and `JSON.stringify()`:
  [Numbers from strings, and strings from values](https://docs.rs/ferrovue/latest/ferrovue/guide/strings/index.html#numbers-from-strings-and-strings-from-values).

### Changed

- `ferrovue` writes only the files whose text changed and removes those no component produces.
  `write()` returns what it changed.
- The CLI prints a refused construct as an error message, without a stack trace.
- Generated code passes `cargo clippy -- -D warnings` with `dead_code` allowed, and binds no value
  nothing reads.
- Numbers and short strings render faster, and a generated `render` reserves room for what it
  writes.

### Fixed

- A child component given no props (`<Child />`) renders, where it was refused.
- Generated Rust that did not compile: an integer literal beyond 2⁵³, and `?:`, `||` and `??`
  choosing between strings the component holds and builds.
- A class object lists repeated names and array-index names as a JavaScript object does, and keeps
  the spaces inside a computed name.
- Integers beyond ±2⁵³ are written, added and compared as JavaScript does, so such a prop no longer
  causes a hydration mismatch.
- `-0` is kept by integer arithmetic and by `Math.round` from `-0.5` up to zero, and a number
  halfway between two shortest spellings is written with the even digit.
- An empty route parameter fails a debug build's render, as vue-router fails it.
- vue-i18n: a fractional `count` or `n` chooses the plural case as vue-i18n does (`1.5` is plural).

## [0.1.0] - 2026-10-04

### Added

- First standalone release of the compiler (`ferrovue` on npm, with the `ferrovue` command) and
  the runtime (`ferrovue` on crates.io).
- Script setup: `withDefaults`, destructured props, `defineModel`, lifecycle hooks, `watch`,
  template refs, shared types imported from `.ts` files, and a plain `<script>` block.
- Templates: template literals, optional chaining, string and list methods, `Math`, `v-for` over
  ranges, `class` objects, `:style`, `v-show`, `:hidden`, scoped slots and `<Suspense>`.
- vue-router (named routes, `RouterLink`, `useRoute()`) and Pinia getters, with `Router` and
  `Route` in the crate.

### Fixed

- `.length` of a string counts UTF-16 code units (`ferrovue::js_length`), where it counted bytes.
- Slot content made only of comments is dropped when the slot has no fallback, as Vue drops it.

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
