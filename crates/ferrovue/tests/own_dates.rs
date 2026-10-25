//! The conformance suite's `DateStamp` compiled with a `dateType` of its own, whose time values
//! are fractions and values beyond the range of dates, which generated code clips as
//! `new Date(value)` does.

#[rustfmt::skip]
#[path = "own_dates/generated/mod.rs"]
#[allow(missing_docs)]
pub mod generated;

use ferrovue::js_date::JsTime;
use generated::date_stamp;

/// A time value as some other system keeps it, unclipped.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct Loose(f64);

impl JsTime for Loose {
    fn time_value(&self) -> f64 {
        self.0
    }

    fn from_time_value(t: f64) -> Option<Self> {
        Some(Loose(t))
    }
}

fn unescape(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&amp;", "&")
}

#[test]
fn a_time_value_beyond_the_range_or_a_fraction_renders_and_travels_as_new_date_makes_it() {
    let props = date_stamp::Props::new(Loose(1e300), Loose(1_714_555_800_123.9))
        .edited(Loose(-1.5))
        .deleted(Loose(f64::INFINITY));
    let island = date_stamp::island(&props).into_string();
    let (attr, markup) = island
        .strip_prefix(r#"<div data-island="DateStamp" data-props=""#)
        .and_then(|rest| rest.split_once(r#"">"#))
        .expect("the island wrapper");
    assert_eq!(
        markup,
        "<footer>NaN|0 <span>-1</span><span>NaN</span><span>both</span></footer></div>"
    );
    assert_eq!(
        unescape(attr),
        r#"{"at":NaN,"edited":"1969-12-31T23:59:59.999Z","deleted":NaN,"shown":"2024-05-01T09:30:00.123Z"}"#
    );
    let clipped = date_stamp::Props::new(Loose(f64::NAN), Loose(1_714_555_800_123.0))
        .edited(Loose(-1.0))
        .deleted(Loose(f64::NAN));
    assert_eq!(date_stamp::island(&clipped).into_string(), island);
}
