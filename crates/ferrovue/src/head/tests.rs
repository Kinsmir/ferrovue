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

#[test]
fn entries_pushed_while_deferred_come_after_the_others_level_by_level() {
    let head = Head::without_defaults();
    let meta = |name: &str| {
        HeadValue::object([(
            "meta",
            HeadValue::array([HeadValue::object([
                ("name", HeadValue::str(name)),
                ("content", HeadValue::str(name)),
            ])]),
        )])
    };
    head.push(meta("a"));
    {
        let _later = head.deferred();
        head.push(meta("c"));
        {
            let _later = head.deferred();
            head.push(meta("e"));
        }
        head.push(meta("d"));
    }
    head.push(meta("b"));
    let tags = head.render().head_tags;
    let names: Vec<&str> = tags.lines().map(|l| &l[12..13]).collect();
    assert_eq!(names, ["a", "b", "c", "d", "e"]);
}

#[test]
fn no_head_value_writes_the_hole_marker() {
    let s = HeadValue::str;
    for value in [
        "<fv-hole>",
        crate::page::HOLE,
        &crate::page::HOLE.to_uppercase(),
    ] {
        let head = Head::without_defaults();
        head.push(HeadValue::object([
            ("title", s(value)),
            (
                "htmlAttrs",
                HeadValue::object([("class", s(value)), ("data-x", s(value))]),
            ),
            (
                "bodyAttrs",
                HeadValue::object([("style", HeadValue::object([("color", s(value))]))]),
            ),
            (
                "meta",
                HeadValue::array([HeadValue::object([
                    ("name", s("description")),
                    ("content", s(value)),
                ])]),
            ),
            (
                "link",
                HeadValue::array([HeadValue::object([
                    ("rel", s("canonical")),
                    ("href", s(value)),
                ])]),
            ),
            (
                "script",
                HeadValue::array([
                    HeadValue::object([("innerHTML", s(value)), ("key", s("a"))]),
                    HeadValue::object([("textContent", s(value)), ("key", s("b"))]),
                    HeadValue::object([
                        ("type", s("application/ld+json")),
                        ("innerHTML", HeadValue::object([("name", s(value))])),
                    ]),
                ]),
            ),
            ("style", HeadValue::array([s(value)])),
            ("noscript", HeadValue::array([s(value)])),
        ]));
        let html = head.render();
        for part in [
            &html.head_tags,
            &html.body_tags,
            &html.body_tags_open,
            &html.html_attrs,
            &html.body_attrs,
        ] {
            assert!(!part.contains(crate::page::HOLE), "{part}");
        }
        assert_eq!(html.head_tags.lines().count(), 8, "{}", html.head_tags);
    }
}

#[test]
fn long_class_and_style_lists_keep_each_name_once_in_first_seen_order() {
    let attrs = |key: &'static str, value: HeadValue| {
        HeadValue::object([("bodyAttrs", HeadValue::object([(key, value)]))])
    };
    let tokens: Vec<String> = (0..3000).map(|i| format!("c{}", (i * 7) % 700)).collect();
    let mut first_seen: Vec<&str> = Vec::new();
    for t in &tokens {
        if !first_seen.contains(&t.as_str()) {
            first_seen.push(t);
        }
    }
    let classes = format!(" class=\"{}\"", first_seen.join(" "));
    let head = Head::new();
    head.push(attrs("class", HeadValue::str(&tokens.join(" "))));
    assert_eq!(head.render().body_attrs, classes);
    let head = Head::new();
    head.push(attrs(
        "class",
        HeadValue::array(tokens.iter().map(|t| HeadValue::str(t))),
    ));
    assert_eq!(head.render().body_attrs, classes);
    let head = Head::new();
    let (front, back) = tokens.split_at(1700);
    head.push(attrs("class", HeadValue::str(&front.join(" "))));
    head.push(attrs("class", HeadValue::str(&back.join(" "))));
    assert_eq!(head.render().body_attrs, classes);

    let declarations: Vec<(String, String)> = (0..3000)
        .map(|i| (format!("p{}", (i * 7) % 700), format!("v{i}")))
        .collect();
    let mut kept: Vec<(&str, &str)> = Vec::new();
    for (k, v) in &declarations {
        match kept.iter_mut().find(|(kk, _)| kk == k) {
            Some(slot) => slot.1 = v,
            None => kept.push((k, v)),
        }
    }
    let written: Vec<String> = kept.iter().map(|(k, v)| format!("{k}:{v}")).collect();
    let styles = format!(" style=\"{}\"", written.join(";"));
    let text = |d: &[(String, String)]| {
        d.iter()
            .map(|(k, v)| format!("{k}: {v}"))
            .collect::<Vec<_>>()
            .join(";")
    };
    let head = Head::new();
    head.push(attrs("style", HeadValue::str(&text(&declarations))));
    assert_eq!(head.render().body_attrs, styles);
    let (front, back) = declarations.split_at(1700);
    let head = Head::new();
    head.push(attrs("style", HeadValue::str(&text(front))));
    head.push(attrs("style", HeadValue::str(&text(back))));
    assert_eq!(head.render().body_attrs, styles);
}

#[test]
fn a_list_is_indexed_once_it_holds_sixteen_names() {
    use super::tag::{Places, add_class};

    let names: Vec<String> = (0..18).map(|i| format!("c{i}")).collect();
    let mut classes = Vec::new();
    let mut places = Places::default();
    for (i, name) in names.iter().enumerate() {
        add_class(&mut classes, &mut places, name);
        assert_eq!(
            places.indexed(),
            (i >= 16).then_some(i),
            "after {} names",
            i + 1
        );
    }
    add_class(&mut classes, &mut places, "c3");
    assert_eq!(classes, names);
}
