#![doc = include_str!("../docs/crate.md")]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![warn(rustdoc::missing_crate_level_docs)]

mod attrs;
mod basic_html;
mod chunks;
mod class;
mod compat;
mod conformance;
#[cfg(feature = "dioxus")]
#[cfg_attr(docsrs, doc(cfg(feature = "dioxus")))]
pub mod dioxus;
#[cfg(any(doc, doctest))]
pub mod guide;
mod head;
mod html;
mod hydrate;
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

pub use attrs::{
    Attr, Attrs, attrs_into, class_names, merge_props, passed_attrs_into, scope_attrs,
    style_text_into,
};
pub use basic_html::{BasicHtml, InlineHtml};
pub use chunks::{Chunks, ManifestError, Preloads};
pub use class::{class_into, class_object};
pub use conformance::check_fixtures;
#[doc(hidden)]
pub use head::HeadDeferral;
pub use head::{Head, HeadHtml, HeadValue};
pub use html::Html;
pub use hydrate::Hydrate;
pub use page::{Page, PageHole, PageRecord, PageScript, PageSlot, Part};
pub use record::Record;
#[cfg(feature = "ammonia")]
#[cfg_attr(docsrs, doc(cfg(feature = "ammonia")))]
pub use sanitised::Sanitised;
#[doc(hidden)]
pub use slots::is_comment;
pub use slots::{
    Slot, hole, scoped_slot_into, scoped_slot_into_slotted, slot_into, slot_into_slotted,
    split_holes,
};
pub use state::state_script_into;
pub use strings::{
    js_at, js_char_at, js_cmp, js_index_of, js_json_number, js_json_string, js_last_index_of,
    js_length, js_number, js_pad_end, js_pad_start, js_parse_float, js_parse_int, js_repeat,
    js_replace, js_replace_all, js_slice, js_slice_items, js_slice_range, js_split, js_substring,
    js_trim, js_trim_end, js_trim_start,
};
pub use teleport::{Teleports, teleport_into};
pub use trusted::{TrustedHtml, trusted_into};
#[cfg(feature = "stream")]
#[cfg_attr(docsrs, doc(cfg(feature = "stream")))]
pub use web::HtmlStream;

#[doc(inline)]
pub use ferrovue_core::{
    Js, escape_into, js_max, js_min, js_round, js_to_fixed, push_int, push_number,
};
#[cfg(feature = "i18n")]
#[cfg_attr(docsrs, doc(cfg(feature = "i18n")))]
#[doc(inline)]
pub use ferrovue_i18n::I18n;
#[cfg(feature = "router")]
#[cfg_attr(docsrs, doc(cfg(feature = "router")))]
#[doc(inline)]
pub use ferrovue_router::{Link, Query, Route, RouteDef, Router, query_into};

#[cfg(feature = "ammonia")]
#[cfg_attr(docsrs, doc(cfg(feature = "ammonia")))]
#[doc(no_inline)]
pub use ammonia;
#[cfg(feature = "i18n")]
#[cfg_attr(docsrs, doc(cfg(feature = "i18n")))]
#[doc(inline)]
pub use ferrovue_i18n as i18n;
