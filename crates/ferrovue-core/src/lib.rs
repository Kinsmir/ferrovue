//! The primitives [ferrovue](https://docs.rs/ferrovue)'s runtime crates share: Vue's HTML escaping,
//! and numbers written as JavaScript writes them.
//!
//! Use them through `ferrovue`, which re-exports every item here at its root
//! (`ferrovue::escape_into`, `ferrovue::push_int`, …): that is the path generated code and the
//! documentation use. They live in a crate of their own so that `ferrovue`, `ferrovue-router` and
//! `ferrovue-i18n` share one copy of them, and so that an item escapes and writes numbers the same
//! way whichever of those crates it comes from.
//!
//! # Example
//!
//! ```
//! # use ferrovue_core as ferrovue;
//! let mut out = String::from("<p>");
//! ferrovue::escape_into(&mut out, "Tom & Jerry");
//! out.push(' ');
//! ferrovue::push_number(&mut out, 0.1 + 0.2);
//! out.push_str("</p>");
//! assert_eq!(out, "<p>Tom &amp; Jerry 0.30000000000000004</p>");
//! ```
#![cfg_attr(docsrs, feature(doc_cfg))]
#![warn(
    missing_docs,
    missing_debug_implementations,
    rustdoc::missing_crate_level_docs
)]

mod escape;
mod numbers;

pub use escape::escape_into;
pub use numbers::{Js, js_max, js_min, js_round, js_to_fixed, push_int, push_number};
