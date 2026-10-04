Pinia state on the server, and the same state in the browser.

A component may read Pinia stores while it renders. On the server there is no Pinia: the state is
a Rust struct you fill for each request, from the session or the database, and pass to `render`.
The page then sends the same state to the client, which starts every store from it before it
hydrates, so both sides render from the same values.

# Configuring

Name the directory of stores in `ferrovue.config.json`: `{ "stores": "client/stores" }`. Each `.ts`
file there may define stores with `defineStore`: option stores with a typed `state` and getters
that are an expression of the state, and setup stores, whose returned refs are typed by `ref<T>()`
or by their initial literal.

```ts
// client/stores/prefs.ts
export interface Tag { name: string; color?: string }
export interface PrefsState { density: string; wide: boolean; count: number; label?: string; tags: Tag[] }

export const usePrefs = defineStore("prefs", {
  state: (): PrefsState => ({ density: "classic", wide: false, count: 0, tags: [] }),
  getters: { doubled: (state) => state.count * 2 },
  actions: { toggle() { this.wide = !this.wide; } },
});
```

# The generated `stores` module

`stores.rs` has one struct per store's state, the types it uses, and `Stores`, with a field per
store keyed by its id, as `pinia.state.value` is. Getters are not fields: the compiler writes them
as expressions of the state wherever a component reads them, so they cannot disagree with it.
Actions are client-only.

```rust,ignore
/// Every store's state, keyed by id as `pinia.state.value` is: what the page sends the client.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(test, derive(Default, serde::Deserialize))]
#[cfg_attr(test, serde(default))]
pub struct Stores<'a> {
    #[serde(rename = "cart")]
    pub cart: CartState<'a>,
    #[serde(rename = "counter")]
    pub counter: CounterState<'a>,
    #[serde(rename = "prefs")]
    pub prefs: PrefsState<'a>,
}
```

Every store is in `Stores`, whether or not the page reads it, because the client's Pinia is given
all of it. The server never runs a store's `state()` function, so there are no defaults: fill each
field with what the reader's store holds.

A component that reads a store, or renders a child that does, takes `&stores::Stores` after its
props, slots and route.

# Rendering and handing the state over

[`state_script_into`](crate::state_script_into) writes the state as a
`<script type="application/json">`. The browser never runs it, so it needs no nonce under a
`script-src` policy, and `<`, `>` and `&` are written as JSON escapes, so no value can close it:

```rust
# fn main() {
# use generated::{badge, stores};
let prefs = stores::PrefsState::new("compact", false, 2, vec![stores::Tag::new("rust").color("orange")]);
let stores = stores::Stores::new(prefs);

let mut page = String::new();
badge::render(&mut page, &badge::Props::new("Ada"), &stores);
ferrovue::state_script_into(&mut page, "__pinia", &stores);

assert_eq!(
    page,
    concat!(
        r#"<span class="badge compact" data-wide="false">Ada 2<!----><!--[--><i title="orange">rust</i><!--]--></span>"#,
        r#"<script type="application/json" id="__pinia">"#,
        r#"{"prefs":{"density":"compact","wide":false,"count":2,"tags":[{"name":"rust","color":"orange"}]}}"#,
        r#"</script>"#,
    )
);
# }
# mod generated {
# pub mod stores {
# use std::borrow::Cow;
# #[derive(Debug, Clone, serde::Serialize)]
# pub struct Tag<'a> {
#     #[serde(rename = "name")]
#     pub name: Cow<'a, str>,
#     #[serde(rename = "color", default, skip_serializing_if = "Option::is_none")]
#     pub color: Option<Cow<'a, str>>,
# }
# impl<'a> Tag<'a> {
#     pub fn new(name: impl Into<Cow<'a, str>>) -> Self {
#         Tag { name: name.into(), color: None }
#     }
#     pub fn color(mut self, color: impl Into<Cow<'a, str>>) -> Self {
#         self.color = Some(color.into());
#         self
#     }
# }
# #[derive(Debug, Clone, serde::Serialize)]
# pub struct PrefsState<'a> {
#     #[serde(rename = "density")]
#     pub density: Cow<'a, str>,
#     #[serde(rename = "wide")]
#     pub wide: bool,
#     #[serde(rename = "count")]
#     pub count: i64,
#     #[serde(rename = "label", default, skip_serializing_if = "Option::is_none")]
#     pub label: Option<Cow<'a, str>>,
#     #[serde(rename = "tags")]
#     pub tags: Vec<Tag<'a>>,
# }
# impl<'a> PrefsState<'a> {
#     pub fn new(density: impl Into<Cow<'a, str>>, wide: bool, count: i64, tags: Vec<Tag<'a>>) -> Self {
#         PrefsState { density: density.into(), wide: wide, count: count, label: None, tags: tags }
#     }
# }
# #[derive(Debug, Clone, serde::Serialize)]
# pub struct Stores<'a> {
#     #[serde(rename = "prefs")]
#     pub prefs: PrefsState<'a>,
# }
# impl<'a> Stores<'a> {
#     pub fn new(prefs: PrefsState<'a>) -> Self {
#         Stores { prefs: prefs }
#     }
# }
# }
# pub mod badge {
# use std::borrow::Cow;
# use ferrovue as fv;
# pub struct Props<'a> { pub title: Cow<'a, str> }
# impl<'a> Props<'a> {
#     pub fn new(title: impl Into<Cow<'a, str>>) -> Self {
#         Props { title: title.into() }
#     }
# }
# pub fn render(out: &mut String, props: &Props<'_>, fv_stores: &super::stores::Stores<'_>) {
#     out.push_str("<span class=\"badge");
#     fv::class_into(out, true, &[&*fv_stores.prefs.density]);
#     out.push_str("\" data-wide=\"");
#     out.push_str(if fv_stores.prefs.wide { "true" } else { "false" });
#     out.push_str("\">");
#     fv::escape_into(out, &*props.title);
#     out.push_str(" ");
#     fv::push_int(out, fv_stores.prefs.count);
#     if let Some(n1) = (fv_stores.prefs.label.as_deref()).filter(|v| !(*v).is_empty()) {
#         out.push_str("<b>");
#         fv::escape_into(out, n1);
#         out.push_str("</b>");
#     } else {
#         out.push_str("<!---->");
#     }
#     out.push_str("<!--[-->");
#     for t_ref in (fv_stores.prefs.tags).iter() {
#         let t = t_ref;
#         out.push_str("<i");
#         if let Some(v) = t.color.as_deref() {
#             out.push_str(" title=\"");
#             fv::escape_into(out, v);
#             out.push_str("\"");
#         }
#         out.push_str(">");
#         fv::escape_into(out, &*t.name);
#         out.push_str("</i>");
#     }
#     out.push_str("<!--]--></span>");
# }
# }
# }
```

(Here `Badge.vue` renders `{{ title }} {{ prefs.count }}` and the store's tags, and the project has
one store; a real `Stores` has a field for every store.)

On the client, before the app or the islands mount:

```ts
import { hydrateState } from "ferrovue/client";
hydrateState(pinia); // reads <script id="__pinia">: every store starts from what the server rendered
```

# Islands and stores

A component that reads a store while it renders has no `island()`: an island is rebuilt from its
props alone. Either hydrate it from the page's own Vue app with the same Pinia, or read the store
only inside event handlers, which the server never runs, so that the component stays an island and
shares the store with the rest of the page once it is mounted. The repository's
`examples/fullstack` does both.

# What is refused

Getters that read `this` or return a function, `watchEffect`, and statements in setup that change a
store's state.
