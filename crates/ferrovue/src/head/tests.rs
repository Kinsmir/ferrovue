use super::*;

use serde_json::Value;

fn decoded(v: &Value) -> HeadValue {
    match v {
        Value::Null => HeadValue::Null,
        Value::Bool(b) => HeadValue::Bool(*b),
        Value::Number(n) => HeadValue::Number(n.as_f64().expect("a number")),
        Value::String(s) => HeadValue::Str(s.clone()),
        Value::Array(items) => HeadValue::Array(items.iter().map(decoded).collect()),
        Value::Object(o) => {
            if o.contains_key("$u") {
                return HeadValue::Undefined;
            }
            if let Some(Value::String(n)) = o.get("$n") {
                return HeadValue::Number(match n.as_str() {
                    "NaN" => f64::NAN,
                    "Infinity" => f64::INFINITY,
                    "-Infinity" => f64::NEG_INFINITY,
                    "-0" => -0.0,
                    other => panic!("no number {other}"),
                });
            }
            let Some(Value::Array(pairs)) = o.get("$o") else {
                panic!("not an encoded value: {v}");
            };
            HeadValue::Object(
                pairs
                    .iter()
                    .map(|p| {
                        let key = p[0].as_str().expect("a key").to_owned();
                        (Cow::Owned(key), decoded(&p[1]))
                    })
                    .collect(),
            )
        }
    }
}

fn leaked(v: &Value) -> &'static str {
    Box::leak(v.as_str().expect("a string").to_owned().into_boxed_str())
}

#[test]
fn renders_every_head_as_unhead_rendered_it() {
    let vectors: Vec<Value> =
        serde_json::from_str(include_str!("../../tests/vectors/head.json")).expect("head vectors");
    assert!(vectors.len() >= 400, "the vectors were not all read");
    let mut failures = Vec::new();
    for (i, vector) in vectors.iter().enumerate() {
        let head = if vector["defaults"].as_bool().expect("defaults") {
            Head::new()
        } else {
            Head::without_defaults()
        };
        for call in vector["calls"].as_array().expect("calls") {
            if let Some(input) = call.get("head") {
                head.push(decoded(input));
            } else {
                let seo = &call["seo"];
                let meta = seo[1]
                    .as_array()
                    .expect("meta")
                    .iter()
                    .map(|m| (leaked(&m[0]), leaked(&m[1]), decoded(&m[2])))
                    .collect();
                head.push_seo_meta(decoded(&seo[0]), meta);
            }
        }
        let html = head.render();
        let want = &vector["expected"];
        let got = [
            ("headTags", &html.head_tags),
            ("bodyTags", &html.body_tags),
            ("bodyTagsOpen", &html.body_tags_open),
            ("htmlAttrs", &html.html_attrs),
            ("bodyAttrs", &html.body_attrs),
        ];
        for (field, value) in got {
            if want[field].as_str() != Some(value.as_str()) {
                failures.push(format!(
                    "vector {i}, {field}:\n  unhead: {}\n  ours:   {value:?}\n  calls: {}",
                    want[field], vector["calls"]
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} fields differ:\n{}",
        failures.len(),
        vectors.len() * 5,
        failures[..failures.len().min(8)].join("\n")
    );
}

#[test]
fn orders_object_keys_as_javascript_does() {
    let HeadValue::Object(entries) = HeadValue::object([
        ("b", HeadValue::Null),
        ("10", HeadValue::Null),
        ("a", HeadValue::Null),
        ("2", HeadValue::Null),
        ("b", HeadValue::Bool(true)),
    ]) else {
        unreachable!()
    };
    let keys: Vec<&str> = entries.iter().map(|(k, _)| k.as_ref()).collect();
    assert_eq!(keys, ["2", "10", "b", "a"]);
    assert_eq!(entries[2].1, HeadValue::Bool(true));
}

#[test]
fn writes_nothing_for_an_input_that_is_not_an_object() {
    let head = Head::without_defaults();
    head.push(HeadValue::str("title"));
    head.push(HeadValue::Null);
    assert_eq!(head.render(), HeadHtml::default());
}

#[test]
fn places_an_array_index_after_the_smaller_ones() {
    let HeadValue::Object(entries) = HeadValue::object([
        ("1", HeadValue::Null),
        ("5", HeadValue::Null),
        ("x", HeadValue::Null),
        ("3", HeadValue::Null),
        ("7", HeadValue::Null),
    ]) else {
        unreachable!()
    };
    let keys: Vec<&str> = entries.iter().map(|(k, _)| k.as_ref()).collect();
    assert_eq!(keys, ["1", "3", "5", "7", "x"]);
}

#[test]
fn converts_rust_values_to_the_javascript_values_they_are() {
    assert_eq!(HeadValue::float(1.5), HeadValue::Number(1.5));
    assert_eq!(HeadValue::from("a"), HeadValue::Str("a".to_owned()));
    assert_eq!(
        HeadValue::from(String::from("b")),
        HeadValue::Str("b".to_owned())
    );
    assert_eq!(
        HeadValue::from(Cow::Borrowed("c")),
        HeadValue::Str("c".to_owned())
    );
    assert_eq!(HeadValue::from(false), HeadValue::Bool(false));
    assert_eq!(HeadValue::from(-3_i64), HeadValue::Number(-3.0));
    assert_eq!(HeadValue::from(0.25), HeadValue::Number(0.25));
    assert_eq!(HeadValue::from(Some(true)), HeadValue::Bool(true));
    assert_eq!(HeadValue::from(None::<bool>), HeadValue::Undefined);
}
