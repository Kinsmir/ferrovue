use super::*;
use ferrovue_core::push_number;

#[derive(serde::Serialize)]
struct Label<'a> {
    label: &'a str,
}

fn label(out: &mut String, p: &Label<'_>) {
    out.push_str("<b>");
    escape_into(out, p.label);
    out.push_str("</b>");
}

fn refuse(out: &mut String, _: &Label<'_>) -> Result<(), Refused> {
    out.push_str("<b>");
    crate::render::try_int(1e20).map(drop)
}

#[test]
fn a_fallible_component_returns_its_try_render_s_refusal() {
    let props = Label { label: "x" };
    let mut out = String::from("kept");
    for html in [
        Html::markup_fallible(&props, label, refuse),
        Html::island_fallible("Label", &props, label, refuse),
    ] {
        assert_eq!(html.try_render_to(&mut out).unwrap_err().code(), "FV0724");
        assert_eq!(out, "kept");
    }
    for html in [
        Html::markup_owned_fallible(Label { label: "x" }, label, refuse),
        Html::island_owned_fallible("Label", Label { label: "x" }, label, refuse),
    ] {
        assert_eq!(html.try_into_string().unwrap_err().code(), "FV0724");
    }
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

#[test]
fn an_island_writes_where_its_props_hold_dates_beside_them() {
    let props = Gauge {
        level: 1.0,
        marks: Vec::new(),
        top: None,
    };
    assert_eq!(
        Html::island("Gauge", &props, gauge)
            .dates(r#"[{"at":"<&'>"}]"#)
            .hydrate(Hydrate::Idle)
            .into_string(),
        r#"<div data-island="Gauge" data-props="{&quot;level&quot;:1.0,&quot;marks&quot;:[],&quot;top&quot;:null}" data-hydrate="idle" data-dates="[{&quot;at&quot;:&quot;&lt;&amp;&#39;&gt;&quot;}]">1</div>"#
    );
    assert_eq!(Html::markup(&props, gauge).dates("[1]").into_string(), "1");
}

mod basic_html {
    use super::*;
    use crate::{html::Html, html::trusted_into};

    fn basic(s: &str) -> String {
        BasicHtml::new(s).into_string()
    }

    #[test]
    fn the_allowed_tags_are_kept() {
        let html = "<p><b>a</b> <i>b</i> <em>c</em> <strong>d</strong> <code>e</code><br>f</p><ul><li>g</li></ul><ol><li>h</li></ol>";
        assert_eq!(basic(html), html);
    }

    #[test]
    fn text_is_escaped() {
        assert_eq!(
            basic(r#"a "b" 'c' > d"#),
            "a &quot;b&quot; &#39;c&#39; &gt; d"
        );
    }

    #[test]
    fn script_elements_stay_text() {
        assert_eq!(
            basic("<script>alert(1)</script>"),
            "&lt;script&gt;alert(1)&lt;/script&gt;"
        );
        assert_eq!(
            basic("<scr<b>ipt>alert(1)</scr</b>ipt>"),
            "&lt;scr<b>ipt&gt;alert(1)&lt;/scr</b>ipt&gt;"
        );
    }

    #[test]
    fn allowed_tags_with_attributes_or_spaces_stay_text() {
        for tag in [
            r#"<b onclick="alert(1)">"#,
            "<b onclick=alert(1)>",
            "<b >",
            "<b/>",
            "<br/>",
            "<br />",
            "< b>",
            "<b\n>",
            "<b\0>",
            r#"<a href="javascript:alert(1)">"#,
            "<img src=x onerror=alert(1)>",
        ] {
            let out = basic(tag);
            assert!(out.starts_with("&lt;"), "{tag}: {out}");
            assert!(!out.contains('<'), "{tag}: {out}");
        }
    }

    #[test]
    fn other_cases_stay_text() {
        assert_eq!(
            basic("<B>a</B><Em>b</eM>"),
            "&lt;B&gt;a&lt;/B&gt;&lt;Em&gt;b&lt;/eM&gt;"
        );
    }

    #[test]
    fn references_stay_text() {
        assert_eq!(basic("&lt;b&gt;x&lt;/b&gt;"), "&lt;b&gt;x&lt;/b&gt;");
        assert_eq!(
            basic("&#60;b&#x3e; &eacute; &#X3C;"),
            "&#60;b&#x3e; &eacute; &#X3C;"
        );
        assert_eq!(basic("&#1234567; &#x10FFFF;"), "&#1234567; &#x10FFFF;");
        let long = format!("&{};", "a".repeat(32));
        assert_eq!(basic(&long), long);
    }

    #[test]
    fn ampersands_that_start_no_reference_are_escaped() {
        assert_eq!(
            basic("a & b &; &# &#; &#x; &1; &lt &#12345678; &#x1234567; &amp"),
            "a &amp; b &amp;; &amp;# &amp;#; &amp;#x; &amp;1; &amp;lt &amp;#12345678; &amp;#x1234567; &amp;amp"
        );
        let long = format!("&{};", "a".repeat(33));
        assert_eq!(basic(&long), format!("&amp;{}", &long[1..]));
    }

    #[test]
    fn elements_left_open_are_closed() {
        assert_eq!(basic("<b><i>a"), "<b><i>a</i></b>");
        assert_eq!(basic("<ul><li>a<li>b"), "<ul><li>a</li><li>b</li></ul>");
    }

    #[test]
    fn stray_end_tags_are_left_out() {
        assert_eq!(basic("</p>a</b></li></ul>b"), "ab");
        assert_eq!(basic("</br>"), "&lt;/br&gt;");
    }

    #[test]
    fn misnested_tags_are_closed_in_order() {
        assert_eq!(basic("<b><i>a</b>b</i>"), "<b><i>a</i></b>b");
        assert_eq!(basic("<p>a<p>b"), "<p>a</p><p>b</p>");
        assert_eq!(basic("<b>a<p>b</p>c</b>"), "<b>a</b><p>b</p>c");
        assert_eq!(
            basic("<p>a<ul><li>b</ul>c</p>"),
            "<p>a</p><ul><li>b</li></ul>c"
        );
        assert_eq!(
            basic("<ul><li>a<ol><li>b<li>c</ol>d<li>e</ul>"),
            "<ul><li>a<ol><li>b</li><li>c</li></ol>d</li><li>e</li></ul>"
        );
        assert_eq!(
            basic("<ul><li><b>a<li>b"),
            "<ul><li><b>a</b></li><li>b</li></ul>"
        );
    }

    #[test]
    fn a_list_item_outside_a_list_stays_text() {
        assert_eq!(basic("<li>a</li>"), "&lt;li&gt;a");
    }

    #[test]
    fn nesting_stops_at_the_depth_limit() {
        let out = basic(&"<b>".repeat(40));
        assert_eq!(out.matches("<b>").count(), MAX_DEPTH);
        assert_eq!(out.matches("&lt;b&gt;").count(), 40 - MAX_DEPTH);
        assert_eq!(out.matches("</b>").count(), MAX_DEPTH);
    }

    #[test]
    fn nul_characters_are_left_out_and_line_breaks_are_newlines() {
        assert_eq!(basic("a\0b<\0b>c\r\nd\re"), "ab&lt;b&gt;c\nd\ne");
    }

    #[test]
    fn very_long_input_is_built_in_one_pass() {
        let input = "<b>x</b><scr<i>ipt>&amp;</i></p>\r\n".repeat(100_000);
        assert_eq!(
            basic(&input),
            "<b>x</b>&lt;scr<i>ipt&gt;&amp;</i>\n".repeat(100_000)
        );
        let deep = "<i>".repeat(100_000);
        assert!(basic(&deep).ends_with(&format!("&lt;i&gt;{}", "</i>".repeat(MAX_DEPTH))));
    }

    #[test]
    fn building_again_gives_the_same_html() {
        for input in [
            "<b>a & b</b><p>c<ul><li>d",
            "&lt;b&gt;<li>\r<B>",
            "<ul><li>a<ol><li>b<li>c</ol>d<li>e</ul>",
        ] {
            let once = basic(input);
            assert_eq!(basic(&once), once, "{input}");
        }
    }

    #[test]
    fn text_becomes_paragraphs_and_line_breaks() {
        assert_eq!(
            BasicHtml::from_text("\n\nOne\ntwo <b>\r\n \r\n\n& three\0\n").as_str(),
            "<p>One<br>two &lt;b&gt;</p><p>&amp; three</p>"
        );
        assert_eq!(BasicHtml::from_text(" \n\n").as_str(), "");
    }

    #[test]
    fn text_reads_back_as_itself() {
        let text = BasicHtml::from_text("a <i>\n\nb &amp; c");
        assert_eq!(BasicHtml::new(text.as_str()), text);
    }

    #[test]
    fn v_html_writes_the_string_unchanged() {
        let html = BasicHtml::new("<b>a</b><img src=x>");
        let mut out = String::new();
        trusted_into(&mut out, &html);
        assert_eq!(out, "<b>a</b>&lt;img src=x&gt;");
    }

    #[derive(Serialize)]
    struct Props {
        body: BasicHtml,
    }

    fn render(out: &mut String, props: &Props) {
        out.push_str("<article>");
        trusted_into(out, &props.body);
        out.push_str("</article>");
    }

    #[test]
    fn an_island_carries_the_string_it_rendered() {
        let props = Props {
            body: BasicHtml::new("<b>a</b> & <i>b"),
        };
        assert_eq!(
            Html::island("Note", &props, render).into_string(),
            r#"<div data-island="Note" data-props="{&quot;body&quot;:&quot;&lt;b&gt;a&lt;/b&gt; &amp;amp; &lt;i&gt;b&lt;/i&gt;&quot;}"><article><b>a</b> &amp; <i>b</i></article></div>"#
        );
        let json = serde_json::to_value(&props).unwrap();
        assert_eq!(json["body"], props.body.as_str());
    }

    #[test]
    fn deserialising_builds_it_again() {
        let read: BasicHtml = serde_json::from_str(r#""<b onclick=x>a</b><i>b""#).unwrap();
        assert_eq!(read.as_str(), "&lt;b onclick=x&gt;a<i>b</i>");
        let again: BasicHtml =
            serde_json::from_str(&serde_json::to_string(&read).unwrap()).unwrap();
        assert_eq!(again, read);
    }

    #[test]
    fn the_tags_are_the_ones_it_keeps() {
        for name in BasicHtml::TAGS {
            let tag = Tag::named(name.as_bytes()).unwrap();
            assert_eq!(tag.name(), name);
        }
    }

    fn inline(s: &str) -> String {
        InlineHtml::new(s).into_string()
    }

    #[test]
    fn inline_html_keeps_the_inline_tags() {
        let html = "<b>a</b> <i>b</i> <em>c</em> <strong>d</strong> <code>e</code><br>f";
        assert_eq!(inline(html), html);
    }

    #[test]
    fn inline_html_writes_block_tags_as_text() {
        assert_eq!(
            inline("<p>a</p><ul><li>b</li></ul><ol></ol>"),
            "&lt;p&gt;a&lt;/p&gt;&lt;ul&gt;&lt;li&gt;b&lt;/li&gt;&lt;/ul&gt;&lt;ol&gt;&lt;/ol&gt;"
        );
        assert_eq!(inline("<b>a<p>b</b>"), "<b>a&lt;p&gt;b</b>");
    }

    #[test]
    fn inline_html_escapes_balances_and_reads_text_as_basic_html_does() {
        assert_eq!(
            inline("<b><i>a</b>b</i> & &amp; </br>\0\r\n<B>"),
            "<b><i>a</i></b>b &amp; &amp; &lt;/br&gt;\n&lt;B&gt;"
        );
        let out = inline(&"<i>".repeat(40));
        assert_eq!(out.matches("<i>").count(), MAX_DEPTH);
    }

    #[test]
    fn inline_html_reads_back_as_itself() {
        let read: InlineHtml = serde_json::from_str(r#""<b>a</b><p>b""#).unwrap();
        assert_eq!(read.as_str(), "<b>a</b>&lt;p&gt;b");
        assert_eq!(InlineHtml::new(read.as_str()), read);
        assert_eq!(
            serde_json::to_string(&read).unwrap(),
            r#""<b>a</b>&lt;p&gt;b""#
        );
        let mut out = String::new();
        trusted_into(&mut out, &read);
        assert_eq!(out, read.as_str());
    }

    #[test]
    fn the_inline_tags_are_the_inline_ones_it_keeps() {
        for name in BasicHtml::TAGS {
            let tag = Tag::named(name.as_bytes()).unwrap();
            assert_eq!(tag.is_inline(), InlineHtml::TAGS.contains(&name), "{name}");
        }
    }
}

mod trusted {
    use super::*;

    struct Sanitised(&'static str);

    impl TrustedHtml for Sanitised {
        fn trusted_html(&self) -> &str {
            self.0
        }
    }

    #[test]
    fn trusted_html_is_written_as_it_is() {
        let mut out = String::new();
        trusted_into(&mut out, &Sanitised("<p>a &amp; <em>b</em></p>"));
        assert_eq!(out, "<p>a &amp; <em>b</em></p>");
    }
}

#[cfg(feature = "ammonia")]
mod sanitised {
    use super::*;
    use crate::{html::Html, html::trusted_into};

    #[test]
    fn script_elements_are_removed_with_their_content() {
        assert_eq!(
            Sanitised::new("<p>a</p><script>alert(1)</script><SCRIPT src=x></SCRIPT>b").as_str(),
            "<p>a</p>b"
        );
    }

    #[test]
    fn no_value_holds_a_hole() {
        for input in [
            crate::page::HOLE,
            "<fv-hole>",
            "<p title='<fv-hole\"</script</style</noscript>'>x</p>",
        ] {
            let mut policy = ammonia::Builder::new();
            policy
                .add_tags(["fv-hole"])
                .add_generic_attributes(["title"]);
            for html in [Sanitised::new(input), Sanitised::with(&policy, input)] {
                assert!(!html.as_str().contains(crate::page::HOLE), "{html:?}");
            }
            assert!(
                !crate::html::BasicHtml::new(input)
                    .as_str()
                    .contains(crate::page::HOLE)
            );
            assert!(
                !crate::html::InlineHtml::new(input)
                    .as_str()
                    .contains(crate::page::HOLE)
            );
        }
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
        let html =
            Sanitised::new(r#"<p>Fine <i onclick="x()">read</i> &lt;3</p><script>x()</script>"#);
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
        let again: Sanitised =
            serde_json::from_str(&serde_json::to_string(&read).unwrap()).unwrap();
        assert_eq!(again, read);
    }

    #[test]
    fn the_string_can_be_taken_back() {
        assert_eq!(Sanitised::new("<i>a</i>").into_string(), "<i>a</i>");
    }
}

struct Cleaned(&'static str);

impl TrustedHtml for Cleaned {
    fn trusted_html(&self) -> &str {
        self.0
    }
}

#[test]
fn splice_replaces_only_empty_elements_whose_one_attribute_is_the_marker() {
    let html = Cleaned(concat!(
        "<p data-part=\"a\">text</p>",
        "<div data-part=\"a\"></div>",
        "<span data-part=\"b&quot;&lt;&amp;\"></span>",
        "<div class=\"x\" data-part=\"a\"></div>",
        "<div data-part=\"a\" class=\"x\"></div>",
        "<div data-parts=\"a\"></div>",
        "<div data-part=\"a\"></span>",
        "a < b <",
        "<custom-el data-part=\"c\"></custom-el>",
    ));
    let mut seen = Vec::new();
    let spliced = splice(&html, "data-part", |name, out| {
        seen.push(name.to_owned());
        out.push('[');
        out.push_str(name);
        out.push(']');
        name != "c"
    });
    assert_eq!(seen, ["a", "b\"<&", "c"]);
    assert_eq!(
        spliced.as_str(),
        concat!(
            "<p data-part=\"a\">text</p>",
            "[a]",
            "[b\"<&]",
            "<div class=\"x\" data-part=\"a\"></div>",
            "<div data-part=\"a\" class=\"x\"></div>",
            "<div data-parts=\"a\"></div>",
            "<div data-part=\"a\"></span>",
            "a < b <",
            "<custom-el data-part=\"c\"></custom-el>",
        )
    );
    assert_eq!(
        serde_json::to_string(&spliced).unwrap(),
        serde_json::to_string(spliced.as_str()).unwrap()
    );
    let mut out = String::new();
    trusted_into(&mut out, &spliced);
    assert_eq!(out, spliced.as_str());
}

#[test]
fn splice_keeps_html_without_markers() {
    assert_eq!(splice(&Cleaned(""), "data-part", |_, _| true).as_str(), "");
    assert_eq!(
        splice(&Cleaned("<<>>é<"), "data-part", |_, _| true).as_str(),
        "<<>>é<"
    );
}
