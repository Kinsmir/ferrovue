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

/// `tests/vectors/math.json`, recorded from JavaScript's `Math` and `toFixed`, with `-0` written
/// as "-0" where `String` would hide its sign.
#[test]
fn math_is_javascripts_math() {
    let vectors: Vec<(String, String, String, String)> =
        serde_json::from_str(include_str!("../tests/vectors/math.json")).expect("math vectors");
    assert!(vectors.len() >= 600, "the vectors were not all read");
    let num = |s: &str| -> f64 { s.parse().unwrap_or_else(|_| panic!("{s:?} parses")) };
    let text = |x: f64| {
        if x == 0.0 && x.is_sign_negative() {
            return "-0".to_owned();
        }
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

/// `tests/vectors/class.json`, recorded from Vue's `normalizeClass` of the object the entries make.
#[test]
fn a_class_object_is_normalized_as_vue_normalizes_it() {
    let vectors: Vec<(Vec<(String, bool)>, String)> =
        serde_json::from_str(include_str!("../tests/vectors/class.json")).expect("class vectors");
    assert!(vectors.len() >= 10, "the vectors were not all read");
    for (entries, want) in &vectors {
        let entries: Vec<(bool, &str)> = entries.iter().map(|(n, on)| (*on, n.as_str())).collect();
        assert_eq!(&class_object(&entries), want, "{entries:?}");
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
fn slot_content_is_given_the_slot_scope_id_after_a_space() {
    let content = |out: &mut String, id: &str| {
        out.push_str("<p");
        out.push_str(id);
        out.push_str(">x</p>");
        true
    };
    let mut out = String::new();
    assert!(slot_into_slotted(
        &mut out,
        Some(Slot::slotted(&content)),
        "data-v-a-s",
        None
    ));
    assert_eq!(out, "<!--[--><p data-v-a-s>x</p><!--]-->");
    // No id, and content that takes none, which ignores it.
    out.clear();
    slot_into_slotted(&mut out, Some(Slot::slotted(&content)), "", None);
    let plain = |out: &mut String| out.push_str("<i>y</i>");
    slot_into_slotted(&mut out, Some(Slot::new(&plain)), "data-v-a-s", None);
    assert_eq!(out, "<!--[--><p>x</p><!--]--><!--[--><i>y</i><!--]-->");

    let row = |out: &mut String, p: &RowProps<'_>, id: &str| {
        out.push_str(p.label);
        out.push_str(id);
        true
    };
    let slot: &dyn for<'v> Fn(&mut String, &RowProps<'v>, &str) -> bool = &row;
    out.clear();
    scoped_slot_into_slotted(
        &mut out,
        Some(slot),
        &RowProps { label: "r" },
        "data-v-b-s  data-v-c-s",
        None,
    );
    assert_eq!(out, "<!--[-->r data-v-b-s  data-v-c-s<!--]-->");
}

#[test]
fn scope_attrs_are_keys_of_an_object_in_the_order_first_given() {
    assert_eq!(scope_attrs("", "", ""), "");
    assert_eq!(scope_attrs(" data-v-a", "data-v-a", ""), " data-v-a");
    assert_eq!(
        scope_attrs(" data-v-a data-v-b", "data-v-c", " data-v-b data-v-d-s"),
        " data-v-a data-v-b data-v-c data-v-d-s"
    );
    // Two spaces in a slot scope id make an empty key, which Vue does not write.
    assert_eq!(
        scope_attrs("", "data-v-a", "  data-v-b-s  data-v-c-s"),
        " data-v-a data-v-b-s data-v-c-s"
    );
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

/// Both line separators are escaped, and nothing else that starts with the same byte: U+2069 is
/// E2 81 A9, U+2027 is E2 80 A7.
#[test]
fn the_state_script_escapes_exactly_the_two_line_separators() {
    let state = serde_json::json!(["a\u{2029}b\u{2028}c\u{2069}\u{2027}\u{2029}"]);
    let mut out = String::new();
    state_script_into(&mut out, "s", &state);
    assert_eq!(
        out,
        "<script type=\"application/json\" id=\"s\">[\"a\\u2029b\\u2028c\u{2069}\u{2027}\\u2029\"]</script>"
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

/// A number as `strings.json` spells one: a decimal string, `NaN` or `Infinity`.
fn vector_number(s: &str) -> f64 {
    s.parse().unwrap_or_else(|_| panic!("{s:?} parses"))
}

/// `tests/vectors/strings.json`, recorded from JavaScript's string methods, each string result as
/// a server sends it: a lone surrogate as U+FFFD.
#[test]
fn string_methods_are_javascripts() {
    let vectors: Vec<(String, String, Vec<String>, serde_json::Value)> =
        serde_json::from_str(include_str!("../tests/vectors/strings.json"))
            .expect("string vectors");
    assert!(vectors.len() >= 4000, "the vectors were not all read");
    for (op, s, args, want) in &vectors {
        let num = |i: usize| vector_number(&args[i]);
        let opt = |i: usize| args.get(i).map(|a| vector_number(a));
        let fill = args.get(1).map_or(" ", String::as_str);
        let run = || -> serde_json::Value {
            match op.as_str() {
                "slice" => js_slice(s, num(0), opt(1)).into(),
                "substring" => js_substring(s, num(0), opt(1)).into(),
                "at" => js_at(s, num(0)).into(),
                "charAt" => js_char_at(s, num(0)).into(),
                "indexOf" => js_index_of(s, &args[0]).into(),
                "lastIndexOf" => js_last_index_of(s, &args[0]).into(),
                "split" => js_split(s, &args[0]).into(),
                "replace" => js_replace(s, &args[0], &args[1]).into(),
                "replaceAll" => js_replace_all(s, &args[0], &args[1]).into(),
                "padStart" => js_pad_start(s, num(0), fill).into(),
                "padEnd" => js_pad_end(s, num(0), fill).into(),
                "repeat" => js_repeat(s, num(0)).into(),
                other => panic!("unknown op {other}"),
            }
        };
        if want.get("throws").is_some() {
            let hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(|_| {}));
            let thrown = std::panic::catch_unwind(run);
            std::panic::set_hook(hook);
            assert!(
                thrown.is_err(),
                "{op}({s:?}, {args:?}) throws in JavaScript"
            );
        } else {
            assert_eq!(&run(), want, "{op}({s:?}, {args:?})");
        }
    }
}

/// `tests/vectors/compare.json`, recorded from JavaScript's `<` and `>` on strings.
#[test]
fn strings_are_ordered_as_javascript_orders_them() {
    let vectors: Vec<(String, String, i8)> =
        serde_json::from_str(include_str!("../tests/vectors/compare.json"))
            .expect("compare vectors");
    assert!(vectors.len() >= 400, "the vectors were not all read");
    for (a, b, want) in &vectors {
        assert_eq!(js_cmp(a, b) as i8, *want, "{a:?} against {b:?}");
    }
}

/// `tests/vectors/parse.json`, recorded from `Number`, `parseInt` and `parseFloat`; `-0` is told
/// apart from `0`.
#[test]
fn strings_are_read_as_numbers_as_javascript_reads_them() {
    let vectors: Vec<(String, String, String)> =
        serde_json::from_str(include_str!("../tests/vectors/parse.json")).expect("parse vectors");
    assert!(vectors.len() >= 400, "the vectors were not all read");
    for (op, input, want) in &vectors {
        let x = match op.as_str() {
            "Number" => js_number(input),
            "parseInt" => js_parse_int(input, 0),
            "parseInt10" => js_parse_int(input, 10),
            "parseInt16" => js_parse_int(input, 16),
            "parseFloat" => js_parse_float(input),
            other => panic!("unknown op {other}"),
        };
        let mut got = String::new();
        if x == 0.0 && x.is_sign_negative() {
            got.push('-');
        }
        push_number(&mut got, x);
        assert_eq!(&got, want, "{op}({input:?})");
    }
}

/// `tests/vectors/keys.json`, recorded from `Object.keys(JSON.parse(json))`.
#[test]
fn a_record_keeps_javascripts_order_of_keys() {
    let vectors: Vec<(String, Vec<String>)> =
        serde_json::from_str(include_str!("../tests/vectors/keys.json")).expect("key vectors");
    for (json, want) in &vectors {
        let record: Record<'_, i64> = serde_json::from_str(json).expect("a record");
        assert_eq!(record.keys().collect::<Vec<_>>(), *want, "{json}");
        // Written back in that order, as an island's props, which the browser reads back the same.
        let again: Record<'_, i64> =
            serde_json::from_str(&serde_json::to_string(&record).unwrap()).unwrap();
        assert_eq!(again, record);
    }
}

/// `tests/vectors/json.json`, recorded from `JSON.stringify` of strings.
#[test]
fn strings_are_written_as_json_stringify_writes_them() {
    let vectors: Vec<(String, String)> =
        serde_json::from_str(include_str!("../tests/vectors/json.json")).expect("json vectors");
    for (input, want) in &vectors {
        assert_eq!(&js_json_string(input), want, "{input:?}");
    }
}

#[test]
fn a_record_takes_the_last_value_of_a_repeated_key_in_its_first_place() {
    let record: Record<'_, &str> = [("a", "1"), ("b", "2"), ("a", "3")].into_iter().collect();
    assert_eq!(
        record.iter().collect::<Vec<_>>(),
        [("a", &"3"), ("b", &"2")]
    );
    assert_eq!(record.len(), 2);
    assert!(Record::<'_, i64>::new().is_empty());
}

#[test]
fn json_numbers_are_null_when_not_finite() {
    assert_eq!(js_json_number(f64::NAN), "null");
    assert_eq!(js_json_number(f64::NEG_INFINITY), "null");
    assert_eq!(js_json_number(-0.0), "0");
    assert_eq!(js_json_number(1e21), "1e+21");
}

#[test]
fn slicing_inside_a_pair_keeps_the_rest_whole() {
    assert_eq!(js_slice("a🦀🦀b", 2.0, Some(5.0)), "\u{FFFD}🦀");
    assert_eq!(js_substring("🦀🦀", 3.0, Some(1.0)), "\u{FFFD}\u{FFFD}");
    assert_eq!(js_char_at("🦀", 1.0), "\u{FFFD}");
    assert_eq!(js_at("é🦀", -2.0), Some("\u{FFFD}"));
    assert_eq!(
        js_replace_all("🦀", "", ""),
        "🦀",
        "an empty replacement joins the halves again"
    );
}

#[test]
fn padding_beyond_the_longest_string_panics_as_javascript_throws() {
    let long = std::panic::catch_unwind(|| js_pad_start("a", 1e10, "b"));
    assert!(long.is_err());
    assert_eq!(
        js_pad_end("a", 1e10, ""),
        "a",
        "an empty fill pads nothing, and does not throw"
    );
}

/// `push_number` as it was written before its fast paths, the reference they are held to: the tie
/// between two shortest spellings is looked for in every number, in its exact decimal expansion,
/// all 1,100 digits of it.
fn push_number_exactly(out: &mut String, x: f64) {
    use std::fmt::Write;
    if x.is_nan() {
        out.push_str("NaN");
        return;
    }
    if x == 0.0 {
        // Negative zero too: `String(-0)` is `"0"`.
        out.push('0');
        return;
    }
    if x.is_infinite() {
        out.push_str(if x < 0.0 { "-Infinity" } else { "Infinity" });
        return;
    }
    if x < 0.0 {
        out.push('-');
    }
    // `{:e}` writes the shortest digits that round-trip, as JavaScript chooses them: `d.ddde±N`.
    let mut sci = String::new();
    let _ = write!(sci, "{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').expect("`{:e}` writes an exponent");
    let mut digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    // ECMAScript breaks a tie between two shortest spellings — the number exactly halfway between
    // them — toward the even digit, where Rust's shortest formatting may round the other way.
    let mut exact = String::new();
    let _ = write!(exact, "{:.1100e}", x.abs());
    if let Some((exact_mantissa, exact_exp)) = exact.split_once('e')
        && exact_exp == exp
    {
        let exact_digits: String = exact_mantissa.chars().filter(|c| *c != '.').collect();
        let exact_digits = exact_digits.trim_end_matches('0');
        let k = digits.len();
        if exact_digits.len() == k + 1 && exact_digits.ends_with('5') {
            let lower = &exact_digits[..k];
            let upper = increment_digits(lower);
            let even = |d: &str| {
                d.bytes()
                    .last()
                    .is_some_and(|b| (b - b'0').is_multiple_of(2))
            };
            if upper.len() == k && (digits == lower || digits == upper) {
                digits = if even(lower) { lower.to_owned() } else { upper };
            }
        }
    }
    let k = digits.len() as i32;
    // The position of the decimal point relative to the digits, as the specification's `n`.
    let n = exp
        .parse::<i32>()
        .expect("`{:e}` writes an integer exponent")
        + 1;
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let e = n - 1;
        let _ = write!(out, "e{}{}", if e < 0 { '-' } else { '+' }, e.abs());
    }
}

/// `escapeHtml` a byte at a time, the reference `escape_into`'s word-at-a-time scan is held to.
fn escape_bytewise(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        match c {
            '"' => out.push_str("&quot;"),
            '&' => out.push_str("&amp;"),
            '\'' => out.push_str("&#39;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
    out
}

fn written(push: fn(&mut String, f64), x: f64) -> String {
    let mut out = String::new();
    push(&mut out, x);
    out
}

proptest::proptest! {
    #![proptest_config(proptest::prelude::ProptestConfig::with_cases(20_000))]

    /// Any double: what its bits make, NaN and infinities included.
    #[test]
    fn a_number_is_written_as_the_exact_reference_writes_it(bits in proptest::prelude::any::<u64>()) {
        let x = f64::from_bits(bits);
        proptest::prop_assert_eq!(written(push_number, x), written(push_number_exactly, x));
    }

    /// `m / 2ⁿ`, whose exact decimal expansion is short enough to be a tie between two shortest
    /// spellings, which the fast path decides from `m × 5ⁿ`.
    #[test]
    fn a_short_fraction_is_written_as_the_exact_reference_writes_it(m in 1u64..1 << 53, n in 0i32..64, negative in proptest::prelude::any::<bool>()) {
        let x = m as f64 * 2f64.powi(-n) * if negative { -1.0 } else { 1.0 };
        proptest::prop_assert_eq!(written(push_number, x), written(push_number_exactly, x));
    }

    /// `m × 2ᵉ`, whole numbers from the exact ones up to past where a tie can be.
    #[test]
    fn a_large_whole_number_is_written_as_the_exact_reference_writes_it(m in 1u64..1 << 53, e in 0i32..100) {
        let x = m as f64 * 2f64.powi(e);
        proptest::prop_assert_eq!(written(push_number, x), written(push_number_exactly, x));
    }

    /// Decimal numbers as a page holds them: a few digits, a decimal point somewhere.
    #[test]
    fn a_decimal_is_written_as_the_exact_reference_writes_it(digits in 0u64..100_000_000_000_000_000, point in -30i32..30) {
        let x: f64 = format!("{digits}e{point}").parse().expect("a decimal parses");
        proptest::prop_assert_eq!(written(push_number, x), written(push_number_exactly, x));
    }

    #[test]
    fn an_integer_is_written_as_the_number_it_is(n in proptest::prelude::any::<i64>()) {
        let mut out = String::new();
        push_int(&mut out, n);
        proptest::prop_assert_eq!(&out, &written(push_number_exactly, n as f64));
        proptest::prop_assert_eq!(&Js(n).to_string(), &out);
        if n.unsigned_abs() <= MAX_SAFE_INTEGER {
            proptest::prop_assert_eq!(&out, &n.to_string());
        }
    }

    /// Text around and between the five characters, at every length the word-at-a-time scan reads
    /// differently: shorter than a word, whole words, and a tail that overlaps them.
    #[test]
    fn escaping_is_the_bytewise_reference(s in "[a\"&'<>é🦀 ]{0,40}") {
        let mut out = String::new();
        escape_into(&mut out, &s);
        proptest::prop_assert_eq!(out, escape_bytewise(&s));
    }
}
