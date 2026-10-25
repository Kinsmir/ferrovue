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

pub use attrs::{Attr, Attrs, attrs_into, passed_attrs_into};
#[doc(hidden)]
pub use attrs::{class_names, merge_props, scope_attrs, style_text_into};
pub use basic_html::{BasicHtml, InlineHtml};
pub use chunks::{Chunks, ManifestError, Preloads};
#[doc(hidden)]
pub use class::{class_into, class_object};
pub use conformance::check_fixtures;
#[doc(hidden)]
pub use dates::{
    js_date_parse, js_date_utc, js_json_date, js_time_clip, js_to_iso_string, js_to_json,
    js_to_utc_string, js_utc_date, js_utc_day, js_utc_full_year, js_utc_hours, js_utc_milliseconds,
    js_utc_minutes, js_utc_month, js_utc_seconds, try_date_parse, try_date_utc, try_to_iso_string,
};
#[doc(hidden)]
pub use head::HeadDeferral;
pub use head::{Head, HeadHtml, HeadValue};
pub use html::Html;
#[doc(hidden)]
pub use html::{Fallible, Renderer};
pub use hydrate::Hydrate;
#[cfg(feature = "chrono")]
#[cfg_attr(docsrs, doc(cfg(feature = "chrono")))]
pub use js_date::DateOutOfRange;
#[doc(hidden)]
pub use js_date::{DateShape, date_prop, dates_in, js_date_prop, js_time_of, opt_date_prop};
pub use js_date::{JsDate, JsTime};
#[doc(hidden)]
pub use load::{Load, LoadArg, LoadCall, LoadFuture, LoadKey, load_key};
pub use load::{LoadError, Loads, load};
pub use page::{Page, PageHole, PageRecord, PageScript, PageSlot, Part};
pub use record::Record;
pub use refused::Refused;
#[doc(hidden)]
pub use refused::{Refusals, rendered, try_int};
#[cfg(feature = "ammonia")]
#[cfg_attr(docsrs, doc(cfg(feature = "ammonia")))]
pub use sanitised::Sanitised;
pub use slots::{Slot, hole, slot_into, split_holes};
#[doc(hidden)]
pub use slots::{is_comment, scoped_slot_into, scoped_slot_into_slotted, slot_into_slotted};
pub use state::state_script_into;
#[doc(hidden)]
pub use strings::{
    JsOr, js_at, js_char_at, js_char_code_at, js_cmp, js_code_point_at, js_ends_with_at,
    js_includes_from, js_index_of, js_index_of_from, js_item_at, js_json_number, js_json_string,
    js_last_index_of, js_last_index_of_from, js_length, js_number, js_order, js_pad_end,
    js_pad_start, js_parse_float, js_parse_int, js_reduce, js_repeat, js_replace, js_replace_all,
    js_slice, js_slice_items, js_slice_range, js_sorted, js_sorted_by_string, js_split,
    js_split_limit, js_starts_with_at, js_substr, js_substring, js_trim, js_trim_end,
    js_trim_start, try_pad_end, try_pad_start, try_repeat,
};
pub use teleport::Teleports;
#[doc(hidden)]
pub use teleport::teleport_into;
pub use trusted::TrustedHtml;
#[doc(hidden)]
pub use trusted::trusted_into;
#[doc(hidden)]
pub use union::{ParseUnion, UnionShape, check_union, union_prop};
pub use union::{ParseUnionError, Union};
#[cfg(feature = "stream")]
#[cfg_attr(docsrs, doc(cfg(feature = "stream")))]
pub use web::HtmlStream;

#[doc(inline)]
pub use ferrovue_core::{
    escape::escape_into, numbers::Js, numbers::js_max, numbers::js_min, numbers::js_round,
    numbers::js_sign, numbers::js_to_exponential, numbers::js_to_fixed, numbers::js_to_precision,
    numbers::push_int, numbers::push_number, uri::js_encode_uri, uri::js_encode_uri_component,
};
#[cfg(feature = "i18n")]
#[cfg_attr(docsrs, doc(cfg(feature = "i18n")))]
#[doc(inline)]
pub use ferrovue_i18n::I18n;
#[cfg(feature = "router")]
#[cfg_attr(docsrs, doc(cfg(feature = "router")))]
#[doc(inline)]
pub use ferrovue_router::{Link, Query, Route, RouteDef, Router, query_into};

#[cfg(feature = "i18n")]
#[cfg_attr(docsrs, doc(cfg(feature = "i18n")))]
#[doc(inline)]
pub use ferrovue_i18n as i18n;
