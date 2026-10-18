#![no_main]

use ferrovue_fuzz::{Value, reference_escape};
use libfuzzer_sys::{arbitrary, fuzz_target};

#[derive(Debug, arbitrary::Arbitrary)]
struct Input {
    id: String,
    state: Value,
}

fuzz_target!(|input: Input| {
    if input.state.depth() > 32 {
        return;
    }
    let mut out = String::from("<body>");
    ferrovue::state_script_into(&mut out, &input.id, &input.state);
    let open = format!(
        r#"<body><script type="application/json" id="{}">"#,
        reference_escape(&input.id)
    );
    let body = out
        .strip_prefix(&open)
        .and_then(|rest| rest.strip_suffix("</script>"))
        .expect("a state script around its JSON");
    assert!(
        !body.contains(['<', '>', '&', '\u{2028}', '\u{2029}']),
        "{body}"
    );
    let mut expected = String::new();
    for c in input.state.reference_json().chars() {
        match c {
            '<' => expected.push_str("\\u003c"),
            '>' => expected.push_str("\\u003e"),
            '&' => expected.push_str("\\u0026"),
            '\u{2028}' => expected.push_str("\\u2028"),
            '\u{2029}' => expected.push_str("\\u2029"),
            c => expected.push(c),
        }
    }
    assert_eq!(body, expected);
    if input.state.reads_back() {
        let parsed: serde_json::Value = serde_json::from_str(body).expect("the state is JSON");
        assert_eq!(
            parsed,
            serde_json::to_value(&input.state).expect("a value serde_json writes")
        );
    }
});
