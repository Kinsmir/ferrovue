# Full-stack example: a bookshop

An [axum](https://docs.rs/axum) server renders every page with Rust that ferrovue generated from
Vue components, and a [Vite](https://vite.dev) build of the same components hydrates the parts of
the page that need to run in the browser. Copy this directory to start an app of your own: outside
this repository, depend on `ferrovue` from crates.io and npm instead of the workspace paths, and
replace the `*.workspace = true` keys in `Cargo.toml` with your own.

```text
client/components/*.vue ──ferrovue──▶ src/generated/*.rs ──axum──▶ HTML ─┐
                        └──Vite────▶ dist/assets/main-*.js ──────────────┴─▶ browser hydrates
```

## Running it

From the repository root:

```sh
pnpm install
pnpm --filter ferrovue build                     # the ferrovue package itself (only inside this repo)
pnpm --filter ferrovue-example-fullstack build   # the client into dist/, and src/generated/
cargo run -p ferrovue-example-fullstack          # http://localhost:3000 (PORT to change it, DIST_DIR for another client build)
```

While you work on the components, run Vite's dev server and point the Rust server at it. The
ferrovue plugin regenerates `src/generated/` whenever a component, store or the routes change, and
Vite hot-reloads the client:

```sh
pnpm --filter ferrovue-example-fullstack dev                         # Vite on :5173
VITE_DEV_SERVER=http://localhost:5173 cargo run -p ferrovue-example-fullstack
```

Use [bacon](https://dystroy.org/bacon/)'s `bacon run-long -- -p ferrovue-example-fullstack` to restart
the server when the generated Rust changes.

To see one page as the server renders it:

```sh
cargo run -p ferrovue-example-fullstack -- --render /books/dune
```

## What each part shows

| File | Demonstrates |
|---|---|
| `ferrovue.config.json` | A `router` block (a folder of pages, `linkActiveClass`), a `stores` directory, output in `src/generated/`, `"scopeId": "filepath"` |
| `vite.config.ts` | `@vitejs/plugin-vue` with `componentIdGenerator: "filepath"`, so the build and the dev server give scoped styles the ids the server writes |
| `client/pages/` | The routes, from the pages' file names as vue-router's file-based routing reads them: `index.vue` (`/`), `books/[id].vue` (`/books/:id`), `picks.vue` and the catch-all `[...missing].vue`, named `/`, `/books/[id]`, `/picks` and `/[...missing]`. ferrovue builds the server's `route_table.rs` from them and compiles each page (`index.rs`, `books_id.rs`, `picks.rs`, `missing.rs`); the Vite plugin gives the client the same routes as `ferrovue/routes` |
| `client/stores/basket.ts` | A Pinia option store with getters (`count`, `empty`) |
| `client/components/Layout.vue` | `<RouterView>`, `<RouterLink>`s by route name with params, the active-link class; `useHead` with a `titleTemplate` the pages' titles go into |
| `client/components/BasketSummary.vue` | Reading the store (state and getters, `storeToRefs`) on the server; `<style scoped>` |
| `client/pages/index.vue` | The home page: a list, named links with params, a scoped slot the server fills with an island per book |
| `client/pages/books/[id].vue` | The detail page: `useRoute()` params in the template and in a `computed`, a named slot, a slot left as a hole for streaming; its title, description, canonical link and Open Graph tags from its props, with `useHead` and `useSeoMeta` |
| `client/components/AddToBasket.vue` | An island: rendered with `add_to_basket::island()`, so it carries `data-island` and `data-props`; its click handler uses the shared store |
| `client/pages/picks.vue` | The layout of the staff picks page, hydrated whole: a default slot of picks and a `reviews` slot streamed into a hole; a `useHead` that unhead's client head, given to `mountPage` in `client/app.ts`, takes over |
| `client/components/Pick.vue` | A part of that page, rendered from its props, with an `AddToBasket` inside it |
| `client/components/Reviews.vue` | The slow part of the book page, streamed into the hole as an island, with `v-show` the client toggles; `<style scoped>`; a Rust twin's component, and `<ClientOnly>` around one that reads `window` |
| `client/pages/[...missing].vue` | The page for an unknown book or path, which the server sends with status 404 |
| `client/vendor/` | Stand-ins for a component library's components, which ferrovue does not compile: `StarRating`, rendered on the server by its Rust twin, and `ShareLink`, rendered only in the browser |
| `src/ui.rs` | The Rust twin of `StarRating`, listed under `twins` in `ferrovue.config.json` |
| `fixtures/`, `test/conformance.test.ts`, `ferrovue::conformance!` in `src/main.rs` | The conformance suite, in two calls: every component's fixtures rendered by Vue through `conformanceSuite` from `ferrovue/testing` (`FERROVUE_FIXTURES_WRITE=1` records the `.html`) and by the generated Rust, byte for byte, which proves the twin too; the generated Rust checked to be current, and every recorded `.html` hydrated with no mismatch |
| `client/app.ts` | A router over `ferrovue/routes` whose every page renders nothing (`routeRecords`), `hydrateState`, `mountPage` on a page that carries a record, then `mountIslands` of `ferrovue/islands`, which the Vite plugin writes: every island by name, each loaded only on a page that holds it, with one Pinia and one router for them all |
| `src/pages.rs` | Rendering pages from the generated `route_table::router()`, `Props::new(…)`, `Slots`, `ferrovue::state_script_into`, `ferrovue::hole()`, and `reviews::into_island()`, a page holding its props that a handler returns; `ferrovue::Page` for the staff picks, whose record is the last hole; a `ferrovue::Head` per page, rendered after the body and written into `<head>` |
| `src/catalogue.rs` | The shop's books and reviews, standing in for a database; the reviews arrive after a delay so the page has something to stream |
| `src/main.rs` | The axum server: a `ferrovue::HtmlStream` per page, a book's reviews alone at `/books/{id}/reviews`, `dist/assets` served beside it, and `--render` |
| `src/assets.rs` | Finding the entry's hashed script and stylesheets in Vite's manifest, the lazily loaded islands' stylesheets included, or loading from the dev server |
| `test/hydration.test.ts` | The proof: the server's own HTML hydrates with no mismatch, and carries the scope ids the client build's stylesheet selects |
| `browser/hydration.test.ts` | The same in Chromium, Firefox and WebKit: the server started on a free port, its pages opened, the islands clicked, the reviews scrolled into view on a short screen before their code is fetched (`pnpm test:browser`) |

### Islands, and what isn't one

The server's page is static HTML except where the client is told otherwise. ferrovue generates an
`island()` function only for a component that renders from its props alone, because the island's
`data-props` is all the client gets to mount it with. That is why `AddToBasket` calls
`useBasket()` inside its click handler, outside setup: the server render then needs no store,
and the component stays an island.

`client/app.ts` names no island: it hands `mountIslands` the `ferrovue/islands` module, which the
Vite plugin writes from the components that have an `island()`. A new island needs nothing on the
client, only the server calling its `island()`. Each is a chunk of its own, so the home page fetches
`AddToBasket`'s code and not `Reviews`'s; the server links every island's stylesheet up front, so
the markup is styled before its script arrives.

`src/pages.rs` also says when each island hydrates. The home page's buttons are
`.hydrate(Hydrate::Interaction)`: `AddToBasket`'s code is fetched when a pointer enters one, or one
is clicked or focused, and the click that woke it is dispatched again once it has hydrated, so it
still adds the book. The reviews are `.hydrate(Hydrate::Visible)`: on a screen too short to show
them, their code is fetched once they are scrolled into view. The book page's own button hydrates
at once.

`BasketSummary` reads the store while it renders, so it has no `island()`. The layout wraps it in
`<div id="basket">`, and `client/app.ts` hydrates it there with the same Pinia. Clicking "Add to
basket" in one island then updates the summary, because they share the store that `hydrateState`
filled from the server's `<script id="__pinia">`.

### Components ferrovue does not compile

`Reviews` uses two components from `client/vendor/`, written as a component library writes them,
with render functions. `StarRating` must be on the server's page, so `src/ui.rs` renders it: a Rust
twin, named under `twins` in `ferrovue.config.json`, which the generated `reviews.rs` calls. ferrovue
cannot check that the twin writes what Vue writes, so the fixtures do: `pnpm test` renders each
`fixtures/Reviews/*.json` with Vue and compares it with the `.html` beside it, and `cargo test`
renders the same JSON through the generated Rust and compares it with the same `.html`.

`ShareLink` reads `window.location`, so it sits in `<ClientOnly>`: the server writes the fallback,
the island hydrates it, and the link replaces it once the island is mounted.

### Streaming

`books/[id].vue` has a `reviews` slot. The server fills it with `ferrovue::hole()`, renders the whole
document once, and responds with a `ferrovue::HtmlStream` of the document and a future for the
hole's content (the crate's `axum` feature). The response body is a stream: the part before the
hole goes out at once (header, book, basket, "Add to basket"), the reviews follow when the slow
lookup returns, and the rest of the document after them. Watch it with
`curl -N localhost:3000/books/dune`.

### A page hydrated whole

`/picks` is built differently: `picks.vue` is a layout whose default slot holds a `Pick` per book
and whose `reviews` slot is a hole. `src/pages.rs` gives the slots to a `ferrovue::Page` as
`Part`s, made from the same `pick::html(&props)` values that write the markup, renders the layout
inside `<div id="app">`, and leaves one more hole after it for the record. The response streams the
picks at once, the reviews when they arrive, and then the record, which `PageRecord::script` writes
once every hole of the page is filled. `client/app.ts` finds the record and calls `mountPage`,
which loads `picks.vue`, `Pick` and `Reviews` and hydrates the whole layout as one app. Nothing on the
page is an island; "Add to basket" and "Show all reviews" work because the app holds them.

## The hydration test

```sh
pnpm --filter ferrovue-example-fullstack build    # the client build whose manifest the pages link
pnpm --filter ferrovue-example-fullstack test     # vitest, in happy-dom
cargo test -p ferrovue-example-fullstack          # the server's pages, as strings
```

`test/hydration.test.ts` runs `cargo run -p ferrovue-example-fullstack -- --render <path>` for the
home page, a book page and the staff picks, puts each page's body into happy-dom, and runs the
client's own `hydrate()` on it. It fails on any warning Vue logs, which is how Vue reports a
hydration mismatch. It then checks that Vue kept the server's nodes, that the islands work after
hydration, and that a click in one island reaches the store the summary shows. The staff picks are
hydrated a second time with `hydrateRecordedPage` from `ferrovue/testing`, which fails on any
mismatch and on any change hydrating makes to the markup. CI runs it, and also starts the real
server to check that a page streams and its assets are served.

happy-dom parses HTML its own way, though, and Vue hydrates against what the browser parsed, so
`browser/hydration.test.ts` does the same in real browsers:

```sh
pnpm --filter ferrovue-example-fullstack exec playwright install chromium firefox webkit   # once
pnpm --filter ferrovue-example-fullstack test:browser
```

It builds the client into a temporary directory, with Vue's mismatch details kept (production
builds leave out the attribute checks otherwise), builds the server and starts it on a free port
with `DIST_DIR` pointing at that build, and opens the pages in Chromium, Firefox and WebKit through
Playwright. It fails on any warning or error the page logs and on any change hydrating makes to the
document as the browser parsed it, then clicks "Add to basket" and "Show all reviews". It records
the scripts each page requests, so it checks that the home page fetches `AddToBasket`'s code only
when a button is clicked, and that on a 200-pixel-high screen the book page fetches `Reviews`'s
only once the reviews are scrolled into view. The server is stopped when the test ends.

In your own app the store state, the routes and the props all come from your data, so give each
page you serve a case in a test like this one.
