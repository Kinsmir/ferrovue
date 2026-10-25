//! The primitives [ferrovue](https://docs.rs/ferrovue)'s runtime crates share: Vue's HTML escaping,
//! numbers written as JavaScript writes them, and URIs encoded as JavaScript encodes them.
//!
//! # Example
//!
//! ```
//! # mod ferrovue { pub use ferrovue_core as core; }
//! let mut out = String::from("<p>");
//! ferrovue::core::escape::escape_into(&mut out, "Tom & Jerry");
//! out.push(' ');
//! ferrovue::core::numbers::push_number(&mut out, 0.1 + 0.2);
//! out.push_str("</p>");
//! assert_eq!(out, "<p>Tom &amp; Jerry 0.30000000000000004</p>");
//! ```
#![warn(rustdoc::missing_crate_level_docs)]

/// Vue's HTML escaping.
pub mod escape;
/// Numbers written, rounded and compared as JavaScript does it.
pub mod numbers;
/// URIs encoded as JavaScript's `encodeURI` and `encodeURIComponent` encode them.
pub mod uri;
