# ferrovue-core

[![crates.io](https://img.shields.io/crates/v/ferrovue-core.svg)](https://crates.io/crates/ferrovue-core)
[![docs.rs](https://img.shields.io/docsrs/ferrovue-core)](https://docs.rs/ferrovue-core)

The primitives that [ferrovue](https://crates.io/crates/ferrovue)'s runtime crates share: Vue's
HTML escaping (`escapeHtml`), and numbers written and computed as JavaScript writes and computes
them (`String(n)`, `Math.round`, `Math.max`, `Math.min`, `toFixed`).

You don't need to depend on this crate: `ferrovue` re-exports every item at its root
(`ferrovue::escape_into`, `ferrovue::push_int`, …), which is the path generated code uses.
It is a crate of its own so that `ferrovue`, [`ferrovue-router`](https://crates.io/crates/ferrovue-router)
and [`ferrovue-i18n`](https://crates.io/crates/ferrovue-i18n) share one copy.

It is released with `ferrovue` and always has the same version. See the
[repository](https://github.com/Kinsmir/ferrovue) for the whole project.

## Licence

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT licence](LICENSE-MIT),
at your option.
