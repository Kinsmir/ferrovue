`<RouterLink>`, `<RouterView>` and `useRoute()` on the server.

A link renders differently when it points where the reader already is: it gets `aria-current="page"`
and the `router-link-active` and `router-link-exact-active` classes. Deciding that means resolving
the link as the client's vue-router will, so [`Router`](crate::Router) is vue-router's own matching
algorithm, held to vectors recorded from the real vue-router.

The router is the `ferrovue-router` crate, which ferrovue re-exports at its root with the `router`
feature. The feature is on by default; generated code needs it once the project configures routes.

# Configuring the routes

List the routes in a JSON file, the same file the client can import to build its router, and name
it in `ferrovue.config.json`:

```json
[
  { "path": "/", "name": "home" },
  { "path": "/blog/:slug", "name": "post" },
  "/users/:name",
  { "path": "/account", "name": "account", "children": [
    { "path": "", "name": "account-home" },
    { "path": "orders", "name": "orders" }
  ] }
]
```

```json
{ "components": "client/components", "out": "src/generated", "routes": "client/routes.json" }
```

Each route is a path, or `{ "path", "name", "children" }`. Paths use the syntax ferrovue accepts:
static segments, `:name` parameters, optional `:name?` parameters, and a final `:name(.*)`. To match
options passed to
`createRouter` and `createWebHistory`, use `router` instead of `routes`:

```json
{ "router": { "routes": "client/routes.json", "base": "/app/", "linkActiveClass": "active", "linkExactActiveClass": "active" } }
```

The class names are written into the generated components; the base goes into `route_table.rs`.

# File-based routes

`routes` can name a folder of pages instead of a routes file. ferrovue then builds the routes from
the files' paths as vue-router's file-based routing builds them (the plugin that was
unplugin-vue-router, now `vue-router/vite`), and compiles every page as a component:

```json
{ "components": "client/components", "out": "src/generated", "routes": { "pages": "client/pages" } }
```

In `router`, it is `"router": { "routes": { "pages": "client/pages" }, "base": "/app/" }`. A folder
of pages gives these routes:

| File | Route | Name |
|---|---|---|
| `index.vue` | `/` | `/` |
| `about.vue` | `/about` | `/about` |
| `books/index.vue` | `/books` | `/books/` |
| `books/[id].vue` | `/books/:id` | `/books/[id]` |
| `[[lang]]/about.vue` | `/:lang?/about`, with `lang` optional | `/[[lang]]/about` |
| `[...path].vue` | `/:path(.*)`, every path no other route matches | `/[...path]` |
| `(shop)/cart.vue` | `/cart`: a group folder adds nothing to the path | `/(shop)/cart` |
| `users.vue` and `users/[id].vue` | `/users`, whose `<RouterView>` shows `/users/:id` | `/users`, `/users/[id]` |
| `users.edit.vue` | `/users/edit`, nested in nothing | `/users.edit` |
| `admin/_parent.vue` | `/admin`, the layout of the pages in `admin/` | none |

A route's name is vue-router's: the file's path, so a `<RouterLink>` writes
`:to="{ name: '/books/[id]', params: { id } }"` and the server matches `route.name()` against
`Some("/books/[id]")`. A folder with no `.vue` file of its own name beside it is a route with no
component, which only groups the routes in it: vue-router never matches it itself, so without
`books/index.vue`, `/books` matches no route (or the catch-all). The routes ferrovue builds are
held to the ones vue-router's own plugin builds, recorded from it for a set of folders that uses
each convention.

Each page is compiled as a component named after its path in the folder, in PascalCase:
`books/[id].vue` is `BooksId`, written to `books_id.rs`, with its fixtures under `fixtures/BooksId/`.
A page whose name is a component's too, or another page's (`a-b.vue` and `a_b.vue`), is refused, as
is one whose name starts with a digit.

The client gets the same routes from `ferrovue/routes`, which the Vite plugin writes from the folder.
Its `routes` are vue-router's records, each page loaded lazily, as `vue-router/auto-routes` gives
them for the same folder:

```ts
import { createRouter, createWebHistory } from "vue-router";
import { routes } from "ferrovue/routes";

const router = createRouter({ history: createWebHistory(), routes });
```

An application already using vue-router's own plugin with its default options can keep it: its
records are these. A client that only hydrates the pages the server rendered imports the default
export instead, the routes as a routes file lists them, and gives every page a component that
renders nothing; `routeRecords` from `ferrovue/link-router` leaves a folder without one, as
vue-router's plugin does:

```ts
import { createRouter, createWebHistory } from "vue-router";
import { routeRecords } from "ferrovue/link-router";
import pageRoutes from "ferrovue/routes";

const ServerPage = { render: () => null };
const router = createRouter({ history: createWebHistory(), routes: routeRecords(pageRoutes, ServerPage) });
```

What a file name can say beyond this is refused, each with its code:

| Refused | Code |
|---|---|
| `routes` that is neither a file nor `{ "pages": "…" }` | `FV1238` |
| A pages folder that cannot be read | `FV1239` |
| A parameter beside text in one part of the path (`prefix-[id].vue`), a repeatable parameter (`[id]+`), an optional catch-all (`[[...path]]`), a parameter parser (`[id=int]`), a character code (`[x+2E]`), a catch-all that holds other pages, and text other than letters, digits, `-` and `_` | `FV1240` |
| A named view (`index@aside.vue`) | `FV1241` |
| `definePage()` | `FV1242` |
| A `<route>` block | `FV1243` |
| `_parent.vue` in the pages folder itself, or in a folder with no other pages | `FV1244` |
| A page whose component name is taken, or starts with a digit | `FV1245` |

`definePage()` and `<route>` change a page's route at build time, from code ferrovue does not run;
the server's routes come from the files' paths alone.

# The generated route table

```rust
# mod route_table {
// @generated by ferrovue from routes.json. Do not edit: change the routes file and run
// `ferrovue`.

//! The app's routes: what `<RouterLink>` resolves against and `useRoute()` reads.

/// Each route: its vue-router path, its name if it has one, whether it shows a component, and the
/// routes nested in it.
pub const ROUTES: &[ferrovue::RouteDef<'static>] = &[
    ferrovue::RouteDef { path: "/", name: None, view: true, children: &[] },
    ferrovue::RouteDef { path: "/users/:name", name: None, view: true, children: &[] },
];

/// Every route's full path, nested ones included.
pub const PATHS: &[&str] = &[
    "/",
    "/users/:name",
];

/// The history's base, which every link's `href` starts with.
pub const BASE: &str = "";

/// The router these routes make: build it once, and resolve each request's location with
/// [`ferrovue::Router::at`].
pub fn router() -> ferrovue::Router {
    ferrovue::Router::tree(ROUTES).with_base(BASE)
}
# }
# let _ = route_table::router();
```

# A router per application, a route per request

Build the [`Router`](crate::Router) once, at start-up, and keep it in the application's state; it is
immutable and `Send + Sync`. For each request, resolve the location with
[`Router::at`](crate::Router::at), which takes the path with any query and hash, **without** the
history's base, as vue-router's history reports it. The [`Route`](crate::Route) it returns borrows
the router, and is what every component that links or reads the route takes.

The server can read the same route to decide what to render:

```rust
let router = ferrovue::Router::named(&[("/", Some("home")), ("/books/:id", Some("book"))]);
let route = router.at("/books/dune?ref=home#reviews");

match (route.name(), route.param("id")) {
    (Some("home"), _) => { /* render the home page */ }
    (Some("book"), Some(id)) => assert_eq!(id, "dune"),
    _ => { /* no route matched: a 404 page */ }
}
assert_eq!(route.path(), "/books/dune");
assert_eq!(route.query("ref").attr_value(), Some("home"));
assert_eq!(route.hash(), "#reviews");
assert_eq!(route.full_path(), "/books/dune?ref=home#reviews");
```

# `<RouterView>`: a page in a layout

A component with `<RouterView>` takes the page it shows as the `router_view` slot of its `Slots`.
Which page that is, is the server's decision, made from the route as above. This is the
repository's `examples/greeting`, whole:

```vue
<!-- Layout.vue -->
<script setup lang="ts">
defineProps<{ user: string }>();
</script>

<template>
  <div id="app">
    <nav><RouterLink to="/">home</RouterLink> <RouterLink :to="'/users/' + user">{{ user }}</RouterLink></nav>
    <main><RouterView /></main>
  </div>
</template>
```

```rust
# mod generated {
# pub mod route_table {
# // @generated by ferrovue from routes.json. Do not edit: change the routes file and run
# // `ferrovue`.
#
# //! The app's routes: what `<RouterLink>` resolves against and `useRoute()` reads.
#
# /// Each route: its vue-router path, its name if it has one, whether it shows a component, and the
# /// routes nested in it.
# pub const ROUTES: &[ferrovue::RouteDef<'static>] = &[
#     ferrovue::RouteDef { path: "/", name: None, view: true, children: &[] },
#     ferrovue::RouteDef { path: "/users/:name", name: None, view: true, children: &[] },
# ];
#
# /// Every route's full path, nested ones included.
# pub const PATHS: &[&str] = &[
#     "/",
#     "/users/:name",
# ];
#
# /// The history's base, which every link's `href` starts with.
# pub const BASE: &str = "";
#
# /// The router these routes make: build it once, and resolve each request's location with
# /// [`ferrovue::Router::at`].
# pub fn router() -> ferrovue::Router {
#     ferrovue::Router::tree(ROUTES).with_base(BASE)
# }
# }
# pub mod greeting {
# // @generated by ferrovue from components/Greeting.vue. Do not edit: change the `.vue` file and run
# // `ferrovue`.
#
# use std::borrow::Cow;
#
# use ferrovue as fv;
#
# /// The component's name, as `data-island` carries it.
# pub const NAME: &str = "Greeting";
#
# /// The props `Greeting.vue` declares.
# #[derive(Debug, Clone, serde::Serialize)]
# #[cfg_attr(test, derive(serde::Deserialize))]
# pub struct Props<'a> {
#     #[serde(rename = "name")]
#     pub name: Cow<'a, str>,
#     #[serde(rename = "unread")]
#     pub unread: i64,
#     #[serde(rename = "note", default, skip_serializing_if = "Option::is_none")]
#     pub note: Option<Cow<'a, str>>,
# }
#
# impl<'a> Props<'a> {
#     /// Props with its required fields, every optional one absent.
#     pub fn new(name: impl Into<Cow<'a, str>>, unread: i64) -> Self {
#         Props { name: name.into(), unread, note: None }
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
# /// Write the component's server render into `out`.
# pub fn render(out: &mut String, props: &Props<'_>) {
#     out.reserve(70 + props.name.len() + props.note.as_deref().map_or(0, str::len));
#     out.push_str("<p class=\"greeting\">Hello, ");
#     fv::escape_into(out, &props.name);
#     out.push('!');
#     if props.unread != 0 {
#         out.push_str("<b>");
#         fv::push_int(out, props.unread);
#         out.push_str(" new</b>");
#     } else {
#         out.push_str("<!---->");
#     }
#     if let Some(n1) = props.note.as_deref().filter(|v| !v.is_empty()) {
#         out.push_str("<i>");
#         fv::escape_into(out, n1);
#         out.push_str("</i>");
#     } else {
#         out.push_str("<!---->");
#     }
#     out.push_str("</p>");
# }
#
# /// The component's markup, for a maud page that shows it without hydrating it.
# pub fn html<'p, 'a>(props: &'p Props<'a>) -> fv::Html<'p, Props<'a>> {
#     fv::Html::markup(props, render)
# }
#
# /// The component as an island the client hydrates.
# pub fn island<'p, 'a>(props: &'p Props<'a>) -> fv::Html<'p, Props<'a>> {
#     fv::Html::island(NAME, props, render)
# }
# }
# pub mod layout {
# // @generated by ferrovue from components/Layout.vue. Do not edit: change the `.vue` file and run
# // `ferrovue`.
#
# use std::borrow::Cow;
#
# use ferrovue as fv;
#
# /// The component's name, as `data-island` carries it.
# pub const NAME: &str = "Layout";
#
# /// The props `Layout.vue` declares.
# #[derive(Debug, Clone, serde::Serialize)]
# #[cfg_attr(test, derive(serde::Deserialize))]
# pub struct Props<'a> {
#     #[serde(rename = "user")]
#     pub user: Cow<'a, str>,
# }
#
# impl<'a> Props<'a> {
#     /// Props with its required fields.
#     pub fn new(user: impl Into<Cow<'a, str>>) -> Self {
#         Props { user: user.into() }
#     }
#
# }
#
#
# /// What a parent puts in the slots `Layout.vue` renders.
# #[derive(Clone, Copy)]
# pub struct Slots<'s> {
#     /// The page `<RouterView>` shows.
#     pub router_view: fv::Slot<'s>,
# }
#
# /// Write the component's server render into `out`.
# pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>, fv_route: &fv::Route<'_>) {
#     out.reserve(137 + props.user.len());
#     out.push_str("<div id=\"app\"><nav>");
#     {
#         let fv_link = fv_route.link("/");
#         out.push_str("<a");
#         if fv_link.exact {
#             out.push_str(" aria-current=\"page\"");
#         }
#         out.push_str(" href=\"");
#         fv::escape_into(out, &fv_link.href);
#         out.push_str("\" class=\"");
#         fv::class_into(out, false, &[if fv_link.active { "router-link-active" } else { "" }, if fv_link.exact { "router-link-exact-active" } else { "" }]);
#         out.push_str("\">home</a>");
#     }
#     out.push(' ');
#     {
#         let fv_link = fv_route.link(&format!("/users/{}", props.user));
#         out.push_str("<a");
#         if fv_link.exact {
#             out.push_str(" aria-current=\"page\"");
#         }
#         out.push_str(" href=\"");
#         fv::escape_into(out, &fv_link.href);
#         out.push_str("\" class=\"");
#         fv::class_into(out, false, &[if fv_link.active { "router-link-active" } else { "" }, if fv_link.exact { "router-link-exact-active" } else { "" }]);
#         out.push_str("\">");
#         fv::escape_into(out, &props.user);
#         out.push_str("</a>");
#     }
#     out.push_str("</nav><main>");
#     fv_slots.router_view.render_to(out);
#     out.push_str("</main></div>");
# }
#
# /// The component's markup, for a maud page that shows it.
# pub fn html<'p, 'a>(props: &'p Props<'a>, fv_slots: Slots<'p>, fv_route: &'p fv::Route<'p>) -> fv::Html<'p, Props<'a>, impl Fn(&mut String, &Props<'a>) + 'p> {
#     fv::Html::markup(props, move |out: &mut String, props: &Props<'a>| render(out, props, fv_slots, fv_route))
# }
# }
# }
use generated::{greeting, layout, route_table};

let router = route_table::router();
let route = router.at("/users/ada");

let greeting = greeting::Props::new("Ada", 3);
// The page the route shows: an island, which the client hydrates from its `data-props`.
let page = |out: &mut String| greeting::island(&greeting).render_to(out);

let mut html = String::new();
layout::render(
    &mut html,
    &layout::Props::new("ada"),
    layout::Slots { router_view: ferrovue::Slot::new(&page) },
    &route,
);
assert_eq!(
    html,
    concat!(
        r#"<div id="app"><nav><a href="/" class="">home</a> "#,
        r#"<a aria-current="page" href="/users/ada" class="router-link-active router-link-exact-active">ada</a></nav>"#,
        r#"<main><div data-island="Greeting" data-props="{&quot;name&quot;:&quot;Ada&quot;,&quot;unread&quot;:3}">"#,
        r#"<p class="greeting">Hello, Ada!<b>3 new</b><!----></p></div></main></div>"#,
    )
);
```

For each `<RouterLink>` the generated code asks the route to resolve the link and writes the result:
[`Route::link`](crate::Route::link) for a string `to`, [`Route::link_named`](crate::Route::link_named)
for `{ name, params, query, hash }`, [`Route::link_path`](crate::Route::link_path) for
`{ path, query, hash }`. Each returns a [`Link`](crate::Link): the `href`, with the base, and
whether it is active and exactly active.

Nested routes work the same way at every level: a parent route's component has a `<RouterView>`
whose slot holds the child route's component. A link to a parent is active, but not exactly active,
on its children's pages.

A component with `<style scoped>` may hold `<RouterLink>`s, which carry its id as vue-router renders
them, but not a `<RouterView>`, which would give the page it shows that component's id: put the
`<RouterView>` in a component without scoped styles. See
[`scoped_styles`](crate::guide::scoped_styles#what-is-refused).

# `useRoute()` and `$route`

A component that reads the route takes the [`Route`](crate::Route) too. Each field is a method, and
`route.query.x` is a [`Query`](crate::Query), because vue-router's query values may be absent, `null`,
a string or an array:

| In the template | In the generated Rust |
|---|---|
| `route.path` | [`Route::path`](crate::Route::path) |
| `route.fullPath` | [`Route::full_path`](crate::Route::full_path) |
| `route.hash` | [`Route::hash`](crate::Route::hash) |
| `route.name` | [`Route::name`](crate::Route::name) |
| `route.params.slug` | [`Route::param`](crate::Route::param) |
| `route.query.q` | [`Route::query`](crate::Route::query) |

`route.meta` and `route.matched` are refused. An optional parameter the location leaves out is
absent, as in vue-router: `route.params.lang` is `undefined`, and `Route::param` is `None`.

# Links when the application navigates on its own

An application may already have a navigation layer of its own: it fetches the next page and swaps
it in, with its own prefetching, page cache and scroll restoration. It can still use `<RouterLink>`
for resolving `to` and for marking the link to the current page, on the server and after
hydration alike, as long as vue-router never leaves the page itself. Otherwise a click pushes a
route that nothing renders: the URL changes and the page does not.

`linkRouter` from `ferrovue/link-router` builds that router from the same routes file the compiler
reads (or, with a folder of pages, the default export of `ferrovue/routes`), with the base and link classes of `ferrovue.config.json`'s `router`:

```ts
import { mountIslands } from "ferrovue";
import islands from "ferrovue/islands";
import { linkRouter } from "ferrovue/link-router";
import routes from "./routes.json";

const router = linkRouter(routes, {
  navigate: (href) => navigateTheOldWay(href), // the application's own navigation
  base: "/app/",                               // as `router.base` in ferrovue.config.json
});
await mountIslands(islands, { router });
```

`ferrovue/link-router` is the one entry that imports vue-router, which stays an optional peer: the
package root and `ferrovue/client` do not load it.

Written by hand, the router is this, and each part is there for a reason:

```ts
const Empty = { render: () => null };
const history = createMemoryHistory(base);
history.replace(location.pathname.slice(history.base.length) + location.search + location.hash);
const router = createRouter({ history, routes: paths.map((path) => ({ path, component: Empty })) });
router.beforeEach((to, from) => {
  if (from === START_LOCATION) return true;
  navigateTheOldWay(history.createHref(to.fullPath));
  return false;
});
```

- **Every route renders nothing.** The router matches locations and shows no page. vue-router
  requires a component for each route, and an empty one renders nothing anywhere it could be shown.
  Hydrated components must not hold a `<RouterView>`, whose content the client would render as
  nothing.
- **The first navigation passes.** It comes from `START_LOCATION`, vue-router's location before
  any navigation, and resolves the page the server rendered. Until it finishes `router.isReady()`
  does not resolve, `mountIslands` does not mount, and no link knows which page is current.
- **Every later navigation is handed over and aborted.** The guard calls the application's
  navigation with the `href`, base included, and returns `false`, so the router stays on the page
  it started on: the active links keep matching the page that is on screen until the application
  replaces it. A click on the link to the current page, which vue-router does not navigate at all,
  is handed over too.
- **A memory history.** vue-router's web history writes its own state into `history.state` when
  the page has none, and listens to `popstate`, where an aborted navigation makes it step the browser's
  history back again. The memory history starts at the page's location and touches neither, which
  leaves the back and forward buttons to the application. Pass `history` to use another.
- **The click belongs to the router.** `<RouterLink>` calls `preventDefault` on a plain left
  click, so a document-level navigation listener sees `defaultPrevented` and leaves that click to
  the guard. A click with a modifier key, on a `target="_blank"` link or already prevented is left
  alone, and reaches the listener, or the browser, as on any link.

What still works is everything `<RouterLink>` and `useRoute()` read from the current route:
`href` with the base, the `router-link-active` and `router-link-exact-active` classes (nested
routes included), `aria-current="page"`, and `useRoute()`'s path, params, query and hash. The router
stays on the page it started on, so when the application swaps in another page, unmount the islands
and mount them again with a new `linkRouter`, built at the new location.

# Panics

[`Router::tree`](crate::Router::tree) panics on a path outside the syntax above or a name used twice.
The generated `router()` builds from routes the compiler has already checked, so this happens only if
the routes are edited by hand; build the router at start-up, and it happens there.
