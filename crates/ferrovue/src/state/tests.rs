use super::*;

#[test]
fn the_state_scripts_numbers_that_are_not_finite_are_written_as_javascript_writes_them() {
    let mut out = String::new();
    state_script_into(&mut out, "s", &[f64::NAN, f64::INFINITY, 1.0]);
    assert_eq!(
        out,
        r#"<script type="application/json" id="s">[NaN,Infinity,1.0]</script>"#
    );
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
