# Changelog

All notable changes to this project are documented here. The crate and the npm package are
released together and share version numbers.

## [Unreleased]

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
