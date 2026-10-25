#![doc = include_str!("../docs/crate.md")]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![warn(rustdoc::missing_crate_level_docs)]

/// Attributes, class and style: the attributes a component's root takes from its parent, and how
/// generated code writes them.
pub mod attrs;
mod compat;
/// JavaScript's `Date`: the Rust types a `Date` prop may be, and the methods generated code calls.
pub mod date;
#[cfg(feature = "dioxus")]
#[cfg_attr(docsrs, doc(cfg(feature = "dioxus")))]
pub mod dioxus;
#[cfg(any(doc, doctest))]
pub mod guide;
/// The page head that components set with `useHead`.
pub mod head;
/// HTML: a component's, as a page, an island or an owned value, and the HTML a caller hands
/// `v-html`.
pub mod html;
mod json;
/// Loaders: the data a component awaits, which the Rust application provides.
pub mod loaders;
/// A page assembled from a layout and its parts: holes, the record a client reads back, the chunks
/// its islands load, teleports and the state script.
pub mod page;
/// The types of props beside the scalars: dictionaries and unions of string literals.
pub mod props;
/// What a render takes beside its props and what it refuses: slots, and the refusals of a render
/// Vue would fail.
pub mod render;
/// JavaScript's string methods, as generated code calls them.
#[doc(hidden)]
pub mod strings;
/// The conformance check a project's own fixtures run through.
pub mod testing;
/// Web frameworks: a page streamed as it renders, and responses for axum, actix-web and maud.
#[cfg(any(feature = "stream", feature = "maud"))]
#[cfg_attr(docsrs, doc(cfg(any(feature = "stream", feature = "maud"))))]
pub mod web;

#[doc(inline)]
pub use ferrovue_core as core;
#[cfg(feature = "i18n")]
#[cfg_attr(docsrs, doc(cfg(feature = "i18n")))]
#[doc(inline)]
pub use ferrovue_i18n as i18n;
#[cfg(feature = "router")]
#[cfg_attr(docsrs, doc(cfg(feature = "router")))]
#[doc(inline)]
pub use ferrovue_router as router;
