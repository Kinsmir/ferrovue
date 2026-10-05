//! A component whose `TrustedHtml` prop is `ferrovue::Sanitised`, compiled with that `trustedHtml`.

#[rustfmt::skip]
#[path = "sanitised/generated/mod.rs"]
#[allow(missing_docs)]
pub mod generated;

use ferrovue::Sanitised;
use generated::review;

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
