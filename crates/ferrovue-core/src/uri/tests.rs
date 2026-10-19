use super::*;

#[test]
fn uris_are_encoded_as_javascript_encodes_them() {
    let vectors: Vec<(String, String, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/uri.json")).expect("uri vectors");
    assert!(vectors.len() >= 1000, "the vectors were not all read");
    for (op, input, want) in &vectors {
        let got = match op.as_str() {
            "encodeURIComponent" => js_encode_uri_component(input),
            "encodeURI" => js_encode_uri(input),
            other => panic!("unknown op {other}"),
        };
        assert_eq!(&got, want, "{op}({input:?})");
    }
}

#[test]
fn every_byte_of_a_character_is_written_in_upper_case() {
    let mut out = String::from("x");
    percent_encode_into(&mut out, '\u{10FFFF}');
    assert_eq!(out, "x%F4%8F%BF%BF");
}
