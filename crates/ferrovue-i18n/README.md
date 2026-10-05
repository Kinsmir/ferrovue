# ferrovue-i18n

[![crates.io](https://img.shields.io/crates/v/ferrovue-i18n.svg)](https://crates.io/crates/ferrovue-i18n)
[![docs.rs](https://img.shields.io/docsrs/ferrovue-i18n)](https://docs.rs/ferrovue-i18n)

vue-i18n's `t()` for [ferrovue](https://crates.io/crates/ferrovue), which compiles Vue components
to Rust render functions. ferrovue's compiler parses every message with vue-i18n's own message
compiler at build time; this crate evaluates them on the server as vue-i18n does: named and list
interpolation, literals, linked messages and their modifiers, plurals and fallback locales.

You don't need to depend on this crate: `ferrovue` re-exports it as `ferrovue::i18n` (and
`ferrovue::I18n`) with its `i18n` feature, which is on by default. It is a crate of its own so that
an application with no translations can turn that feature off and build none of it.

It is released with `ferrovue` and always has the same version. See the
[i18n guide](https://docs.rs/ferrovue/latest/ferrovue/guide/i18n/index.html) and the
[repository](https://github.com/Kinsmir/ferrovue).

## Licence

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT licence](LICENSE-MIT),
at your option.
