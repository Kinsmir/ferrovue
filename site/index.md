---
layout: home
title: "ferrovue: Vue 3 components compiled to Rust, byte for byte"
titleTemplate: false
description: "ferrovue compiles Vue 3 single-file components to Rust render functions whose output is byte-identical to Vue's renderToString. What it cannot render exactly is refused with a located FV code."

hero:
  name: ferrovue
  text: Vue 3 components, rendered by Rust
  tagline: Single-file components compiled to Rust render functions whose HTML is byte-identical to Vue's renderToString. The browser hydrates it with the same .vue file.
  image:
    src: /logo.svg
    alt: ferrovue
  actions:
    - theme: brand
      text: Quick start
      link: /guide/quick-start
    - theme: alt
      text: API reference on docs.rs
      link: https://docs.rs/ferrovue
    - theme: alt
      text: GitHub
      link: https://github.com/Kinsmir/ferrovue

features:
  - title: Byte-identical to Vue
    details: The generated Rust writes exactly the bytes Vue's renderToString writes for the same props, so Vue hydrates the page without a mismatch. Every supported construct is held to fixtures recorded from Vue.
  - title: Exact or refused
    details: What ferrovue cannot reproduce exactly is a compile error that names the file, line and construct, with a stable FV code. Props a render cannot write exactly are refused as it renders, so a server answers 400.
  - title: No Node on the server
    details: The compiler runs at build time. The server is your Rust binary, and a render is a function call that writes into a String, 7.7 to 135 times faster than Vue's renderToString in the benchmarks.
---

## Two halves

ferrovue has a build-time half and a run-time half, released together under one version number.

```text
 Button.vue ──(ferrovue compiler, Node)──▶ button.rs ──(your Rust server)──▶ HTML ──▶ Vue hydrates it
```

| | What it is | Published as |
|---|---|---|
| The compiler | Reads `<script setup lang="ts">` components and writes one Rust module per component, at build time on Node. Also the `ferrovue` command, the Vite plugin, the editor plugin and the browser client | npm: [`ferrovue`](https://www.npmjs.com/package/ferrovue) |
| The runtime | The crate the generated Rust calls: escaping, slots, islands, `<RouterLink>` matching, the page head | crates.io: [`ferrovue`](https://crates.io/crates/ferrovue), API on [docs.rs](https://docs.rs/ferrovue) |

ferrovue takes what `@vue/compiler-sfc` compiles a template to for server rendering and translates
that small, closed vocabulary into Rust that writes the same bytes. Vue still decides element
structure, attribute order, whitespace and fragment markers. In the browser, Vue hydrates the HTML
with the same component.

## From a component to HTML

A component:

```vue
<!-- client/components/Greeting.vue -->
<script setup lang="ts">
defineProps<{ name: string; unread: number; note?: string }>();
</script>

<template>
  <p class="greeting">Hello, {{ name }}!<b v-if="unread">{{ unread }} new</b><i v-if="note">{{ note }}</i></p>
</template>
```

`pnpm ferrovue` writes `src/generated/greeting.rs`, which a Rust server calls:

```rust
#[rustfmt::skip]
mod generated;

use generated::greeting::{self, Props};

let props = Props::new("Ada", 3).note("welcome back");
let html = greeting::html(&props).into_string();
assert_eq!(html, r#"<p class="greeting">Hello, Ada!<b>3 new</b><i>welcome back</i></p>"#);

let hostile = greeting::html(&Props::new("<script>", 0)).into_string();
assert_eq!(hostile, r#"<p class="greeting">Hello, &lt;script&gt;!<!----><!----></p>"#);
```

The output is what Vue's `renderToString` writes for the same props, comment markers included.
`greeting::island(&props)` wraps it in an element the browser hydrates with `mountIslands` from
`ferrovue`.

## Quick start

Install both halves:

```sh
pnpm add -D ferrovue
cargo add ferrovue serde --features serde/derive
cargo add --dev serde_json
```

`pnpm ferrovue init` writes a starter `ferrovue.config.json` and a component, and `pnpm ferrovue`
generates the Rust. The [quick start](./guide/quick-start.md) walks through configuring,
generating, rendering and checking in CI, and the [guide](./guide/index.md) covers each part in
order. ferrovue needs Rust 1.89 or later and edition 2024 in the crate that includes the generated
code.

## Performance

Time to render one component to an HTML string: Vue's `renderToString` on Node, and the Rust that
ferrovue generated from the same `.vue` file, given the same props.

<!--@include: ./.generated/benchmarks.md-->

The README's [Performance](https://github.com/Kinsmir/ferrovue#performance) section has the
method, the machine and how to run the benchmarks.

## Links

- Source, issues and examples: [github.com/Kinsmir/ferrovue](https://github.com/Kinsmir/ferrovue)
- API reference and the guide in rustdoc: [docs.rs/ferrovue](https://docs.rs/ferrovue)
- The compiler: [npm: ferrovue](https://www.npmjs.com/package/ferrovue)
- The runtime: [crates.io: ferrovue](https://crates.io/crates/ferrovue)
- What changed in each release: [the changelog](./changelog.md)
