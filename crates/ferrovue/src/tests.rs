use super::*;

#[test]
fn escape_covers_the_five_characters_vue_escapes() {
    let mut out = String::new();
    escape_into(&mut out, r#"a"b&c'd<e>f"#);
    assert_eq!(out, "a&quot;b&amp;c&#39;d&lt;e&gt;f");
}

#[test]
fn escape_writes_a_clean_string_unchanged() {
    let mut out = String::from("x");
    escape_into(&mut out, "naïve café 日本");
    assert_eq!(out, "xnaïve café 日本");
}

/// `tests/vectors/trim.json`, whose answers the TypeScript side (`packages/ferrovue/test/vectors.test.ts`)
/// takes from JavaScript's own `String.prototype.trim`.
#[test]
fn js_trim_is_javascripts_trim() {
    let vectors: Vec<(String, String)> =
        serde_json::from_str(include_str!("../tests/vectors/trim.json")).expect("trim vectors");
    assert!(vectors.len() >= 6, "the vectors were not all read");
    for (input, want) in &vectors {
        assert_eq!(js_trim(input), want, "trim({input:?})");
    }
}

/// `tests/vectors/escape.json`, held to `@vue/shared`'s `escapeHtml` on the TypeScript side.
#[test]
fn escape_is_vues_escape_html() {
    let vectors: Vec<(String, String)> =
        serde_json::from_str(include_str!("../tests/vectors/escape.json")).expect("escape vectors");
    for (input, want) in &vectors {
        let mut out = String::new();
        escape_into(&mut out, input);
        assert_eq!(&out, want, "escape({input:?})");
    }
}

/// `tests/vectors/length.json`, held to JavaScript's `.length` on the TypeScript side.
#[test]
fn js_length_counts_utf16_code_units() {
    let vectors: Vec<(String, i64)> =
        serde_json::from_str(include_str!("../tests/vectors/length.json")).expect("length vectors");
    for (input, want) in &vectors {
        assert_eq!(js_length(input), *want, "length({input:?})");
    }
}

/// `tests/vectors/numbers.json`, recorded from JavaScript's `String(Number(input))`.
#[test]
fn numbers_are_written_as_javascript_writes_them() {
    let vectors: Vec<(String, String)> =
        serde_json::from_str(include_str!("../tests/vectors/numbers.json"))
            .expect("number vectors");
    assert!(vectors.len() >= 300, "the vectors were not all read");
    for (input, want) in &vectors {
        let x: f64 = input.parse().unwrap_or_else(|_| panic!("{input:?} parses"));
        let mut out = String::new();
        push_number(&mut out, x);
        assert_eq!(&out, want, "String({input})");
    }
}

/// `tests/vectors/math.json`, recorded from JavaScript's `Math` and `toFixed`.
#[test]
fn math_is_javascripts_math() {
    let vectors: Vec<(String, String, String, String)> =
        serde_json::from_str(include_str!("../tests/vectors/math.json")).expect("math vectors");
    assert!(vectors.len() >= 600, "the vectors were not all read");
    let num = |s: &str| -> f64 { s.parse().unwrap_or_else(|_| panic!("{s:?} parses")) };
    let text = |x: f64| {
        let mut out = String::new();
        push_number(&mut out, x);
        out
    };
    for (op, x, arg, want) in &vectors {
        let got = match op.as_str() {
            "round" => text(js_round(num(x))),
            "toFixed" => js_to_fixed(num(x), arg.parse().unwrap()),
            "max" => text(js_max(num(x), num(arg))),
            "min" => text(js_min(num(x), num(arg))),
            other => panic!("unknown op {other}"),
        };
        assert_eq!(&got, want, "{op}({x}, {arg})");
    }
}

#[test]
fn integers_beyond_two_to_the_53_are_written_rounded_as_javascript_does() {
    for (n, want) in [
        (9_007_199_254_740_991, "9007199254740991"),
        (9_007_199_254_740_993, "9007199254740992"),
        (-9_007_199_254_740_993, "-9007199254740992"),
        (i64::MIN, "-9223372036854776000"),
    ] {
        let mut out = String::new();
        push_int(&mut out, n);
        assert_eq!(out, want, "{n}");
        assert_eq!(Js(n).to_string(), want);
    }
}

#[test]
fn integers_are_written_as_javascript_writes_them() {
    for (n, want) in [
        (0, "0"),
        (-1, "-1"),
        (42, "42"),
        (i64::MAX, "9223372036854776000"),
    ] {
        let mut out = String::new();
        push_int(&mut out, n);
        assert_eq!(out, want);
    }
}

#[test]
fn a_class_object_keeps_the_spaces_inside_its_names_as_vue_does() {
    assert_eq!(
        class_object(&[(true, "a"), (true, "  b  "), (false, "c"), (true, "d")]),
        "a   b   d"
    );
    assert_eq!(class_object(&[(true, " x "), (false, "y")]), "x");
    assert_eq!(class_object(&[(false, "x")]), "");
}

#[test]
fn class_lists_drop_empty_items_and_trim_the_rest() {
    let mut out = String::new();
    class_into(&mut out, false, &[" a ", "", "  ", "b<"]);
    assert_eq!(out, "a b&lt;");
    out.clear();
    class_into(&mut out, true, &["", "c"]);
    assert_eq!(
        out, " c",
        "a class already written needs a separator before the next"
    );
}

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

#[test]
fn content_a_caller_supplies_is_never_replaced_by_the_fallback() {
    let comment = |out: &mut String| out.push_str("<!---->");
    let mut out = String::new();
    slot_into(
        &mut out,
        Some(Slot::new(&comment)),
        Some(&mut |out: &mut String| out.push_str("fallback")),
    );
    assert_eq!(out, "<!--[--><!----><!--]-->");
}

#[test]
fn generated_content_of_comments_alone_gives_way_to_the_fallback() {
    let nothing = |out: &mut String| {
        out.push_str("<!---->");
        false
    };
    let mut out = String::new();
    slot_into(
        &mut out,
        Some(Slot::markup(&nothing)),
        Some(&mut |out: &mut String| out.push_str("fallback")),
    );
    assert_eq!(out, "<!--[-->fallback<!--]-->");
}

#[test]
fn generated_content_of_comments_alone_is_dropped_when_there_is_no_fallback() {
    let nothing = |out: &mut String| {
        out.push_str("<!---->");
        false
    };
    let mut out = String::new();
    let filled = slot_into(&mut out, Some(Slot::markup(&nothing)), None);
    assert!(!filled);
    assert_eq!(out, "<!--[--><!--]-->");
}

struct RowProps<'v> {
    label: &'v str,
}

#[test]
fn a_scoped_slot_is_given_the_outlets_props() {
    let content = |out: &mut String, p: &RowProps<'_>| {
        out.push_str(p.label);
        true
    };
    let slot: &dyn for<'v> Fn(&mut String, &RowProps<'v>) -> bool = &content;
    let mut out = String::new();
    let label = String::from("row one");
    assert!(scoped_slot_into(
        &mut out,
        Some(slot),
        &RowProps { label: &label },
        None
    ));
    assert_eq!(out, "<!--[-->row one<!--]-->");
}

#[test]
fn a_scoped_slot_of_comments_alone_or_none_gives_way_to_the_fallback() {
    let nothing = |out: &mut String, _: &RowProps<'_>| {
        out.push_str("<!---->");
        false
    };
    let slot: &dyn for<'v> Fn(&mut String, &RowProps<'v>) -> bool = &nothing;
    for given in [Some(slot), None] {
        let mut out = String::new();
        let filled = scoped_slot_into(
            &mut out,
            given,
            &RowProps { label: "x" },
            Some(&mut |out: &mut String| out.push_str("fallback")),
        );
        assert!(!filled);
        assert_eq!(out, "<!--[-->fallback<!--]-->");
    }
}

#[test]
fn teleported_content_goes_to_its_target_in_the_order_vue_collects_it() {
    let teleports = Teleports::new();
    let mut out = String::from("<main>");
    teleport_into(
        &mut out,
        &teleports,
        "#modals",
        false,
        &|out: &mut String| {
            out.push_str("<div>outer");
            // Nested: it comes after the outer teleport, which took its place first.
            teleport_into(out, &teleports, "#modals", false, &|out: &mut String| {
                out.push_str("<p>inner</p>")
            });
            out.push_str("</div>");
        },
    );
    teleport_into(&mut out, &teleports, "body", true, &|out: &mut String| {
        out.push_str("<i>here</i>")
    });
    out.push_str("</main>");
    assert_eq!(
        out,
        "<main><!--teleport start--><!--teleport end--><!--teleport start--><i>here</i><!--teleport end--></main>"
    );
    assert_eq!(
        teleports.get("#modals").unwrap(),
        "<!--teleport start anchor--><div>outer<!--teleport start--><!--teleport end--></div><!--teleport anchor--><!--teleport start anchor--><p>inner</p><!--teleport anchor-->"
    );
    assert_eq!(
        teleports.get("body").unwrap(),
        "<!--teleport start anchor--><!--teleport anchor-->"
    );
    assert_eq!(teleports.into_targets().len(), 2);
}

#[test]
fn the_state_script_cannot_be_closed_by_a_value_and_reads_back_whole() {
    let state =
        serde_json::json!({ "prefs": { "label": "</script><script>alert(1)</script>&\u{2028}" } });
    let mut out = String::new();
    state_script_into(&mut out, "__pinia", &state);
    let body = out
        .strip_prefix(r#"<script type="application/json" id="__pinia">"#)
        .and_then(|b| b.strip_suffix("</script>"))
        .expect("one script element");
    assert!(!body.contains(['<', '>', '&', '\u{2028}']), "{body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(body).unwrap(),
        state
    );
}

#[test]
fn the_state_script_id_is_escaped() {
    let mut out = String::new();
    state_script_into(&mut out, "a\"b", &serde_json::json!({}));
    assert_eq!(
        out,
        r#"<script type="application/json" id="a&quot;b">{}</script>"#
    );
}

#[test]
fn an_absent_slot_writes_its_fallback_or_nothing() {
    let mut out = String::new();
    assert!(!slot_into(&mut out, None, None));
    assert_eq!(out, "<!--[--><!--]-->");
    out.clear();
    assert!(!slot_into(
        &mut out,
        None,
        Some(&mut |out: &mut String| out.push_str("fallback"))
    ));
    assert_eq!(out, "<!--[-->fallback<!--]-->");
}

#[test]
fn a_render_without_holes_is_one_piece() {
    assert_eq!(split_holes("<a></a>"), ["<a></a>"]);
    assert_eq!(split_holes(""), [""]);
}

#[test]
fn holes_cut_a_render_where_the_caller_writes_later() {
    let mut out = String::new();
    out.push_str("<a>");
    slot_into(&mut out, Some(hole()), None);
    out.push_str("<b>");
    slot_into(
        &mut out,
        Some(hole()),
        Some(&mut |out: &mut String| out.push_str("fallback")),
    );
    out.push_str("</b></a>");
    assert_eq!(
        split_holes(&out),
        ["<a><!--[-->", "<!--]--><b><!--[-->", "<!--]--></b></a>"]
    );
}

/// Messages that vue-i18n cannot evaluate at all: it overflows its stack on a cycle, and throws on
/// a plural number that chooses no case. The rest of `t()` is held to vue-i18n by the conformance
/// components `Translated` and `Plurals`.
static UNEVALUABLE: &[i18n::Locale] = &[i18n::Locale {
    name: "en",
    messages: &[
        (
            "apples",
            i18n::Message {
                cases: &[
                    &[i18n::Part::Text("none")],
                    &[i18n::Part::Text("one")],
                    &[i18n::Part::Text("many")],
                ],
            },
        ),
        (
            "loop",
            i18n::Message {
                cases: &[&[
                    i18n::Part::Text("x"),
                    i18n::Part::Linked {
                        key: "loop",
                        modifier: None,
                    },
                ]],
            },
        ),
    ],
}];

#[test]
fn a_cycle_of_linked_messages_ends_with_the_key_once_nested_too_deep() {
    let i18n = I18n::new(UNEVALUABLE, "en", &[]);
    let out = i18n.t("loop", &i18n::Args::default());
    assert_eq!(
        out,
        format!("{}loop", "x".repeat(33)),
        "the message and 32 links"
    );
}

/// vue-i18n throws on `t("apples", { count: 1.5 })` with three cases; a debug build fails the
/// render the same way.
#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "chooses none of the cases")]
fn a_fraction_that_chooses_no_case_fails_a_debug_render() {
    let named = [("count", i18n::Value::Float(1.5))];
    let args = i18n::Args {
        named: &named,
        ..i18n::Args::default()
    };
    I18n::new(UNEVALUABLE, "en", &[]).t("apples", &args);
}
