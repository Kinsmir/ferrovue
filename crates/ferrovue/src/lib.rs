#![doc = include_str!("../docs/crate.md")]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![warn(rustdoc::missing_crate_level_docs)]

/// Attributes: the ones a component's root takes from its parent, and how generated code writes them.
pub mod attrs;
/// HTML of a few tags, built from text a user wrote: what a `TrustedHtml` prop may hold without a sanitiser.
pub mod basic_html;
/// The chunks a page's islands load, read from Vite's manifest, and the preloads they need.
pub mod chunks;
/// `:class`, as Vue's `normalizeClass` writes it.
#[doc(hidden)]
pub mod class;
mod compat;
/// The conformance check a project's own fixtures run through.
pub mod conformance;
/// JavaScript's `Date` methods, as generated code calls them.
#[doc(hidden)]
pub mod dates;
#[cfg(feature = "dioxus")]
#[cfg_attr(docsrs, doc(cfg(feature = "dioxus")))]
pub mod dioxus;
#[cfg(any(doc, doctest))]
pub mod guide;
/// The page head that components set with `useHead`.
pub mod head;
/// A component's HTML, as a page, an island or an owned value.
pub mod html;
/// When an island hydrates.
pub mod hydrate;
/// JavaScript's `Date`, and the Rust types a `Date` prop may be.
pub mod js_date;
mod json;
/// Loaders: the data a component awaits, which the Rust application provides.
pub mod load;
/// A page made of islands and holes, and the record a client reads it back from.
pub mod page;
/// A `Record<string, T>` prop, which keeps its keys in JavaScript's order.
pub mod record;
/// A render that Vue would fail, refused where the component reads what fails it.
pub mod refused;
/// HTML sanitised with ammonia.
#[cfg(feature = "ammonia")]
#[cfg_attr(docsrs, doc(cfg(feature = "ammonia")))]
pub mod sanitised;
/// Slots: content a parent hands a child, and the holes a page fills later.
pub mod slots;
/// The script that carries Pinia's state to the client.
pub mod state;
/// JavaScript's string methods, as generated code calls them.
#[doc(hidden)]
pub mod strings;
/// `<Teleport>`: content written at another place of the page.
pub mod teleport;
/// HTML that a page may hold as it is: what `v-html` renders.
pub mod trusted;
/// Unions of string literals, as Rust enums.
pub mod union;
/// A page streamed as it renders, for axum and actix-web.
#[cfg(feature = "stream")]
#[cfg_attr(docsrs, doc(cfg(feature = "stream")))]
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
