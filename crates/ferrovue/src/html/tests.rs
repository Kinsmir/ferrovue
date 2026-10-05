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

#[test]
fn an_island_says_when_it_hydrates_after_its_props_and_keeps_its_markup() {
    let props = Label { label: "x" };
    let eager = Html::island("Label", &props, label).into_string();
    for (when, attribute) in [
        (Hydrate::Visible, "visible"),
        (Hydrate::visible_with("200px"), "visible:200px"),
        (
            Hydrate::visible_with("10% 0px -5px"),
            "visible:10% 0px -5px",
        ),
        (Hydrate::Idle, "idle"),
        (Hydrate::Interaction, "interaction"),
        (Hydrate::InteractionOn(&[]), "interaction"),
        (
            Hydrate::InteractionOn(&["click", "keydown"]),
            "interaction:click keydown",
        ),
        (
            Hydrate::media("(min-width: 40rem)"),
            "media:(min-width: 40rem)",
        ),
    ] {
        let html = Html::island("Label", &props, label)
            .hydrate(when)
            .into_string();
        let marked = format!(r#"" data-hydrate="{attribute}">"#);
        assert_eq!(html, eager.replacen("\">", &marked, 1));
    }
}

#[test]
fn a_hostile_media_query_or_root_margin_cannot_leave_its_attribute() {
    let props = Label { label: "x" };
    for (query, when, start) in [
        r#"x"><script>alert(1)</script>"#,
        "x' onmouseover='alert(1)",
        "&quot;\"&amp;<>",
        "(min-width: 1px)\n\" data-island=\"Other",
    ]
    .into_iter()
    .flat_map(|query| {
        [
            (query, Hydrate::media(query), r#"" data-hydrate="media:"#),
            (
                query,
                Hydrate::visible_with(query),
                r#"" data-hydrate="visible:"#,
            ),
        ]
    }) {
        let html = Html::island("Label", &props, label)
            .hydrate(when)
            .into_string();
        let at = html.find(start).expect("the attribute") + start.len();
        let (value, rest) = html[at..]
            .split_once('"')
            .expect("the end of the attribute");
        assert_eq!(rest, "><b>x</b></div>", "{html}");
        assert!(!value.contains(['<', '>', '\'']), "{value}");
        let unescaped = value
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&");
        assert_eq!(unescaped, query);
        assert_eq!(html.matches("data-island=\"").count(), 1, "{html}");
    }
}

#[test]
fn markup_has_no_wrapper_to_say_when_it_hydrates() {
    let props = Label { label: "x" };
    assert_eq!(
        Html::markup(&props, label)
            .hydrate(Hydrate::Visible)
            .into_string(),
        "<b>x</b>"
    );
}

#[test]
fn html_shows_when_its_island_hydrates_in_debug() {
    let props = Gauge {
        level: 1.5,
        marks: vec![],
        top: None,
    };
    assert_eq!(
        format!(
            "{:?}",
            Html::island("Gauge", &props, gauge).hydrate(Hydrate::media("print"))
        ),
        r#"Html { island: Some("Gauge"), hydrate: Media("print"), props: Gauge { level: 1.5, marks: [], top: None }, .. }"#
    );
}
