use super::*;
use crate::{Html, trusted_into};

#[test]
fn script_elements_are_removed_with_their_content() {
    assert_eq!(
        Sanitised::new("<p>a</p><script>alert(1)</script><SCRIPT src=x></SCRIPT>b").as_str(),
        "<p>a</p>b"
    );
}

#[test]
fn event_handlers_are_removed() {
    assert_eq!(
        Sanitised::new(r#"<img src="a.png" onerror="alert(1)"><b onmouseover=alert(1)>x</b>"#)
            .as_str(),
        r#"<img src="a.png"><b>x</b>"#
    );
}

#[test]
fn javascript_urls_are_removed() {
    for href in [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        " javascript:alert(1)",
        "java&#x09;script:alert(1)",
    ] {
        let html = Sanitised::new(&format!(r#"<a href="{href}">x</a>"#));
        assert_eq!(
            html.as_str(),
            r#"<a rel="noopener noreferrer">x</a>"#,
            "{href}"
        );
    }
}

#[test]
fn markup_that_breaks_out_of_its_element_is_closed() {
    assert_eq!(
        Sanitised::new("<em>open</div></td><iframe src=x></iframe><style>*{}</style>").as_str(),
        "<em>open</em>"
    );
}

#[test]
fn what_the_default_policy_leaves_out() {
    assert_eq!(
        Sanitised::new(
            r#"<form action="/x">a<svg><text>z</text></svg><math><mi>z</mi></math><button>c</button></form><p class="c" id="i" style="color:red" lang="en">b<!-- c --></p>"#
        )
        .as_str(),
        r#"ac<p lang="en">b</p>"#
    );
}

#[test]
fn listed_and_relative_urls_are_kept() {
    assert_eq!(
        Sanitised::new(r#"<a href="mailto:a@example.com">a</a><a href="/b">b</a><a href="data:text/html,x">c</a>"#)
            .as_str(),
        r#"<a href="mailto:a@example.com" rel="noopener noreferrer">a</a><a href="/b" rel="noopener noreferrer">b</a><a rel="noopener noreferrer">c</a>"#
    );
}

#[test]
fn safe_markup_is_kept() {
    let html = r#"<p>a &amp; <em>b</em> <a href="https://example.com/" rel="noopener noreferrer">c</a></p>"#;
    assert_eq!(Sanitised::new(html).as_str(), html);
}

#[test]
fn a_policy_of_your_own_is_used() {
    let mut policy = ammonia::Builder::default();
    policy.rm_tags(["em"]).link_rel(None);
    assert_eq!(
        Sanitised::with(&policy, r#"<em>a</em><a href="/b">b</a>"#).as_str(),
        r#"a<a href="/b">b</a>"#
    );
}

#[test]
fn v_html_writes_the_sanitised_string_unchanged() {
    let html = Sanitised::new(r#"<p>Fine <i onclick="x()">read</i> &lt;3</p><script>x()</script>"#);
    let mut out = String::new();
    trusted_into(&mut out, &html);
    assert_eq!(out, html.as_str());
    assert_eq!(out, "<p>Fine <i>read</i> &lt;3</p>");
}

#[derive(Serialize)]
struct Props {
    body: Sanitised,
}

fn render(out: &mut String, props: &Props) {
    out.push_str("<article>");
    trusted_into(out, &props.body);
    out.push_str("</article>");
}

#[test]
fn an_island_carries_the_string_it_rendered() {
    let props = Props {
        body: Sanitised::new(r#"<b title="a &quot;b&quot;">x</b><script>y</script>"#),
    };
    let island = Html::island("Review", &props, render).into_string();
    assert_eq!(
        island,
        r#"<div data-island="Review" data-props="{&quot;body&quot;:&quot;&lt;b title=\&quot;a &amp;quot;b&amp;quot;\&quot;&gt;x&lt;/b&gt;&quot;}"><article><b title="a &quot;b&quot;">x</b></article></div>"#
    );
    let json: serde_json::Value = serde_json::to_value(&props).unwrap();
    assert_eq!(json["body"], props.body.as_str());
}

#[test]
fn deserialising_cleans_the_string() {
    let read: Sanitised =
        serde_json::from_str(r#""<p onclick=\"x()\">a</p><script>b</script>""#).unwrap();
    assert_eq!(read.as_str(), "<p>a</p>");
    let again: Sanitised = serde_json::from_str(&serde_json::to_string(&read).unwrap()).unwrap();
    assert_eq!(again, read);
}

#[test]
fn the_string_can_be_taken_back() {
    assert_eq!(Sanitised::new("<i>a</i>").into_string(), "<i>a</i>");
}
