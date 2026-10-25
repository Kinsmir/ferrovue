How a component's props become a Rust struct, and how to build one.

Props are declared by type in the component: `defineProps<{ … }>()`, an interface, or a type alias,
optionally with `withDefaults` or destructured defaults. The compiler writes one `Props` struct with
a public field per prop, and a struct for every interface or object type alias the props use.

# Types

| TypeScript | Rust field | Builder takes |
|---|---|---|
| `string` | `Cow<'a, str>` | `impl Into<Cow<'a, str>>`: a `&str`, a `String`, a `Cow` |
| `number` | `i64` | `i64` |
| `Float` (from `ferrovue/types`) | `f64` | `f64` |
| `boolean` | `bool` | `bool` |
| `"sm" \| "md" \| "lg"`, `type Size = "sm" \| "md" \| "lg"` | an enum generated for the union: `Size`, or `ButtonSize` for `size` of `Button.vue` written in place. See [Unions of string literals](#unions-of-string-literals) | the enum, `Size::Md` |
| `enum Tone { Calm = "calm" }`, `enum Rank { Low, High }` | an enum `Tone` with the variant `Calm`, as a union of its values; `i64` for numbers | the enum, as `number` |
| `string[]`, `Array<string>`, `readonly string[]` | `Vec<Cow<'a, str>>` | `impl IntoIterator<Item = impl Into<Cow<'a, str>>>` |
| `Size[]`, `("sm" \| "md")[]` | `Vec<Size>`, a list of the union's enum | `impl IntoIterator<Item = Size>` |
| `number[]`, `Row[]`, `(Size \| null)[]`, … | `Vec<i64>`, `Vec<Row<'a>>`, `Vec<Option<Size>>`, … | the `Vec` |
| `interface Row { … }`, `type Row = { … }` | a struct `Row<'a>` beside `Props`, or in `types.rs` when imported from a `.ts` file | the struct |
| `Record<string, T>`, `{ [key: string]: T }` | [`ferrovue::props::Record<'a, T>`](crate::props::Record) | the `Record`, collected from pairs. See [Dictionaries](#dictionaries) |
| `Props` imported from another component | `super::child::Props<'a>` | the struct |
| `TrustedHtml` (from `ferrovue/types`) | the type configured as `trustedHtml` | that type. See [`escaping`](crate::guide::escaping) |
| `Date`, as a prop or inside a list, a dictionary or an interface | [`ferrovue::date::JsDate`](crate::date::JsDate), or the type configured as `dateType` | that type. See [`dates_and_prices`](crate::guide::dates_and_prices#date-props) |
| `x?: T`, `x: T \| undefined` | `Option<T>` | a setter, `.x(value)` |
| `x: T \| null` | `Option<T>`, written as `null` | a setter, `.x(value)` |
| `T`, of `<script setup generic="T extends Row">` | the type of its constraint, `Row<'a>` | as the constraint |

A `number` is an integer on the server, which is what most props are: counts, ids, indexes. Declare
a prop that may hold a fraction as `Float`. [`numbers`](crate::guide::numbers) explains how both are
computed and written.

A union of string literals is an enum, so Rust holds the values TypeScript allows and no other.

Strings are `Cow`s so that props can borrow from what the request already holds, and so that a
parent handing an object to a child copies only pointers.

A parent's template names a child's props as Vue matches them, `camelCase` or `kebab-case`
(`:item-count` sets `itemCount`). Anything else it passes is not a field of `Props`: it is an
attribute, which falls through to the child's root
([`generated_code`](crate::guide::generated_code#fallthrough-attributes)).

A prop whose name starts with `on` and a character other than a lowercase letter (`on1`, `onSale`)
is named like a listener. Where Vue joins a child's props with `mergeProps` (the child is the
root of the parent's template, or is given `v-bind` of an object or `v-on` of an object beside
other props), `mergeProps` leaves such a prop out when its value is falsy (`0`, `NaN`, `""`,
`false`), and the child takes its default. The generated code does the same for an optional prop.
A required one that may be falsy there is refused (FV0517), and so is one given twice (FV0516).
Elsewhere the value is passed on as written.

# Optional props and defaults

An optional prop is an `Option`, `None` unless its setter is called. A default from `withDefaults`
or a destructured default (`const { size = "md" } = defineProps<…>()`) is applied while rendering, so
the field stays `None` and the island's JSON leaves it out, as Vue's would. An optional `boolean`
that is absent renders as `false`, which is the cast Vue applies.

# Unions of string literals

A prop, a `defineModel`, a field of an interface or a `ref` typed as a union of two or more string
literals is a Rust enum the compiler generates, with a variant for each literal:
`size: "sm" | "md" | "lg"` is `Option<ButtonSize>` for an optional `size` of `Button.vue`, and
`Size` for `size: Size` with `type Size = "sm" | "md" | "lg"`. A string `enum` is one too, its
variants named after its members. A list of the union is a list of the enum: `sizes: Size[]` is
`Vec<Size>`, `Option<Vec<Size>>` when it is optional or nullable, and `(Size | null)[]` is
`Vec<Option<Size>>`. A Rust caller can then build only the values TypeScript allows.

| The union is | The enum is named | and written to |
|---|---|---|
| a `type` alias, or a string `enum` | the alias or the `enum`: `Size` | the module of the file that declares it: `types.rs` for a `.ts` file, so components that import it share one enum; the component's module for a component's own |
| written in place in `defineProps<{ … }>()` | the component and the prop in PascalCase: `ButtonSize` | the component's module |
| written in place in an interface's field | the interface and the field: `RowKind` | where the interface is written |
| written in place in `ref<…>()` | the component and the `ref`: `ButtonMode` | the component's module |

Each variant is the literal's letters and digits in PascalCase: a word starts at each character
that is not one, and at a lower-case letter followed by an upper-case one; each word is its first
letter upper-cased and the rest lower-cased. `"sm"` is `Sm`, `"x-large"` is `XLarge`, `"XL"` is
`Xl`, `"fooBar"` is `FooBar`, `"2xl"` is `V2xl` (a name starts with a letter), `"_self"` is `Self_`
(`Self` is a keyword), and `""` is `Empty`. A literal with no letter or digit (`"+"`) is refused
([FV0323](crate::guide::error_codes#fv0323)), and so are two that give one name (`"md"` and `"MD"`,
[FV0324](crate::guide::error_codes#fv0324)). An enum named as another type of its module, a struct,
another union of another file or a Rust prelude type, is refused too
([FV0325](crate::guide::error_codes#fv0325)): name the union with a `type` alias of its own. Two
`.ts` files that declare one union by one name, with the same literals in the same order, share its
enum.

```rust
# mod button {
# /// `size` in `Button.vue`: `"sm" | "md" | "lg"`.
# #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
# pub enum ButtonSize {
#     #[serde(rename = "sm")]
#     Sm,
#     #[serde(rename = "md")]
#     Md,
#     #[serde(rename = "lg")]
#     Lg,
# }
#
# impl ButtonSize {
#     /// Every member, in the order the union declares them.
#     pub const ALL: [ButtonSize; 3] = [ButtonSize::Sm, ButtonSize::Md, ButtonSize::Lg];
#
#     /// The string literal this member stands for.
#     pub const fn as_str(self) -> &'static str {
#         match self {
#             ButtonSize::Sm => "sm",
#             ButtonSize::Md => "md",
#             ButtonSize::Lg => "lg",
#         }
#     }
# }
#
# impl std::fmt::Display for ButtonSize {
#     fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
#         f.write_str(self.as_str())
#     }
# }
#
# impl std::str::FromStr for ButtonSize {
#     type Err = ferrovue::props::ParseUnionError;
#
#     fn from_str(s: &str) -> Result<Self, Self::Err> {
#         match s {
#             "sm" => Ok(ButtonSize::Sm),
#             "md" => Ok(ButtonSize::Md),
#             "lg" => Ok(ButtonSize::Lg),
#             _ => Err(ferrovue::props::ParseUnionError::new("ButtonSize", s, &["sm", "md", "lg"])),
#         }
#     }
# }
#
# impl TryFrom<&str> for ButtonSize {
#     type Error = ferrovue::props::ParseUnionError;
#
#     fn try_from(s: &str) -> Result<Self, Self::Error> {
#         s.parse()
#     }
# }
#
# /// The props `Button.vue` declares.
# #[derive(Debug, Clone, Default, serde::Serialize)]
# pub struct Props {
#     #[serde(rename = "size", default, skip_serializing_if = "Option::is_none")]
#     pub size: Option<ButtonSize>,
# }
#
# impl Props {
#     /// Props with nothing set, every optional one absent.
#     pub fn new() -> Self {
#         Props { size: None }
#     }
#
#     /// Set `size`, which is absent otherwise.
#     pub fn size(mut self, size: ButtonSize) -> Self {
#         self.size = Some(size);
#         self
#     }
# }
# }
// Button.vue:
//   defineProps<{ size?: "sm" | "md" | "lg" }>();
use button::{ButtonSize, Props};

let props = Props::new().size(ButtonSize::Md);
assert_eq!(serde_json::to_string(&props).unwrap(), r#"{"size":"md"}"#);

// A string from a request, a database or a form, checked once where it enters.
let size: ButtonSize = "lg".parse()?;
assert_eq!(size.as_str(), "lg");
assert_eq!(size.to_string(), "lg");
assert_eq!(ButtonSize::ALL, [ButtonSize::Sm, ButtonSize::Md, ButtonSize::Lg]);

let e = ButtonSize::try_from("xl").unwrap_err();
assert_eq!(e.to_string(), "`xl` is not one of the members of `ButtonSize`: `sm`, `md`, `lg`");
assert_eq!(e.members(), ["sm", "md", "lg"]);
# Ok::<(), ferrovue::props::ParseUnionError>(())
```

Each enum derives `Debug`, `Clone`, `Copy`, `PartialEq`, `Eq`, `Hash`, `serde::Serialize` and
`serde::Deserialize` (always, so a handler may read one from a query or a JSON body), and serde
names each variant by its literal: the island's JSON, `data-props` and the state a page sends hold
the literal, and JSON that holds a string outside the union does not deserialise ("unknown variant
`xl`, expected one of `sm`, `md`, `lg`"), fixtures included. `as_str()` gives the literal, `ALL`
every variant in the order the union declares them, `Display` writes the literal, and `FromStr` and
`TryFrom<&str>` parse one, failing with [`ParseUnionError`](crate::props::ParseUnionError). An enum whose
variants all share a word gets `#[allow(clippy::enum_variant_names)]`.

The template reads such a value as the string it stands for: `{{ size }}`, an attribute, `:class`,
`:style`, a template literal and every string method go through `as_str()`. Where an enum translates
it better, the compiler uses the enum:

- `size === 'md'` and `!==` compare variants (`props.size == Some(ButtonSize::Md)`), as do a
  `switch` over it and `v-if` / `v-else-if` chains; a literal outside the union is refused
  ([FV0637](crate::guide::error_codes#fv0637)), as TypeScript refuses it;
- a [lookup table](#lookup-tables) and `<component :is>` read by it are a `match` over its
  variants, each named, with no catch-all arm;
- `size ?? 'md'` and a default from `withDefaults` are `props.size.unwrap_or(ButtonSize::Md)`, still
  the enum, and a default outside the union is refused
  ([FV0322](crate::guide::error_codes#fv0322)); `v-if="size"` narrows it to the variant;
- a `computed` that returns the value as it is (`computed(() => props.size)`) holds the enum;
- handed to a child's prop of the same union, the enum is copied; to one of another union that holds
  all its members, a `match` maps one to the other; to a `string` prop, it is `as_str()`. A literal of
  the union, a `?:` of members, a lookup table's value and a `computed` typed as the union reach a
  union prop as its variant. A literal outside it, and a value typed `string`, are refused
  ([FV0515](crate::guide::error_codes#fv0515)).
- a `v-for` item of a list of the union is the enum, so a child's union prop, a lookup table and
  `===` read the variant; the list handed to a child's list of the same union is copied, and
  `.join()`, `.includes()`, `.length`, `.filter()`, `.map()` and the other list methods read its
  items' strings.

A string the Rust caller holds as a string where the render needs a union's enum, such as a value of
a `Record<string, Size>`, a field of a store's state or a prop of a single literal handed to a
child's union prop, is parsed as the component renders. One outside the union refuses the render
with [FV0518](crate::guide::error_codes#fv0518), which a generated `try_render` returns as a
[`Refused`](crate::render::Refused), where Vue would write the string itself.

A `ref` of a union (`ref<Choice>(…)` with `type Choice = Tone | ""`) holds the enum from the value
it starts with, whether or not a prop uses the union: `Choice` has the variants `Calm`, `Loud`,
`Quiet` and `Empty`. The value is a literal of the union, a value of the same union or of one whose
members it holds, a lookup table's value, or a `?:` or `??` of these, each turned into the enum by a
`match` over variants that names every one: `ref<Choice>(props.pick ?? "")` is
`props.pick.map(|v| match v { Tone::Calm => Choice::Calm, … }).unwrap_or(Choice::Empty)`. Any
other value keeps the `ref` a string, checked against its annotation as the next paragraph says,
and so does a union whose literals give a variant no name. Either way the `ref` holds the members
of its annotation, which may be more than the value it starts with holds:
`ref<Tone | "">(props.tone)` starts from a member of `Tone` and compares with `""` as with any
member, and `ref<Tone | "" | undefined>(props.tone)` holds the enum of `Tone | ""` when
`props.tone` is required. A `ref` is the server's own, and the island's JSON holds the props it
starts from. A `ref`, a constant, a `computed` or a function whose annotation is `string`
(`function label(): string { return props.tone; }`) holds a string of the value, which compares
with any string.

A string of a wider union, such as a `ref<Tone | "">` that holds `""` for a `<select>`'s empty
option, is narrowed as TypeScript narrows it, and reaches a prop of `Tone` once only members of
`Tone` are left:

- `tone || undefined` leaves out the falsy member `""`;
- `tone === '' ? undefined : tone` and `tone !== '' ? tone : undefined` leave out `""` in the branch
  that reads `tone`, as `tone ? tone : undefined` does, and so do `&&` and `v-if` / `v-else`
  (`<Badge v-if="tone !== ''" :tone="tone" />`);
- a `computed`, a `ref` or a constant annotated as the union
  (`computed((): Tone | undefined => (tone.value === "" ? undefined : tone.value))`) is checked
  against its annotation. One whose body may give another string is refused at its declaration
  ([FV0111](crate::guide::error_codes#fv0111)), and a value that may still be `""` where it is passed
  is refused there ([FV0515](crate::guide::error_codes#fv0515)).

The value is the string or the enum it was, narrowed: the generated code tests it as the template
does and maps it to the child's enum where the child takes it. A `ref<Tone | "">` holds its own
enum, and the map is a `match` over its variants: the members the test leaves each name their
variant of `Tone`, and the variants the test rules out (`Empty`) join the last arm, which the test
keeps them from reaching.

A single literal (`kind: "note"`), a union with `string` (`"sm" | string`, which TypeScript widens
to `string`) and integer literals (`1 | 2 | 3`, an `i64`) stay as they were. So do records of a
union (`Record<string, Size>` holds strings), and the fields of a store's own interfaces in its
`stores` file, whose state derives `Default` under `cfg(test)`; a shared type a store holds has its
enums.

Each generated enum implements [`Union`](crate::props::Union) too, whose `as_str` and `ALL` are the
enum's own, and generated code reads a value's literal through it.

# Unions mapped to existing enums

An application that already holds a union's set as a Rust enum, in its domain or in a crate below
the one the generated code is in, names that enum for the union's `type` alias under `unions` in
`ferrovue.config.json`:

```json
{
  "components": "components",
  "out": "src/generated",
  "unions": { "Tone": "app_domain::Tone" }
}
```

Every prop and every field of an interface typed with `Tone`, in any component or `.ts` file, is
then `app_domain::Tone`, and the compiler generates no enum for it. What generated code needs from
the enum is the trait [`Union`](crate::props::Union), which the crate that declares the enum implements:

- the variants named as the compiler would name the generated enum's, one per literal (the
  [rules above](#unions-of-string-literals): `"x-cool"` is `XCool`), so that the `match`es,
  comparisons and defaults generated code writes name them. Next to where the generated enum would
  be, in `types.rs` for a `.ts` file's alias, the compiler writes a `match` over every variant, so
  an enum that lacks one of the union's variants, or has one the union lacks, stops the build at
  the generated module with rustc's own error;
- [`as_str`](crate::props::Union::as_str), the literal of each value, which the template renders and
  compares, and which the island's `data-props` and the state a page sends hold for the value,
  whatever the enum's own `serde` implementation writes;
- [`ALL`](crate::props::Union::ALL), each value once, from which a fixture's literal is read back. The
  generated module holds a `#[cfg(test)]` test, run by the application's `cargo test`, that checks
  each value's literal and that `ALL` lists every value once;
- `Copy`, `PartialEq` and `Debug`, which the trait requires.

```rust
use ferrovue::props::Union;

// `export type Tone = "warm" | "x-cool";` in a `.ts` file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Warm,
    XCool,
}

impl Union for Tone {
    const ALL: &'static [Self] = &[Tone::Warm, Tone::XCool];

    fn as_str(self) -> &'static str {
        match self {
            Tone::Warm => "warm",
            Tone::XCool => "x-cool",
        }
    }
}
# mod card {
#     /// The props `Card.vue` declares.
#     #[derive(Debug, Clone, serde::Serialize)]
#     pub struct Props {
#         #[serde(rename = "tone", with = "ferrovue::props::union_prop")]
#         pub tone: super::Tone,
#         #[serde(rename = "tones", with = "ferrovue::props::union_prop")]
#         pub tones: Vec<super::Tone>,
#     }
# }

# fn main() {
// Card.vue:
//   defineProps<{ tone: Tone; tones: Tone[] }>();
let props = card::Props { tone: Tone::XCool, tones: vec![Tone::Warm] };
assert_eq!(serde_json::to_string(&props).unwrap(), r#"{"tone":"x-cool","tones":["warm"]}"#);
# }
```

The alias is named as its file declares it, and every alias of that name is the one enum: two
unions of one name with other members are refused ([FV0330](crate::guide::error_codes#fv0330)),
and so is an entry for an alias that is not a union of two or more string literals
([FV0329](crate::guide::error_codes#fv0329)), a path that is not one of a Rust type
([FV1119](crate::guide::error_codes#fv1119)), and an entry no prop or field is typed with
([FV1120](crate::guide::error_codes#fv1120)). A union written in place, with no alias, keeps its
generated enum.

# Nullable props

A prop declared `x: T | null` is an `Option` too, `None` unless its setter is called, and `None` is
`null`: the island's JSON writes `"x":null`, where an optional prop's `None` is left out, so the
client hydrates with the `null` the server rendered. Data from a JSON API or a database keeps its
shape, `deletedAt: string | null` included, and so do the fields of interfaces and the state of
Pinia stores (`ref<string | null>(null)`).

The template tests it as TypeScript narrows it: `x !== null`, `x === null`, `x != null`,
`x == null` and `x` alone. `??`, `?.`, `{{ x }}`, which writes nothing for `null`, and an attribute
bound to it, which is left out, behave as for an optional value. `x === undefined` is refused, since
a nullable prop is never `undefined`, and so is `x === null` of an optional one.

An `Option` holds one kind of nothing, so a value that may be both is refused where the difference
would show: `T | null | undefined` and `x?: T | null` as types, a default for a nullable prop (Vue
gives it only when the prop is absent), and `=== null` or `=== undefined` of `a?.b` where `b` is
nullable (use `== null`). A parent passes a nullable prop always, `null` for none, and never hands
an optional value to it, or a nullable one to an optional prop, without `?? null` or
`?? undefined`.

# `typeof`

Every value a template reads has a type the compiler knows, so `typeof x` is worked out when
compiling: `"string"` for a string, `"number"` for a `number` or a `Float`, `"boolean"`, and
`"object"` for an object, a list, a record, a `Date` and `null`. Of an optional value it is the
value's type when present and `"undefined"` when absent, so `typeof x === "string"` and
`typeof x !== "undefined"` test whether it is present and narrow it as `x !== undefined` does
(`v-if="typeof label === 'string'"`, then `label.length` inside). Of a nullable one, absent is
`"object"`, as `typeof null` is in JavaScript. A comparison with any other name is `false`. Where
the answer depends on whether a value that may be either `null` or `undefined` is which,
`typeof (on ? a : null) === "undefined"`, it is refused
([FV0722](crate::guide::error_codes#fv0722)), as is `typeof` of a value from a plugin whose type is
its own; `typeof route.query.q === "string"` is the router's own
([`routing`](crate::guide::routing)).

# Optional chains and list items

`a?.b` is `undefined` when `a` is absent, and so is a chain that goes on past it as a whole
(`a?.b.c`, `s?.trim().length`, `tags?.at(-1)?.toUpperCase()`): the generated code maps the rest of
the chain over the `Option`, and every property and method the value has when present may follow.
A list's item, `list[i]` with an integer `i` or `list.at(i)`, which counts from the end when `i` is
negative, is an optional value too, `undefined` outside the list: `v-if="rows[0]"` narrows it, and
`??`, `?.` and `{{ }}` take it as they take an optional prop. An index that is a `Float`, which may
hold a fraction, a string or a value that may be absent is refused.

# Building props

`Props::new` takes the required props, in the order they are declared; each optional prop has a
setter that consumes and returns the struct. The fields are public, so a struct literal works too.

```rust
# mod data_list {
# // @generated by ferrovue from components/DataList.vue. Do not edit: change the `.vue` file and run
# // `ferrovue`.
#
# use std::borrow::Cow;
#
# use ferrovue as fv;
#
# /// The component's name, as `data-island` carries it.
# pub const NAME: &str = "DataList";
#
# /// `Row` in `DataList.vue`.
# #[derive(Debug, Clone, serde::Serialize)]
# #[cfg_attr(test, derive(serde::Deserialize))]
# pub struct Row<'a> {
#     #[serde(rename = "id")]
#     pub id: i64,
#     #[serde(rename = "label")]
#     pub label: Cow<'a, str>,
#     #[serde(rename = "tags")]
#     pub tags: Vec<Cow<'a, str>>,
# }
#
# impl<'a> Row<'a> {
#     /// Row with its required fields.
#     pub fn new(id: i64, label: impl Into<Cow<'a, str>>, tags: impl IntoIterator<Item = impl Into<Cow<'a, str>>>) -> Self {
#         Row { id, label: label.into(), tags: tags.into_iter().map(Into::into).collect() }
#     }
#
# }
#
#
# /// The props `DataList.vue` declares.
# #[derive(Debug, Clone, serde::Serialize)]
# #[cfg_attr(test, derive(serde::Deserialize))]
# pub struct Props<'a> {
#     #[serde(rename = "rows")]
#     pub rows: Vec<Row<'a>>,
#     #[serde(rename = "title")]
#     pub title: Cow<'a, str>,
#     #[serde(rename = "note", default, skip_serializing_if = "Option::is_none")]
#     pub note: Option<Cow<'a, str>>,
# }
#
# impl<'a> Props<'a> {
#     /// Props with its required fields, every optional one absent.
#     pub fn new(rows: Vec<Row<'a>>, title: impl Into<Cow<'a, str>>) -> Self {
#         Props { rows, title: title.into(), note: None }
#     }
#
#     /// Set `note`, which is absent otherwise.
#     pub fn note(mut self, note: impl Into<Cow<'a, str>>) -> Self {
#         self.note = Some(note.into());
#         self
#     }
# }
#
#
# /// The props `<slot name="header">` passes the content a parent gives it, borrowed for the render.
# pub struct HeaderSlotProps<'v> {
#     pub title: &'v str,
#     pub note: Option<&'v str>,
# }
#
# /// A parent's content for `<slot name="header">`, given its props: returns whether it wrote anything but comments.
# pub type HeaderSlot<'s> = dyn for<'v> Fn(&mut String, &HeaderSlotProps<'v>) -> bool + 's;
#
# /// The props `<slot name="row">` passes the content a parent gives it, borrowed for the render.
# pub struct RowSlotProps<'v> {
#     pub row: &'v Row<'v>,
#     pub index: i64,
#     pub label: &'v str,
#     pub tags: &'v [Cow<'v, str>],
#     pub first: bool,
# }
#
# /// A parent's content for `<slot name="row">`, given its props: returns whether it wrote anything but comments.
# pub type RowSlot<'s> = dyn for<'v> Fn(&mut String, &RowSlotProps<'v>) -> bool + 's;
#
# /// The props `<slot name="empty">` passes the content a parent gives it, borrowed for the render.
# pub struct EmptySlotProps<'v> {
#     pub title: &'v str,
# }
#
# /// A parent's content for `<slot name="empty">`, given its props: returns whether it wrote anything but comments.
# pub type EmptySlot<'s> = dyn for<'v> Fn(&mut String, &EmptySlotProps<'v>) -> bool + 's;
#
# /// The props `<slot>` passes the content a parent gives it, borrowed for the render.
# pub struct DefaultSlotProps<'v> {
#     pub count: i64,
#     pub title: &'v str,
# }
#
# /// A parent's content for `<slot>`, given its props: returns whether it wrote anything but comments.
# pub type DefaultSlot<'s> = dyn for<'v> Fn(&mut String, &DefaultSlotProps<'v>) -> bool + 's;
#
# /// What a parent puts in the slots `DataList.vue` renders.
# #[derive(Clone, Copy, Default)]
# pub struct Slots<'s> {
#     /// `<slot name="header">`
#     pub header: Option<&'s HeaderSlot<'s>>,
#     /// `<slot name="row">`
#     pub row: Option<&'s RowSlot<'s>>,
#     /// `<slot name="empty">`
#     pub empty: Option<&'s EmptySlot<'s>>,
#     /// `<slot>`
#     pub default: Option<&'s DefaultSlot<'s>>,
# }
#
# /// Write the component's server render into `out`.
# pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>) {
#     out.reserve(96 + 17 * props.rows.len() + props.rows.iter().map(|v| v.label.len() + v.tags.iter().map(|v| v.len()).sum::<usize>()).sum::<usize>() + props.title.len() + props.note.as_deref().map_or(0, str::len));
#     out.push_str("<section><header>");
#     fv::render::scoped_slot_into(out, fv_slots.header, &HeaderSlotProps { title: &props.title, note: props.note.as_deref() }, Some(&mut |out: &mut String| {
#         fv::core::escape_into(out, &props.title);
#     }));
#     out.push_str("</header>");
#     if props.rows.len() as i64 != 0 {
#         out.push_str("<ul><!--[-->");
#         for (i, r_ref) in props.rows.iter().enumerate() {
#             let r = r_ref;
#             let i = i as i64;
#             out.push_str("<li>");
#             fv::render::scoped_slot_into(out, fv_slots.row, &RowSlotProps { row: r, index: i, label: &r.label, tags: &r.tags, first: i as f64 == 0.0 }, Some(&mut |out: &mut String| {
#                 fv::core::push_int(out, i);
#                 out.push_str(". ");
#                 fv::core::escape_into(out, &r.label);
#             }));
#             out.push_str("</li>");
#         }
#         out.push_str("<!--]--></ul>");
#     } else {
#         out.push_str("<p>");
#         fv::render::scoped_slot_into(out, fv_slots.empty, &EmptySlotProps { title: &props.title }, Some(&mut |out: &mut String| {
#             out.push_str("no rows in ");
#             fv::core::escape_into(out, &props.title);
#         }));
#         out.push_str("</p>");
#     }
#     out.push_str("<footer>");
#     fv::render::scoped_slot_into(out, fv_slots.default, &DefaultSlotProps { count: props.rows.len() as i64, title: &props.title }, None);
#     out.push_str("</footer></section>");
# }
#
# /// The component's markup, for a maud page that shows it.
# pub fn html<'p, 'a>(props: &'p Props<'a>, fv_slots: Slots<'p>) -> fv::html::Html<'p, Props<'a>, impl Fn(&mut String, &Props<'a>) + 'p> {
#     fv::html::Html::markup(props, move |out: &mut String, props: &Props<'a>| render(out, props, fv_slots))
# }
# }
// DataList.vue:
//   export interface Row { id: number; label: string; tags: string[] }
//   defineProps<{ rows: Row[]; title: string; note?: string }>();
use std::borrow::Cow;

let owned = String::from("from the database");
let rows = vec![
    data_list::Row::new(1, "first", ["new", "rust"]),
    data_list::Row::new(2, owned.as_str(), Vec::<String>::new()),
];
let props = data_list::Props::new(rows, "Rows").note(format!("{} rows", 2));

// What an island would carry: Vue's prop names, absent optionals left out.
assert_eq!(
    serde_json::to_string(&props).unwrap(),
    r#"{"rows":[{"id":1,"label":"first","tags":["new","rust"]},{"id":2,"label":"from the database","tags":[]}],"title":"Rows","note":"2 rows"}"#
);

// The same props as a struct literal.
let literal = data_list::Props {
    rows: Vec::new(),
    title: Cow::Borrowed("Rows"),
    note: None,
};
assert!(literal.note.is_none());
```

An app that builds every struct as a literal can leave the builders out with `"builders": false` in
`ferrovue.config.json`: the `impl` with `new` and the setters is then not written for any props
struct, shared type or store state, code that rustc would otherwise compile whether it is called or
not. The structs keep their public fields and their derives, `Default` included, so a struct with no
required field still takes `..Default::default()`. The key applies to the whole project: a shared
type belongs to no component, and a `.vue` file has no place Vue reads that could mark it.

# Dictionaries

A `Record<string, T>` prop, or one declared `{ [key: string]: T }`, is a [`Record`](crate::props::Record):
a JavaScript object used as a dictionary. It is built from pairs, or read from JSON, and holds its
keys in the order a JavaScript object does: keys that are array indices (`"0"` to `"4294967294"`)
first, in numeric order, then the others in the order they were added. A key given twice keeps its
first place and its last value, as `JSON.parse` keeps it. That is the order `v-for`,
`Object.keys`, `Object.values` and `Object.entries` walk, and the order the record is written back
as JSON, which the browser reads back the same.

```vue
<!-- Scores.vue -->
<script setup lang="ts">
defineProps<{ scores: Record<string, number> }>();
</script>

<template>
  <ol><li v-for="(score, name, i) in scores">{{ i + 1 }}. {{ name }}: {{ score }}</li></ol>
</template>
```

```rust
# mod scores {
# // @generated by ferrovue from client/components/Scores.vue. Do not edit: change the `.vue` file and run
# // `ferrovue`.
#
# use ferrovue as fv;
#
# /// The component's name, as `data-island` carries it.
# pub const NAME: &str = "Scores";
#
# /// The props `Scores.vue` declares.
# #[derive(Debug, Clone, serde::Serialize)]
# #[cfg_attr(test, derive(serde::Deserialize))]
# pub struct Props<'a> {
#     #[serde(rename = "scores")]
#     pub scores: ferrovue::props::Record<'a, i64>,
# }
#
# impl<'a> Props<'a> {
#     /// Props with its required fields.
#     pub fn new(scores: ferrovue::props::Record<'a, i64>) -> Self {
#         Props { scores }
#     }
#
# }
#
#
/// Write the component's server render into `out`.
pub fn render(out: &mut String, props: &Props<'_>) {
    out.reserve(25 + 25 * props.scores.len() + props.scores.iter().map(|(k, _)| k.len()).sum::<usize>());
    out.push_str("<ol><!--[-->");
    for (i, (name, score_ref)) in props.scores.iter().enumerate() {
        let score = *score_ref;
        let i = i as i64;
        out.push_str("<li>");
        fv::core::push_int(out, (i as f64 + 1.0) as i64);
        out.push_str(". ");
        fv::core::escape_into(out, name);
        out.push_str(": ");
        fv::core::push_int(out, score);
        out.push_str("</li>");
    }
    out.push_str("<!--]--></ol>");
}
#
# /// The component's markup, for a maud page that shows it without hydrating it.
# pub fn html<'p, 'a>(props: &'p Props<'a>) -> fv::html::Html<'p, Props<'a>> {
#     fv::html::Html::markup(props, render)
# }
#
# /// The component as an island the client hydrates.
# pub fn island<'p, 'a>(props: &'p Props<'a>) -> fv::html::Html<'p, Props<'a>> {
#     fv::html::Html::island(NAME, props, render)
# }
# }
use ferrovue::props::Record;

// "10" is an array index, so it comes first, as in the browser.
let scores: Record<'_, i64> = [("ada", 3), ("10", 1), ("grace", 2)].into_iter().collect();
let props = scores::Props::new(scores);

let mut out = String::new();
scores::render(&mut out, &props);
assert_eq!(out, "<ol><!--[--><li>1. 10: 1</li><li>2. ada: 3</li><li>3. grace: 2</li><!--]--></ol>");
assert_eq!(serde_json::to_string(&props).unwrap(), r#"{"scores":{"10":1,"ada":3,"grace":2}}"#);
```

A field read by name, `r.key` or `r[key]`, is refused, since it may be absent although TypeScript
says it is not; so are dictionaries of optional values.

`Object.entries(r)` is the record's `[key, value]` pairs, in that order, which a `v-for` walks
(`([key, value], i) in Object.entries(r)`) and the list methods read: their arrow functions
destructure a pair (`([key, value]) => …`, `([, value]) => …`, and `([key, { id }]) => …` for an
object value) or read its parts, `pair[0]` and `pair[1]`. Each pair is a `(&str, &T)` borrowed from
the record, so `Object.entries(r).filter(([, n]) => n > 0).map(([key]) => key)` copies nothing.
A method that writes or compares whole pairs is refused (FV0816): `.join()`, `.includes()`,
`.toSorted()` without a comparator, and `.map()` to the pairs themselves. `Object.values(r)` of a
record of lists is a list of lists, which `.flat()` joins.

# Shared types

An interface imported from a `.ts` file is written once, to `types.rs`, so that components passing
a value to one another agree on its type: `UserCard.vue` and `UserList.vue` importing `User` from
`types/models.ts` both use `super::types::User<'a>`. A type imported from another component's `.vue`
file is that component's struct (`super::data_list::Row<'a>`), and one imported from a store's file
is the struct in `stores.rs`. A union of string literals a `.ts` file declares as a `type` alias or
an `enum` is written once to `types.rs` too, as its [enum](#unions-of-string-literals)
(`super::types::Size`), so a parent hands its value to a child as it is.

The props themselves are declared in the component, in `defineProps<{ … }>()` or an interface or
alias of the component, and their fields may have imported types: `defineProps<{ user: User }>()`
compiles with `User` imported. `defineProps<User>()`, an intersection with `User` or an interface
that extends it is refused with FV0327, as are the events of `defineEmits<E>()` of an imported type.

A parent may build an object prop from an object literal, `:user="{ id, name, roles: [] }"`, or a
list of them from `.map()`, `:rows="items.map((x) => ({ id: x.id, label: x.name }))"`: each literal
is built as the struct of the prop's interface, its optional fields left out `None`. See
[object literals](crate::guide::script_logic#object-literals).

A component's own interfaces and object type aliases, and those of the `.ts` files it imports, are
translated when the server render reaches them: through a component's props and `defineModel` (a
type parameter's constraint included), a provided or injected value, a `ref` or other binding the
server computes, and a constant list declared with an interface, together with the types of their
fields. The component's module and `types.rs` hold only these, and only these are checked. A type
nothing reaches is neither written nor refused, so a module a component imports for its functions
may declare types with no Rust counterpart (`type Row = Record<string, unknown>`), an interface only
an event handler uses may hold an `HTMLElement`, and an exported interface no component uses has no
struct.

A field whose type has no Rust counterpart is left out of its struct when only values the server
computes reach the type. With `interface Cat { id: string; items: HTMLElement[] }` and
`const cats = shallowRef<Cat[]>([])`, a template that reads `cats.length` or `cat.id` compiles, and
`Cat` is a struct with `id` alone. Reading `items` on the server, in the template or in a
`computed` the template reads, is refused where the field is declared, with its code. Props,
`defineModel` and the types their fields hold keep every field, since the props come from Rust and
are sent to the client, so such a field in a type a prop reaches is refused where it is declared.

A constant imported from a `.ts` file is evaluated when the component is compiled; see
[constants](#constants).

Each generated struct has the same `new` and setters as `Props` (none with `"builders": false`), and derives `Debug`, `Clone` and
`serde::Serialize`. `serde::Deserialize` is derived only under `cfg(test)`, for the conformance
helper: props go out to the client as JSON and never come back in. An object prop handed to a child
component is cloned; its strings are `Cow`s, so borrowed ones cost nothing to copy.

# Imports through aliases

A `.ts` file may be imported by a relative path (`../lib/format`) or through an alias, as
TypeScript and Vite resolve it:

- the `compilerOptions.paths` of the tsconfig.json nearest the component, after its `extends`
  (Nuxt's `./.nuxt/tsconfig.json` included), and of the projects it lists in `references` (as
  create-vue's `tsconfig.app.json`), relative to `baseUrl` when it is set and else to the file that
  declares them; a bare path relative to `baseUrl` too;
- with the Vite plugin, the build's own `resolve.alias`, tried before tsconfig's `paths`.

```json
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
```

`import { LABELS } from "@/lib/catalog"` then reads `src/lib/catalog.ts` (or `catalog/index.ts`).
`ferrovue --check` in CI runs without Vite, so declare in tsconfig.json an alias the CLI should
know. A name the server reads that is imported from a module no relative path or alias leads to a
`.ts` file of the project, a package included, is refused with
[`FV0110`](crate::guide::error_codes#fv0110), naming the specifier and where it was looked for; a
name only an event handler uses stays the client's.

# Constants

A constant a component imports from a `.ts` file, or an `enum`, imported or declared in the
component, is evaluated when the component is compiled, as `types.rs` holds the shared types:

```ts
// components/catalog.ts
export const LABELS = { title: "Catalogue", empty: "Nothing yet" } as const;
export const SIZES = ["sm", "md", "lg"] as const;
export const SORTS = [
  { key: "name", label: "By name" },
  { key: "price", label: "By price" },
] as const;
export enum Tone { Calm = "calm", Loud = "loud" }
```

Strings, numbers, booleans, `null`, lists of them and objects of them read field by field
(`LABELS.save`, `Tone.Loud`, `Rank[5]`) are written where the template reads them:
`{{ LABELS.title }}` and `v-if="tone === Tone.Loud"` go into the page as the strings they are, and
`v-for="s in SIZES"` walks an array literal. A list of objects becomes a `const` in `types.rs`, with
a type for its items: the interface the constant is declared with (`SORTS: Sort[]`), or one named
after the constant, here `SortsItem`. A field that is `null` in some items is `T | null`.

```rust
# use std::borrow::Cow;
# pub struct SortsItem<'a> { pub key: Cow<'a, str>, pub label: Cow<'a, str> }
pub const SORTS: &[SortsItem<'static>] = &[
    SortsItem { key: Cow::Borrowed("name"), label: Cow::Borrowed("By name") },
    SortsItem { key: Cow::Borrowed("price"), label: Cow::Borrowed("By price") },
];
# assert_eq!(SORTS[1].label, "By price");
```

A constant is a literal, a list, an object, a constant `Map`, or another constant of the same file,
and arithmetic and strings of them are worked out when compiling, as JavaScript works them out:
`+`, `-`, `*`, `/` and `%` of numbers, giving the same double every engine gives, `**` where the
result is an exact integer within ±2⁵³ (engines round other powers in their own ways), unary `-`
and `+`, strings joined with `+` (a number written as `String()` writes it) and template literals.

```ts
// components/units.ts
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const BASE = "/feed";
export const NEWEST = `${BASE}/new?hours=${24 * HOUR / HOUR}`;
export function hours(seconds: number): number {
  return Math.floor(seconds / HOUR);
}
```

Here `hours(s)` is `(s as f64 / 3600.0).floor()` and `NEWEST` the string `"/feed/new?hours=24"`.
A constant that is anything else (`Date.now()`, a function, an operator of a list) is refused
where the template reads it, with the code of what stops it, at the place it is declared. So are an
object constant read whole, and `new` of anything but `Date` and `Map`.

## Lookup tables

An object constant, imported from a `.ts` file or declared with `const` in `<script setup>`, may be
read by a key known only when rendering, when the key's type is a closed set: a union of string
literals (`size: "sm" | "md" | "lg"`), of integer literals (`level: 1 | 2 | 3`), or an `enum` of
them. The key may be a prop, a `computed`, a field of a `v-for` item, or a `?:` or `??` of such
values and literals. The object may be written `as const`, typed `Record<Size, T>` or
`Partial<Record<Size, T>>`, or left untyped, and its keys may be computed from enum members
(`[Tone.Warn]: …`). The read becomes a `match` over the key's members:

```ts
type Size = "sm" | "md" | "lg";
const props = defineProps<{ size: Size; tone: Tone }>();
const PAD = { sm: "p-1", md: "p-2", lg: "p-4" } as const;
```

```html
<p :class="PAD[size]" :style="{ color: THEME[tone].fg }">{{ LABELS[size] }}</p>
```

```rust
# #[derive(Clone, Copy)]
# enum Size { Sm, Md, Lg }
# struct Props { size: Size }
# let props = Props { size: Size::Md };
let class = match props.size { Size::Sm => "p-1", Size::Md => "p-2", Size::Lg => "p-4" };
# assert_eq!(class, "p-2");
```

A key of a union of string literals is its enum, so the `match` names every variant. A key the
compiler holds as a string (a `computed` that builds it, a `?:` of literals) is matched as a string,
and so is an integer union.

A table whose values are members of a union (`Record<Tone, Tone>`, `Partial<Record<Tone, Tone>>`,
or an untyped table of its literals) reaches a child's union prop, an object literal's union field
and a `ref` of the union as the enum, with a `match` from variant to variant that names every one:

```ts
type Tone = "calm" | "loud" | "quiet";
const NEXT: Record<Tone, Tone> = { calm: "loud", loud: "quiet", quiet: "calm" };
```

```html
<Badge :tone="NEXT[tone]" />
```

```rust
# #[derive(Clone, Copy, Debug, PartialEq)]
# enum Tone { Calm, Loud, Quiet }
# let tone = Tone::Quiet;
let next = match tone { Tone::Calm => Tone::Loud, Tone::Loud => Tone::Quiet, Tone::Quiet => Tone::Calm };
# assert_eq!(next, Tone::Calm);
```

A table typed with a `type` alias or an `enum` for its values holds the alias's enum, written once
to `types.rs` for a `.ts` file, so `NEXT[tone] === "loud"` and another table read by it,
`LABEL[NEXT[tone]]`, compare and match its variants too. A value outside that union is refused
([FV0228](crate::guide::error_codes#fv0228)), as TypeScript refuses it.

Each member reads the value the object holds for it: a string, a number, a boolean, `null`, a list
of them, or an object read on by field (`THEME[tone].fg`, `THEME[tone].weight`). The values of
every member are of one type, numbers whether integers or fractions. A member the object has no
key for reads `undefined`, as in JavaScript, so the value may be absent: `ICONS[kind] ?? "none"`,
`ICONS[kind]?.label`, and `v-if="ICONS[kind]"`, inside which `ICONS[kind].label` reads as present.
A field read without `?.` of a value that may be `undefined` is refused, naming the members that
lack it.

A key whose value may be absent reads the object once it is narrowed: `kind && ICONS[kind]` is
`undefined` where `kind` is, and `ICONS[kind]` where it is not, when every member of `kind` is
truthy (no `""` or `0`).

The key's type is trusted, as it is for `<component :is>`. An enum holds its members alone; an
integer key outside its union, which a TypeScript caller cannot pass, reads the last member's
value, and so does a string key the compiler holds as a string. A key typed `string` or `number` is refused: a
plain object holds the fields of its prototype too (`toString`, `constructor`, `__proto__`), which
a key could name. For the same reason a member that names one of them must be a key of the object,
and an object literal may not set its prototype with `__proto__:`.

A free-text key is read once `Object.hasOwn()` has tested it against the object's own keys, which
the compiler knows, and which narrows the key to them where the test holds, in a `?:`, after `&&`
or `||`, and inside a `v-if`:

```ts
const ROLE: Record<string, string> = { mod: "is-mod", admin: "is-admin" };
const props = defineProps<{ role: string }>();
```

```html
<b :class="Object.hasOwn(ROLE, role) ? ROLE[role] : ''">{{ role }}</b>
```

```rust
# let role = "toString";
let class = if let Some(k) = matches!(role, "mod" | "admin").then_some(role) { match k { "mod" => "is-mod", _ => "is-admin" } } else { "" };
# assert_eq!(class, "");
```

`Object.keys(ROLE)` is the list of those keys, in JavaScript's order. A constant
`new Map([[key, value], …])`, its keys strings or integers, is read the same way, with
`.get(key)`, `undefined` for a key the map lacks, and `.has(key)`, by any string or integer.
