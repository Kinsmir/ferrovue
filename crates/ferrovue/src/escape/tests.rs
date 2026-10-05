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

/// `tests/vectors/escape.json`, held to `@vue/shared`'s `escapeHtml` on the TypeScript side.
#[test]
fn escape_is_vues_escape_html() {
    let vectors: Vec<(String, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/escape.json"))
            .expect("escape vectors");
    for (input, want) in &vectors {
        let mut out = String::new();
        escape_into(&mut out, input);
        assert_eq!(&out, want, "escape({input:?})");
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

proptest::proptest! {
    #![proptest_config(proptest::prelude::ProptestConfig::with_cases(20_000))]

    /// Text around and between the five characters, at every length the word-at-a-time scan reads
    /// differently: shorter than a word, whole words, and a tail that overlaps them.
    #[test]
    fn escaping_is_the_bytewise_reference(s in "[a\"&'<>é🦀 ]{0,40}") {
        let mut out = String::new();
        escape_into(&mut out, &s);
        proptest::prop_assert_eq!(out, escape_bytewise(&s));
    }
}
