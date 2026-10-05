//! Properties of the runtime that hold for every input, checked on generated ones: the fixtures and
//! vectors pin exact bytes for chosen cases, these look for the case nobody thought to choose.

use ferrovue::{
    Slot, class_into, escape_into, hole, js_length, js_trim, slot_into, split_holes,
    state_script_into,
};
use proptest::prelude::*;

/// What a browser makes of escaped text: the five entities `escape_into` writes, undone.
fn unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
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
}
