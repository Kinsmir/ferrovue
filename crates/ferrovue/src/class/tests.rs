use super::*;

/// `tests/vectors/class.json`, recorded from Vue's `normalizeClass` of the object the entries make.
#[test]
fn a_class_object_is_normalized_as_vue_normalizes_it() {
    let vectors: Vec<(Vec<(String, bool)>, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/class.json"))
            .expect("class vectors");
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
