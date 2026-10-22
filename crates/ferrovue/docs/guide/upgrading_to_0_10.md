Upgrading a project from ferrovue 0.9 to 0.10: the steps to take, what behaves differently, and
what a component may now use.

The [CHANGELOG](https://github.com/Kinsmir/ferrovue/blob/main/CHANGELOG.md) lists every change;
this page picks out what an application notices. The page for the release before is
[`upgrading_to_0_9`](crate::guide::upgrading_to_0_9).

# Steps

## 1. Bump both halves together

The npm package and the crates are released together at one version, and generated code works with
the crate of its own release. Bump the npm package:

```sh
pnpm add -D ferrovue@^0.10.0
```

and the crate, in `Cargo.toml`:

```toml
ferrovue = "0.10"
```

`ferrovue` depends on `ferrovue-core`, `ferrovue-router` and `ferrovue-i18n` at exactly its own
version, so an application that names only `ferrovue` gets the other three with it. One that names
any of them itself bumps it to 0.10 as well.

The minimum versions are those of 0.9: Node 22.18 for the npm package, and Rust 1.89, with edition
2024 for the crate that includes the generated code. The peer ranges are unchanged: `vue`
`~3.5.44`, `vue-router` `~5.4.0`, `pinia` `~4.1.0`, `vue-i18n` `~11.4.15` and `@unhead/vue`
`~3.4.3`.

## 2. Generate every component again

```sh
pnpm ferrovue
```

The 0.10 compiler writes version 4 of generated code, and `mod.rs` opens with
`ferrovue::__compat!(4)`. Version 4 calls what the 0.9 crate lacks: the loaders of
[`loaders`](crate::guide::loaders). The 0.10 crate supports versions 2 to 4, so modules generated
by 0.9 still build against it; generate them again all the same. The 0.9 crate supports versions 2
and 3: given a module of version 4 it stops the build at that line, with what to do:

```text
error: this module was generated as version 4 of ferrovue's generated code, and this `ferrovue` crate supports versions 2 to 3: use the `ferrovue` npm package and the `ferrovue` crate of one release, and run `ferrovue` to generate the module again
```

A CI job that runs `pnpm ferrovue --check` reports each module as stale until it is generated
again with 0.10 and committed. A project with no loader gets no `loaders.rs`, and its components'
signatures do not change. See [the version check](crate::guide::generated_code#the-version-check).

## 3. The configuration

`ferrovue.config.json` needs no change, and 0.10 adds no key. `$schema` may name the 0.10.0
schema (`https://cdn.jsdelivr.net/npm/ferrovue@0.10.0/schema.json`).

## 4. Error codes your CI matches

A run now reports every refusal it finds: each component is checked on its
own, and so is each statement and interpolation of a template. The text output ends with a line
that counts them (`3 errors in 2 components`), and `--format json` gives every diagnostic, each
with the new field `help` (`null` where there is none). The exit status is unchanged. A script
that read the first diagnostic still finds it first.

These codes change for the same source:

| Source | 0.9 | 0.10 |
|---|---|---|
| a name imported from a module no relative path or alias leads to (a package, a missing file) | FV0601 or FV0315 | FV0110, naming the specifier and where it was looked for |
| a name imported through an alias the tsconfig declares (`@/lib/format`) | FV0601 | compiles |
| a template's read of a constant the compiler cannot evaluate | FV0613 at the read | the constant's own code (FV0201 to FV0222) at the constant, naming the read |
| an arrow function with a block body | FV0806 | compiles, or FV1901 to FV1905 naming the statement |
| `Object.entries(r)` outside a `v-for` | FV0816 | compiles, or FV0816 for a method that writes or compares whole pairs |
| `Object.values(r)` of a record of lists | FV0815 | compiles |
| `.flat()` and `.flatMap()` | FV0602 | compiles, or FV0834 |
| `?:` whose branches differ in type, written out in `{{ }}`, an attribute or a template literal | FV0623 | compiles |
| an object constant read by a key of a closed set (`PAD[size]`) | FV0222 | compiles |
| a top-level `await` in `<script setup>` | the value is client-only | compiles for a loader, FV2001 otherwise |

FV0221, FV0803, FV0806, FV0815 and FV1509 are retired: the compiler no longer raises them, and
[`error_codes`](crate::guide::error_codes) keeps them listed as retired. The new codes are FV0110,
FV0223 to FV0226 (lookup tables), FV0834 (`.flat()`), FV1901 to FV1908 (statements and functions)
and the area FV20, for loaders.

# Behaviour that changed

## Every refusal at once

`generate` of `ferrovue/compiler` throws the new `GenErrors`, a `GenError` that carries the first
refusal's code, location and message and holds every refusal in `errors` (a `GenError`, or the
`SyntaxError` of a file that does not parse). Code that catches a `GenError` keeps working; to show
them all, read `errors`:

```ts
import { generate, GenErrors } from "ferrovue/compiler";

try {
  generate(root, config);
} catch (e) {
  if (!(e instanceof GenErrors)) throw e;
  for (const each of e.errors) console.error(each.message);
}
```

Nothing is written while any error remains, as before. The Vite plugin and the `ferrovue/volar`
plugin show every error of a run.

## Messages

FV0601 says where the function a template calls comes from (`` `fmt()` calls a function imported
from `./util`, a module the server does not run ``), and messages name syntax in words (an arrow
function, an object literal) where they gave Babel's node types. A test that matches on a
message's text may need its pattern changed; matching on `code` is stable.

## Page apps and loaders

`readPage` returns a third field, `loads`, the page's payloads of loaders' results (`[]` when the
page awaited none). Code that compares the whole object `readPage` returns, as a test may, adds it.
`createPageApp`, `mountPage` and `renderPage` wrap the layout in a `<Suspense>` only when the page
carries loaders' results, so a page with none renders as before.

# Newly supported

Each group links to the guide page that covers it in full.

**Loaders** ([`loaders`](crate::guide::loaders)): a component may `await` a loader at the top of
`<script setup>`, as Vue's server awaits it, where the loader is declared with `defineLoader` and
the Rust app implements the generated `Loaders` trait. The data a handler loaded and passed in as
props can now be loaded by the component itself:

```ts
// components/loaders.ts
import { defineLoader } from "ferrovue";

export interface Post {
  title: string;
}

export const loadPost = defineLoader("loadPost", async (slug: string): Promise<Post> => {
  return (await (await fetch(`/api/posts/${slug}`)).json()) as Post;
});
```

```vue
<script setup lang="ts">
import { loadPost } from "./loaders";

const props = defineProps<{ slug: string }>();
const post = await loadPost(props.slug);
</script>

<template>
  <h1>{{ post.title }}</h1>
</template>
```

The page is then rendered through the generated `loaders::load`, which writes the results for the
client to hydrate from, and hydrated with `mountPage`.

**Statements and functions** ([`script_logic`](crate::guide::script_logic)): `const`, `if` /
`else`, early `return` and `switch` in a `computed`'s body and a list method's callback, and
functions declared in `<script setup>` or exported from a `.ts` file, called from the template and
from `computed`s. A function from a `.ts` file no longer needs a `helpers` entry.

**Imports through aliases** ([`props`](crate::guide::props#imports-through-aliases)): constants,
types and functions imported through the tsconfig's `paths` (Nuxt's and create-vue's included) and
Vite's `resolve.alias`.

**Lookup tables** ([`props`](crate::guide::props)): an object constant read by a key whose type is
a union of literals or an enum (`PAD[size]`), with `??`, `?.` and `v-if` for a member it lacks.

**Mixed `?:`**: `{{ n > 0 ? n : "none" }}` and the like, where the value is only written out.

**Lists** ([`strings`](crate::guide::strings#building-lists)): `Object.entries(r)` read by the
list methods outside a `v-for`, with each pair destructured (`([key, value]) => …`) or read as
`pair[0]` and `pair[1]`; `.flat()` to a literal depth or `Infinity`; `.flatMap()`; and
`Object.values(r)` of a record of lists.

## Refused on purpose

These stay refused, each with a message that says what to write in its place.

| Construct | Code | Why |
|---|---|---|
| a top-level `await` of anything but a loader | FV2001 | the server has no other promise's result |
| a loader argument that is not a string, number or boolean, or a result that may be `undefined` | FV2003, FV2004 | the key and the payload are JSON, which drops `undefined` |
| loops, assignments, `try`, `throw` and `var` in a `computed` or a function | FV1901 to FV1904 | the render has no state to change |
| recursion, `...rest`, `async` functions and generators | FV1906, FV1907 | the server evaluates a call once, where it is written |
| `.join()`, `.includes()` and `.toSorted()` without a comparator of `[key, value]` pairs | FV0816 | JavaScript writes and compares a pair as an array |
| `.flat()` with a depth that is not a literal | FV0834 | the result's type depends on the depth |
| a lookup table read by a key typed `string` or `number` | FV0222 | the key could reach the object's prototype |
