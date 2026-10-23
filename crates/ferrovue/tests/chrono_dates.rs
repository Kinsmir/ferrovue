//! The conformance suite's `Date` components, and those holding dates in lists and objects,
//! compiled with `"dateType": "chrono::DateTime<chrono::Utc>"`, rendering the fixtures Vue
//! recorded.

#[rustfmt::skip]
#[path = "chrono_dates/generated/mod.rs"]
#[allow(missing_docs)]
pub mod generated;

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use ferrovue::JsDate;
use generated::{date_post, date_stamp};

#[test]
fn every_fixture_chrono_holds_renders_as_vue_rendered_it_and_the_others_are_refused() {
    let mut rendered = Vec::new();
    let mut refused = Vec::new();
    for component in ["DatePost", "DateStamp", "DateRows", "DateDays"] {
        let dir = Path::new("tests/conformance/fixtures").join(component);
        let mut names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .collect();
        names.sort();
        for json in names {
            let case = format!(
                "{component}/{}",
                json.file_stem().unwrap().to_string_lossy()
            );
            match generated::render_json(component, &fs::read_to_string(&json).unwrap()) {
                Ok(html) => {
                    let want = fs::read_to_string(json.with_extension("html")).unwrap();
                    assert_eq!(html, want, "{case}");
                    rendered.push(case);
                }
                Err(e) => {
                    assert!(
                        e.contains("is beyond what the prop's Rust type holds"),
                        "{case}: {e}"
                    );
                    refused.push(case);
                }
            }
        }
    }
    assert_eq!(
        rendered,
        [
            "DatePost/absent",
            "DatePost/hostile",
            "DatePost/typical",
            "DateStamp/absent",
            "DateStamp/typical",
            "DateRows/empty",
            "DateRows/hostile",
            "DateRows/typical",
            "DateDays/empty",
            "DateDays/hostile",
            "DateDays/typical"
        ]
    );
    assert_eq!(
        refused,
        [
            "DatePost/expanded-years",
            "DatePost/invalid",
            "DatePost/range-edges",
            "DateStamp/invalid",
            "DateRows/invalid",
            "DateRows/range-edges",
            "DateDays/invalid",
            "DateDays/range-edges"
        ]
    );
}

#[test]
fn an_island_carries_a_chrono_date_as_a_js_date_carries_it() {
    let posted = DateTime::<Utc>::from_timestamp_millis(1_710_057_909_007).unwrap()
        + chrono::TimeDelta::nanoseconds(999_999);
    let edited = DateTime::<Utc>::MAX_UTC;
    let props = date_post::Props::new(posted, "Spring", ["a", "b"]).edited(edited);
    let island = date_post::island(&props).into_string();
    assert!(island.starts_with(
        r#"<div data-island="DatePost" data-props="{&quot;posted&quot;:&quot;2024-03-10T08:05:09.007Z&quot;,&quot;edited&quot;:&quot;+262142-12-31T23:59:59.999Z&quot;,&quot;deleted&quot;:null,"#
    ));
    assert!(island.contains("<footer>1710057909007|59 <span>8210266876799999</span>"));
    let stamp = date_stamp::Props::new(posted, edited).deleted(posted);
    let same = date_stamp::Props::new(
        JsDate::from(posted).try_into().unwrap(),
        JsDate::from(edited).try_into().unwrap(),
    )
    .deleted(JsDate::from(posted).try_into().unwrap());
    assert_eq!(
        date_stamp::html(&stamp).into_string(),
        date_stamp::html(&same).into_string()
    );
}
