//! The primitives [ferrovue](https://docs.rs/ferrovue)'s runtime crates share: Vue's HTML escaping,
//! and numbers written as JavaScript writes them.
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
#![warn(rustdoc::missing_crate_level_docs)]

mod escape;
mod numbers;

pub use escape::escape_into;
pub use numbers::{Js, js_max, js_min, js_round, js_to_fixed, push_int, push_number};
