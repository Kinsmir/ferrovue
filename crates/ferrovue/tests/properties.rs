//! Properties of the runtime that hold for every input.

use ferrovue::{
    BasicHtml, InlineHtml, Slot, class_into, escape_into, hole, js_length, js_trim, slot_into,
    split_holes, state_script_into,
};
use proptest::prelude::*;

fn unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn markup_fragment() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("<b>"),
        Just("</b>"),
        Just("<i>"),
        Just("</i>"),
        Just("<em>"),
        Just("</em>"),
        Just("<strong>"),
        Just("</strong>"),
        Just("<code>"),
        Just("</code>"),
        Just("<br>"),
        Just("</br>"),
        Just("<p>"),
        Just("</p>"),
        Just("<ul>"),
        Just("</ul>"),
        Just("<ol>"),
        Just("</ol>"),
        Just("<li>"),
        Just("</li>"),
        Just("<B>"),
        Just("<b onclick=x>"),
        Just("<script>"),
        Just("</script>"),
        Just("<scr"),
        Just("ipt>"),
        Just("<"),
        Just(">"),
        Just("/"),
        Just("&"),
        Just("&lt;"),
        Just("&#60;"),
        Just("&#x3C;"),
        Just("&amp"),
        Just(";"),
        Just("\""),
        Just("'"),
        Just("\0"),
        Just("\r"),
        Just("\n"),
        Just(" "),
        Just("a"),
    ]
    .prop_map(str::to_owned)
}

fn markup() -> impl Strategy<Value = String> {
    prop_oneof![
        proptest::collection::vec(markup_fragment(), 0..40).prop_map(|parts| parts.concat()),
        any::<String>(),
    ]
}

const BASIC_TAGS: [&str; 10] = [
    "b", "i", "em", "strong", "code", "br", "p", "ul", "ol", "li",
];

fn reference_len(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let (start, max, ok): (usize, usize, fn(&u8) -> bool) =
        if s.starts_with("&#x") || s.starts_with("&#X") {
            (3, 6, u8::is_ascii_hexdigit)
        } else if s.starts_with("&#") {
            (2, 7, u8::is_ascii_digit)
        } else if b.get(1).is_some_and(u8::is_ascii_alphabetic) {
            (1, 32, u8::is_ascii_alphanumeric)
        } else {
            return None;
        };
    let n = b[start..].iter().take_while(|c| ok(c)).count();
    ((1..=max).contains(&n) && b.get(start + n) == Some(&b';')).then_some(start + n + 1)
}

fn check_html(html: &str, tags: &[&str]) -> Result<(), String> {
    if html.contains(['\0', '\r', '"', '\'']) {
        return Err(format!("a character left unescaped: {html:?}"));
    }
    let formatting = ["b", "i", "em", "strong", "code"];
    let mut open: Vec<&str> = Vec::new();
    let mut rest = html;
    while let Some(at) = rest.find(['<', '&', '>']) {
        rest = &rest[at..];
        if rest.starts_with('>') {
            return Err(format!("a `>` outside a tag: {html:?}"));
        }
        if rest.starts_with('&') {
            rest = &rest[reference_len(rest).ok_or_else(|| format!("a bare `&`: {html:?}"))?..];
            continue;
        }
        let end = rest
            .find('>')
            .ok_or_else(|| format!("an unended tag: {html:?}"))?;
        let (closing, name) = match rest[1..end].strip_prefix('/') {
            Some(name) => (true, name),
            None => (false, &rest[1..end]),
        };
        if !tags.contains(&name) {
            return Err(format!(
                "`<` before something other than an allowed tag: {html:?}"
            ));
        }
        if closing {
            if open.pop() != Some(name) {
                return Err(format!("`</{name}>` closes something else: {html:?}"));
            }
        } else if name != "br" {
            let parent = open.last().copied();
            let placed = match name {
                "p" | "ul" | "ol" => parent.is_none_or(|p| !formatting.contains(&p) && p != "p"),
                "li" => matches!(parent, Some("ul" | "ol")),
                _ => true,
            };
            if !placed {
                return Err(format!("`<{name}>` inside {parent:?}: {html:?}"));
            }
            open.push(name);
            if open.len() > 32 {
                return Err(format!("deeper than 32: {html:?}"));
            }
        }
        rest = &rest[end + 1..];
    }
    if open.is_empty() {
        Ok(())
    } else {
        Err(format!("left open: {open:?} in {html:?}"))
    }
}

proptest! {
    #[test]
    fn escaped_text_holds_no_markup_and_reads_back_whole(s in any::<String>()) {
        let mut out = String::new();
        escape_into(&mut out, &s);
        prop_assert!(!out.contains(['<', '>', '"', '\'']));
        prop_assert_eq!(unescape(&out), s);
    }

    #[test]
    fn escaping_appends_and_never_rewrites_the_buffer(prefix in any::<String>(), s in any::<String>()) {
        let mut out = prefix.clone();
        escape_into(&mut out, &s);
        prop_assert!(out.starts_with(&prefix));
    }

    #[test]
    fn js_trim_is_idempotent_and_a_substring(s in any::<String>()) {
        let t = js_trim(&s);
        prop_assert_eq!(js_trim(t), t);
        prop_assert!(s.contains(t));
    }

    #[test]
    fn js_length_is_the_utf16_encoding_length(s in any::<String>()) {
        prop_assert_eq!(js_length(&s), s.encode_utf16().count() as i64);
    }

    #[test]
    fn a_class_list_is_its_trimmed_non_empty_items_joined(items in proptest::collection::vec(any::<String>(), 0..6), after in any::<bool>()) {
        let refs: Vec<&str> = items.iter().map(String::as_str).collect();
        let mut out = String::new();
        class_into(&mut out, after, &refs);
        let kept: Vec<&str> = refs.iter().map(|s| js_trim(s)).filter(|s| !s.is_empty()).collect();
        let mut want = String::new();
        if after && !kept.is_empty() {
            want.push(' ');
        }
        escape_into(&mut want, &kept.join(" "));
        prop_assert_eq!(out, want);
    }

    #[test]
    fn the_state_script_is_one_element_whose_body_reads_back(key in any::<String>(), value in any::<String>()) {
        let state = serde_json::json!({ key: value });
        let mut out = String::new();
        state_script_into(&mut out, "__state", &state);
        let body = out
            .strip_prefix(r#"<script type="application/json" id="__state">"#)
            .and_then(|b| b.strip_suffix("</script>"));
        prop_assert!(body.is_some());
        let body = body.unwrap();
        let unsafe_chars = ['<', '>', '&', '\u{2028}', '\u{2029}'];
        prop_assert!(!body.contains(unsafe_chars));
        prop_assert_eq!(serde_json::from_str::<serde_json::Value>(body).unwrap(), state);
    }

    #[test]
    fn holes_split_a_render_into_one_more_piece_than_there_were_holes(texts in proptest::collection::vec("[^<]*", 1..6)) {
        let mut out = String::new();
        for (i, t) in texts.iter().enumerate() {
            if i > 0 {
                slot_into(&mut out, Some(hole()), None);
            }
            escape_into(&mut out, t);
        }
        prop_assert_eq!(split_holes(&out).len(), texts.len());
    }

    #[test]
    fn caller_supplied_slot_content_is_written_whole(s in any::<String>()) {
        let content = |out: &mut String| out.push_str(&s);
        let mut out = String::new();
        let filled = slot_into(&mut out, Some(Slot::new(&content)), Some(&mut |out: &mut String| out.push_str("fallback")));
        prop_assert!(filled);
        prop_assert_eq!(out, format!("<!--[-->{s}<!--]-->"));
    }

    #[test]
    fn basic_html_writes_only_its_tags_balanced_and_reads_back_as_itself(s in markup()) {
        let html = BasicHtml::new(&s);
        check_html(html.as_str(), &BASIC_TAGS).map_err(TestCaseError::fail)?;
        prop_assert_eq!(BasicHtml::new(html.as_str()), html.clone());
        let json = serde_json::to_string(&html).unwrap();
        prop_assert_eq!(serde_json::from_str::<BasicHtml>(&json).unwrap(), html);
    }

    #[test]
    fn basic_html_from_text_writes_paragraphs_and_reads_back_as_itself(s in markup()) {
        let html = BasicHtml::from_text(&s);
        check_html(html.as_str(), &BASIC_TAGS).map_err(TestCaseError::fail)?;
        prop_assert!(!html.as_str().contains('\n'));
        prop_assert_eq!(BasicHtml::new(html.as_str()), html);
    }

    #[test]
    fn inline_html_writes_only_inline_tags_balanced_and_reads_back_as_itself(s in markup()) {
        let html = InlineHtml::new(&s);
        check_html(html.as_str(), &InlineHtml::TAGS).map_err(TestCaseError::fail)?;
        prop_assert_eq!(InlineHtml::new(html.as_str()), html.clone());
        let json = serde_json::to_string(&html).unwrap();
        prop_assert_eq!(serde_json::from_str::<InlineHtml>(&json).unwrap(), html);
    }
}
