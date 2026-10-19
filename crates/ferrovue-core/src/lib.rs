//! The primitives [ferrovue](https://docs.rs/ferrovue)'s runtime crates share: Vue's HTML escaping,
//! numbers written as JavaScript writes them, and URIs encoded as JavaScript encodes them.
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
mod uri;

pub use escape::escape_into;
pub use numbers::{
    Js, js_max, js_min, js_round, js_sign, js_to_exponential, js_to_fixed, js_to_precision,
    push_int, push_number,
};
pub use uri::{js_encode_uri, js_encode_uri_component};
#[doc(hidden)]
pub use uri::{kept_by_encode_uri, percent_encode_into};
