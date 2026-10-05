//! A component whose `TrustedHtml` prop is `ferrovue::Sanitised`, compiled with that `trustedHtml`,
//! and `ferrovue::BasicHtml` read back by an HTML parser.

#[rustfmt::skip]
#[path = "sanitised/generated/mod.rs"]
#[allow(missing_docs)]
pub mod generated;

use ferrovue::{BasicHtml, Sanitised};
use generated::review;
use proptest::prelude::*;

fn as_parsed(html: &str) -> String {
    let mut policy = ferrovue::ammonia::Builder::empty();
    policy.add_tags(BasicHtml::TAGS);
    policy.clean(html).to_string()
}

fn decoded(html: &str) -> String {
    html.replace("&lt;", "<")
        .replace("&#60;", "<")
        .replace("&#x3C;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", "\u{a0}")
        .replace("&amp;", "&")
}

fn fragment() -> impl Strategy<Value = &'static str> {
    prop::sample::select(vec![
        "<b>",
        "</b>",
        "<i>",
        "</i>",
        "<em>",
        "</em>",
        "<strong>",
        "</strong>",
        "<code>",
        "</code>",
        "<br>",
        "</br>",
        "<p>",
        "</p>",
        "<ul>",
        "</ul>",
        "<ol>",
        "</ol>",
        "<li>",
        "</li>",
        "<B>",
        "<b class=x>",
        "<script>",
        "<",
        ">",
        "&",
        "&lt;",
        "&#60;",
        "&#x3C;",
        "&amp",
        "\"",
        "'",
        "\0",
        "\r",
        "\n",
        " ",
        "\u{a0}",
        "a",
        "é",
        "😀",
    ])
}

proptest! {
    #[test]
    fn a_browser_parses_basic_html_back_to_the_same_html(parts in prop::collection::vec(fragment(), 0..60)) {
        let html = BasicHtml::new(&parts.concat());
        prop_assert_eq!(decoded(&as_parsed(html.as_str())), decoded(html.as_str()));
        let text = BasicHtml::from_text(&parts.concat());
        prop_assert_eq!(decoded(&as_parsed(text.as_str())), decoded(text.as_str()));
    }
}

const HOSTILE: &str = r#"<p>Loved it <img src="x" onerror="alert(1)"><a href="javascript:alert(2)">really</a></p><script>alert(3)</script>"#;
const CLEAN: &str = r#"<p>Loved it <img src="x"><a rel="noopener noreferrer">really</a></p>"#;

#[test]
fn a_review_body_renders_as_it_was_sanitised() {
    let props = review::Props::new("Ada <3", Sanitised::new(HOSTILE));
    assert_eq!(props.body.as_str(), CLEAN);
    assert_eq!(
        review::html(&props).into_string(),
        format!(
            r#"<figure class="review"><blockquote>{CLEAN}</blockquote><figcaption>Ada &lt;3</figcaption></figure>"#
        )
    );
}

#[test]
fn the_island_carries_the_sanitised_string_for_the_client() {
    let props = review::Props::new("Ada", Sanitised::new(HOSTILE));
    let island = review::island(&props).into_string();
    let attr = island
        .strip_prefix(r#"<div data-island="Review" data-props=""#)
        .and_then(|rest| rest.split_once(r#"">"#))
        .map(|(attr, _)| attr)
        .expect("the props attribute");
    let json = attr
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
    let read: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(read, serde_json::json!({ "reader": "Ada", "body": CLEAN }));
    assert!(island.ends_with(&format!(
        "<blockquote>{CLEAN}</blockquote><figcaption>Ada</figcaption></figure></div>"
    )));
}

#[test]
fn props_read_from_json_are_sanitised() {
    let json = serde_json::json!({ "reader": "Ada", "body": HOSTILE }).to_string();
    let props: review::Props = serde_json::from_str(&json).unwrap();
    assert_eq!(props.body.as_str(), CLEAN);
}
