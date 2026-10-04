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
| `"sm" \| "md" \| "lg"` | `Cow<'a, str>` | as `string` |
| `string[]`, `Array<string>`, `readonly string[]` | `Vec<Cow<'a, str>>` | `impl IntoIterator<Item = impl Into<Cow<'a, str>>>` |
| `number[]`, `Row[]`, … | `Vec<i64>`, `Vec<Row<'a>>`, … | the `Vec` |
| `interface Row { … }`, `type Row = { … }` | a struct `Row<'a>` beside `Props`, or in `types.rs` when imported from a `.ts` file | the struct |
| `Props` imported from another component | `super::child::Props<'a>` | the struct |
| `TrustedHtml` (from `ferrovue/types`) | the type configured as `trustedHtml` | that type. See [`escaping`](crate::guide::escaping) |
| `x?: T`, `x: T \| undefined` | `Option<T>` | a setter, `.x(value)` |

A `number` is an integer on the server, which is what most props are: counts, ids, indexes. Declare
a prop that may hold a fraction as `Float`. [`numbers`](crate::guide::numbers) explains how both are
computed and written.

A string-literal union is a plain string in Rust: the TypeScript compiler checks the client's
values, but nothing checks what Rust passes. A value outside the union renders as given.

Strings are `Cow`s so that props can borrow from what the request already holds, and so that a
parent handing an object to a child copies only pointers.

# Optional props and defaults

An optional prop is an `Option`, `None` unless its setter is called. A default from `withDefaults`
or a destructured default (`const { size = "md" } = defineProps<…>()`) is applied while rendering, so
the field stays `None` and the island's JSON leaves it out, as Vue's would. An optional `boolean`
that is absent renders as `false`, which is the cast Vue applies.

# Building props

`Props::new` takes the required props, in the order they are declared; each optional prop has a
setter that consumes and returns the struct. The fields are public, so a struct literal works too.

```rust
# mod data_list {
# use std::borrow::Cow;
# #[derive(Debug, Clone, serde::Serialize)]
# pub struct Row<'a> {
#     #[serde(rename = "id")]
#     pub id: i64,
#     #[serde(rename = "label")]
#     pub label: Cow<'a, str>,
#     #[serde(rename = "tags")]
#     pub tags: Vec<Cow<'a, str>>,
# }
# impl<'a> Row<'a> {
#     pub fn new(id: i64, label: impl Into<Cow<'a, str>>, tags: impl IntoIterator<Item = impl Into<Cow<'a, str>>>) -> Self {
#         Row { id: id, label: label.into(), tags: tags.into_iter().map(Into::into).collect() }
#     }
# }
# #[derive(Debug, Clone, serde::Serialize)]
# pub struct Props<'a> {
#     #[serde(rename = "rows")]
#     pub rows: Vec<Row<'a>>,
#     #[serde(rename = "title")]
#     pub title: Cow<'a, str>,
#     #[serde(rename = "note", default, skip_serializing_if = "Option::is_none")]
#     pub note: Option<Cow<'a, str>>,
# }
# impl<'a> Props<'a> {
#     pub fn new(rows: Vec<Row<'a>>, title: impl Into<Cow<'a, str>>) -> Self {
#         Props { rows: rows, title: title.into(), note: None }
#     }
#     pub fn note(mut self, note: impl Into<Cow<'a, str>>) -> Self {
#         self.note = Some(note.into());
#         self
#     }
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

# Shared types

An interface imported from a `.ts` file is written once, to `types.rs`, so that components passing
a value to one another agree on its type: `UserCard.vue` and `UserList.vue` importing `User` from
`types/models.ts` both use `super::types::User<'a>`. A type imported from another component's `.vue`
file is that component's struct (`super::data_list::Row<'a>`), and one imported from a store's file
is the struct in `stores.rs`.

Each generated struct has the same `new` and setters as `Props`, and derives `Debug`, `Clone` and
`serde::Serialize`. `serde::Deserialize` is derived only under `cfg(test)`, for the conformance
helper: props go out to the client as JSON and never come back in.
