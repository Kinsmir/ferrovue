#![no_main]

use ferrovue_fuzz::{Value, reference_escape, unescape};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|value: Value| {
    if value.depth() > 32 {
        return;
    }
    let json = value.reference_json();
    let html = ferrovue::Html::island("Fuzz", &value, |out: &mut String, _: &Value| {
        out.push_str("<i></i>");
    })
    .into_string();
    let props = html
        .strip_prefix(r#"<div data-island="Fuzz" data-props=""#)
        .and_then(|rest| rest.strip_suffix(r#""><i></i></div>"#))
        .expect("an island's markup around its props");
    assert_eq!(props, reference_escape(&json));
    let read = unescape(props).expect("data-props holds escaped text alone");
    assert_eq!(read, json);
    if value.reads_back() {
        let parsed: serde_json::Value = serde_json::from_str(&read).expect("data-props is JSON");
        assert_eq!(
            parsed,
            serde_json::to_value(&value).expect("a value serde_json writes")
        );
    }
});
