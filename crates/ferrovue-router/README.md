# ferrovue-router

[![crates.io](https://img.shields.io/crates/v/ferrovue-router.svg)](https://crates.io/crates/ferrovue-router)
[![docs.rs](https://img.shields.io/docsrs/ferrovue-router)](https://docs.rs/ferrovue-router)

vue-router's location matching for [ferrovue](https://crates.io/crates/ferrovue), which compiles Vue
components to Rust render functions: `<RouterLink>`'s `href` and active classes, and what
`useRoute()` reads, resolved on the server exactly as the client's vue-router resolves them.

You don't need to depend on this crate: `ferrovue` re-exports it at its root (`ferrovue::Router`,
`ferrovue::Route`, …) with its `router` feature, which is on by default. It is a crate of its own
so that an application with no routes can turn that feature off and build none of it.

It is released with `ferrovue` and always has the same version. See the
[routing guide](https://docs.rs/ferrovue/latest/ferrovue/guide/routing/index.html) and the
[repository](https://github.com/Kinsmir/ferrovue).

## Licence

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT licence](LICENSE-MIT),
at your option.
