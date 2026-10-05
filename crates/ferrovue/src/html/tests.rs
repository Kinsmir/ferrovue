use super::*;
use crate::push_number;

#[derive(serde::Serialize)]
struct Label<'a> {
    label: &'a str,
}

fn label(out: &mut String, p: &Label<'_>) {
    out.push_str("<b>");
    escape_into(out, p.label);
    out.push_str("</b>");
}

/// The island wrapper is the one place props reach the page as data, and they may be
/// reader-supplied strings inside an attribute.
#[test]
fn island_props_cannot_leave_their_attribute() {
    let props = Label {
        label: r#""><script>alert(1)</script>"#,
    };
    let html = Html::island("Label", &props, label).into_string();
    assert!(!html.contains("<script>"), "{html}");
    assert!(
        html.starts_with(r#"<div data-island="Label" data-props="{&quot;label&quot;:"#),
        "{html}"
    );
    assert!(html.ends_with("&lt;/script&gt;</b></div>"), "{html}");
}

#[test]
fn the_island_name_is_escaped_too() {
    let props = Label { label: "" };
    let html = Html::island("A\"B", &props, label).into_string();
    assert!(
        html.starts_with(r#"<div data-island="A&quot;B" "#),
        "{html}"
    );
}

#[derive(Debug, serde::Serialize)]
struct Gauge {
    level: f64,
    marks: Vec<f64>,
    top: Option<f64>,
}

fn gauge(out: &mut String, p: &Gauge) {
    push_number(out, p.level);
}

/// `serde_json` alone writes `null` for these, which the client would render as something else.
#[test]
fn an_islands_numbers_that_are_not_finite_are_written_as_javascript_writes_them() {
    let props = Gauge {
        level: f64::NAN,
        marks: vec![f64::INFINITY, 0.5, f64::NEG_INFINITY],
        top: Some(f64::NEG_INFINITY),
    };
    assert_eq!(
        Html::island("Gauge", &props, gauge).into_string(),
        r#"<div data-island="Gauge" data-props="{&quot;level&quot;:NaN,&quot;marks&quot;:[Infinity,0.5,-Infinity],&quot;top&quot;:-Infinity}">NaN</div>"#
    );
}

#[test]
fn html_shows_its_island_and_props_in_debug() {
    let props = Gauge {
        level: 1.5,
        marks: vec![],
        top: None,
    };
    assert_eq!(
        format!("{:?}", Html::markup(&props, gauge)),
        "Html { island: None, props: Gauge { level: 1.5, marks: [], top: None }, .. }"
    );
    assert_eq!(
        format!("{:?}", Html::island("Gauge", &props, gauge)),
        r#"Html { island: Some("Gauge"), props: Gauge { level: 1.5, marks: [], top: None }, .. }"#
    );
}

#[test]
fn render_to_appends_to_what_the_buffer_holds() {
    let props = Label { label: "x" };
    let mut out = String::from("<p>");
    Html::markup(&props, label).render_to(&mut out);
    assert_eq!(out, "<p><b>x</b>");
}

#[cfg(feature = "maud")]
#[test]
fn a_render_splices_into_a_maud_page() {
    let props = Label { label: "<x>" };
    let page = maud::html! { main { (Html::markup(&props, label)) } };
    assert_eq!(page.into_string(), "<main><b>&lt;x&gt;</b></main>");
}

#[test]
fn markup_is_the_render_alone() {
    let props = Label { label: "a&b" };
    assert_eq!(Html::markup(&props, label).into_string(), "<b>a&amp;b</b>");
}
