What the browser does with a page ferrovue rendered.

The server's HTML is complete and readable with no JavaScript. Where the page should be
interactive, the client's Vue hydrates the markup: it builds the same components from the same
`.vue` files, finds that the DOM already matches, and attaches to it instead of re-rendering. That
works only if the server wrote exactly the bytes Vue would have written for the same input, which
is what ferrovue guarantees; the rest of this page is about giving the client the same input.

There are two ways to hydrate, and a page may use both.

# Islands

An island is one component, hydrated on its own from its own props. `island()` wraps the
component's markup in the element the client mounts on, with the props it was rendered from:

```rust
# mod counter {
# use ferrovue as fv;
# pub const NAME: &str = "Counter";
# #[derive(Debug, Clone, serde::Serialize)]
# pub struct Props {
#     #[serde(rename = "start")]
#     pub start: i64,
# }
# impl Props {
#     pub fn new(start: i64) -> Self { Props { start: start } }
# }
# pub fn render(out: &mut String, props: &Props) {
#     out.push_str("<button>");
#     fv::push_int(out, props.start);
#     out.push_str("</button>");
# }
# pub fn island<'p>(props: &'p Props) -> fv::Html<'p, Props> {
#     fv::Html::island(NAME, props, render)
# }
# }
// Counter.vue: defineProps<{ start: number }>(), rendering <button>{{ start }}</button>.
let html = counter::island(&counter::Props::new(5)).into_string();
assert_eq!(
    html,
    r#"<div data-island="Counter" data-props="{&quot;start&quot;:5}"><button>5</button></div>"#
);
```

The props travel as JSON, serialised with `serde_json` and escaped for the attribute, never in a
`<script>`, so a page under a `script-src 'self'` policy needs no nonce for them. On the client,
`mountIslands` from `ferrovue/client` hydrates every island on the page:

```ts
import { createPinia } from "pinia";
import { hydrateState, mountIslands } from "ferrovue/client";
import Counter from "./components/Counter.vue";

const pinia = createPinia();
hydrateState(pinia);                                  // the state `state_script_into` wrote
await mountIslands({ Counter }, { pinia, router });   // one Pinia and one router for every island
```

Islands share the Pinia and router passed to `mountIslands`, so an island's click handler can change
a store another part of the page shows.

Only a component whose render needs nothing but its props has an `island()`: its `data-props` is all
the client gets. A component that takes slots, the route, stores, translations or teleports has
`html()` alone.

# Hydrating the whole app

The other way is the ordinary Vue SSR setup: the server renders the whole page body from one root
component (a layout with `<RouterView>`, say), and the client calls `createSSRApp(Root)` and mounts
it on the same element. Then the client must start from exactly what the server rendered with:

- the same props for the root;
- a router built from the same routes file, with the same base and link classes, and resolved to
  the current location (`await router.isReady()`) before mounting;
- Pinia started from the server's state, with `hydrateState`;
- vue-i18n with the same messages, in the locale the server rendered;
- the same version of Vue that the compiler pinned.

# What makes hydration fail

ferrovue's output is the same as Vue's for the same input, so a hydration mismatch means the input
differed. The usual causes:

- **Different data.** The client rendered with different props, state, route or locale.
- **Numbers that JSON cannot carry.** An `f64` prop that is `NaN` or infinite is serialised by
  `serde_json` as `null`, and an `i64` beyond ±2⁵³ is rounded by the browser's `JSON.parse`. See
  [`numbers`](crate::guide::numbers).
- **Markup the browser rewrites.** HTML the parser moves or closes, such as a `<div>` inside a
  `<p>`, does not survive parsing in either renderer; Vue's own SSR has the same constraint.
- **Content written around a component.** A slot closure or a hand-written page part that is not
  what the client's template would render inside the hydrated root.

The repository's `examples/fullstack` has a test that renders real pages with the server and
hydrates them in happy-dom, failing on any warning Vue logs; a test like it for the pages of your
own app is the way to catch the first cause.
