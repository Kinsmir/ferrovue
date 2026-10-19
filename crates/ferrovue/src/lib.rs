#![doc = include_str!("../docs/crate.md")]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![warn(rustdoc::missing_crate_level_docs)]

mod attrs;
mod basic_html;
mod chunks;
mod class;
mod compat;
mod conformance;
mod dates;
#[cfg(feature = "dioxus")]
#[cfg_attr(docsrs, doc(cfg(feature = "dioxus")))]
pub mod dioxus;
#[cfg(any(doc, doctest))]
pub mod guide;
mod head;
mod html;
mod hydrate;
mod js_date;
mod json;
mod page;
mod record;
#[cfg(feature = "ammonia")]
mod sanitised;
mod slots;
mod state;
mod strings;
mod teleport;
mod trusted;
#[cfg(feature = "stream")]
mod web;

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
    js_utc_minutes, js_utc_month, js_utc_seconds,
};
#[doc(hidden)]
pub use head::HeadDeferral;
pub use head::{Head, HeadHtml, HeadValue};
pub use html::Html;
pub use hydrate::Hydrate;
#[cfg(feature = "chrono")]
#[cfg_attr(docsrs, doc(cfg(feature = "chrono")))]
pub use js_date::DateOutOfRange;
pub use js_date::{JsDate, JsTime};
#[doc(hidden)]
pub use js_date::{date_prop, js_date_prop, js_time_of, opt_date_prop};
pub use page::{Page, PageHole, PageRecord, PageScript, PageSlot, Part};
pub use record::Record;
#[cfg(feature = "ammonia")]
#[cfg_attr(docsrs, doc(cfg(feature = "ammonia")))]
pub use sanitised::Sanitised;
pub use slots::{Slot, hole, slot_into, split_holes};
#[doc(hidden)]
pub use slots::{is_comment, scoped_slot_into, scoped_slot_into_slotted, slot_into_slotted};
pub use state::state_script_into;
#[doc(hidden)]
pub use strings::{
    js_at, js_char_at, js_cmp, js_index_of, js_json_number, js_json_string, js_last_index_of,
    js_length, js_number, js_pad_end, js_pad_start, js_parse_float, js_parse_int, js_repeat,
    js_replace, js_replace_all, js_slice, js_slice_items, js_slice_range, js_split, js_substring,
    js_trim, js_trim_end, js_trim_start,
};
pub use teleport::Teleports;
#[doc(hidden)]
pub use teleport::teleport_into;
pub use trusted::TrustedHtml;
#[doc(hidden)]
pub use trusted::trusted_into;
#[cfg(feature = "stream")]
#[cfg_attr(docsrs, doc(cfg(feature = "stream")))]
pub use web::HtmlStream;

#[doc(inline)]
pub use ferrovue_core::{
    Js, escape_into, js_max, js_min, js_round, js_to_exponential, js_to_fixed, js_to_precision,
    push_int, push_number,
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
