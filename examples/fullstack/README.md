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

Use `cargo watch -x 'run -p ferrovue-example-fullstack'` to restart the server when the generated
Rust changes.

To see one page as the server renders it:

```sh
cargo run -p ferrovue-example-fullstack -- --render /books/dune
```

## What each part shows

| File | Demonstrates |
|---|---|
| `ferrovue.config.json` | A `router` block (routes file, `linkActiveClass`), a `stores` directory, output in `src/generated/` |
| `client/routes.json` | Named routes, read by ferrovue for the server and by `client/app.ts` for the client: one list for both |
| `client/stores/basket.ts` | A Pinia option store with getters (`count`, `empty`) |
| `client/components/Layout.vue` | `<RouterView>`, `<RouterLink>`s by route name with params, the active-link class |
| `client/components/BasketSummary.vue` | Reading the store (state and getters, `storeToRefs`) on the server |
| `client/components/BookList.vue` | The home page: a list, named links with params, a scoped slot the server fills with an island per book |
| `client/components/BookPage.vue` | The detail page: `useRoute()` params in the template and in a `computed`, a named slot, a slot left as a hole for streaming |
| `client/components/AddToBasket.vue` | An island: rendered with `add_to_basket::island()`, so it carries `data-island` and `data-props`; its click handler uses the shared store |
| `client/components/Reviews.vue` | The slow part of the book page, streamed into the hole as an island, with `v-show` the client toggles |
| `client/app.ts` | `hydrateState` then `mountIslands`, with one Pinia and one router for every island |
| `src/pages.rs` | Rendering pages from the generated `route_table::router()`, `Props::new(…)`, `Slots`, `ferrovue::state_script_into`, `ferrovue::hole()` and `split_holes` |
| `src/main.rs` | The axum server: a streamed body per page, `dist/assets` served beside it, and `--render` |
| `src/assets.rs` | Finding the entry's hashed script and stylesheet in Vite's manifest, or loading from the dev server |
| `test/hydration.test.ts` | The proof: the server's own HTML hydrates with no mismatch |
| `browser/hydration.test.ts` | The same in Chromium, Firefox and WebKit: the server started on a free port, its pages opened, the islands clicked (`pnpm test:browser`) |

### Islands, and what isn't one

The server's page is static HTML except where the client is told otherwise. ferrovue generates an
`island()` function only for a component that renders from its props alone, because the island's
`data-props` is all the client gets to mount it with. That is why `AddToBasket` calls
`useBasket()` inside its click handler rather than in setup: the server render then needs no store,
and the component stays an island.

`BasketSummary` reads the store while it renders, so it has no `island()`. The layout wraps it in
`<div id="basket">`, and `client/app.ts` hydrates it there with the same Pinia. Clicking "Add to
basket" in one island then updates the summary, because they share the store that `hydrateState`
filled from the server's `<script id="__pinia">`.

### Streaming

`BookPage` has a `reviews` slot. The server fills it with `ferrovue::hole()`, renders the whole
document once, and cuts it with `split_holes`. The response body is a stream: the part before the
hole goes out at once (header, book, basket, "Add to basket"), the reviews follow when the slow
lookup returns, and the rest of the document after them. Watch it with
`curl -N localhost:3000/books/dune`.

## The hydration test

```sh
pnpm --filter ferrovue-example-fullstack test     # vitest, in happy-dom
cargo test -p ferrovue-example-fullstack          # the server's pages, as strings
```

`test/hydration.test.ts` runs `cargo run -p ferrovue-example-fullstack -- --render <path>` for the
home page and a book page, puts each page's body into happy-dom, and runs the client's own
`hydrate()` on it. It fails on any warning Vue logs, which is how Vue reports a hydration mismatch.
It then checks that Vue kept the server's nodes, that the islands work after hydration, and that a
click in one island reaches the store the summary shows. CI runs it, and also starts the real server
to check that a page streams and its assets are served.

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
document as the browser parsed it, then clicks "Add to basket" and "Show all reviews". The server
is stopped when the test ends.

In your own app the store state, the routes and the props all come from your data, so give each
page you serve a case in a test like this one.
