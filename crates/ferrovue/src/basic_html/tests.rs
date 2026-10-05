use super::*;
use crate::{Html, trusted_into};

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
    let again: BasicHtml = serde_json::from_str(&serde_json::to_string(&read).unwrap()).unwrap();
    assert_eq!(again, read);
}

#[test]
fn the_tags_are_the_ones_it_keeps() {
    for name in BasicHtml::TAGS {
        let tag = Tag::named(name.as_bytes()).unwrap();
        assert_eq!(tag.name(), name);
    }
}
