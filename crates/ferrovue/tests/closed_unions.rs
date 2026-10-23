//! Components that read props typed as closed unions only through lookup tables and
//! `<component :is>`. A union of string literals is a Rust enum, so a value outside it cannot be
//! built: every `match` over it is exhaustive, and props that hold one outside it do not
//! deserialise. An integer union stays an `i64`, and a value outside it renders as the union's last
//! member, as the `props` guide says.

#[rustfmt::skip]
#[path = "closed_unions/generated/mod.rs"]
#[allow(missing_docs)]
pub mod generated;

use generated::{lookups, picked, types};
use serde_json::{Map, Value, json};

fn render(component: &str, props: &Value) -> Result<String, String> {
    generated::render_json(component, &props.to_string())
}

fn lookups_props(k: &str, m: Option<&str>, tone: &str, level: i64) -> Value {
    let mut props = Map::new();
    props.insert("k".into(), json!(k));
    if let Some(m) = m {
        props.insert("m".into(), json!(m));
    }
    props.insert("tone".into(), json!(tone));
    props.insert("level".into(), json!(level));
    Value::Object(props)
}

const OUTSIDE: [&str; 7] = ["", "z", "A", "C", "toString", "__proto__", "<b>&amp;"];

#[test]
fn an_integer_union_reads_a_key_outside_it_as_the_last_member() {
    for k in lookups::K::ALL {
        for m in [None, Some("a"), Some("c")] {
            for tone in types::Tone::ALL {
                let at_last =
                    render("Lookups", &lookups_props(k.as_str(), m, tone.as_str(), 3)).unwrap();
                for level in [0, -1, 4, i64::MAX] {
                    assert_eq!(
                        render(
                            "Lookups",
                            &lookups_props(k.as_str(), m, tone.as_str(), level)
                        )
                        .unwrap(),
                        at_last,
                        "`level` = {level} renders as its last member 3"
                    );
                }
            }
        }
    }
}

#[test]
fn props_with_a_string_outside_a_union_do_not_deserialise() {
    for value in OUTSIDE {
        for (component, props, members) in [
            (
                "Lookups",
                lookups_props(value, None, "info", 1),
                "`a`, `b`, `c`",
            ),
            (
                "Lookups",
                lookups_props("a", Some(value), "info", 1),
                "`a`, `b`, `c`",
            ),
            (
                "Lookups",
                lookups_props("a", None, value, 1),
                "`info`, `warn`, `calm`",
            ),
            ("Picked", json!({ "k": value, "tag": "b" }), "`a`, `b`, `c`"),
            ("Picked", json!({ "k": "a", "tag": value }), "`b`, `i`, `u`"),
        ] {
            let e = render(component, &props).unwrap_err();
            assert!(
                e.contains(&format!(
                    "unknown variant `{value}`, expected one of {members}"
                )),
                "{component} {props}: {e}"
            );
        }
    }
}

#[test]
fn a_string_outside_a_union_does_not_parse() {
    for value in OUTSIDE {
        let e = value.parse::<lookups::K>().unwrap_err();
        assert_eq!(e.value(), value);
        assert_eq!(e.members(), ["a", "b", "c"]);
        assert_eq!(
            e.to_string(),
            format!("`{value}` is not one of the members of `K`: `a`, `b`, `c`")
        );
        let tag = picked::PickedTag::try_from(value).unwrap_err();
        assert_eq!(
            (tag.union(), tag.members()),
            ("PickedTag", &["b", "i", "u"][..])
        );
    }
    for k in lookups::K::ALL {
        assert_eq!(k.as_str().parse::<lookups::K>(), Ok(k));
        assert_eq!(k.to_string(), k.as_str());
    }
}

#[test]
fn every_member_renders_and_changes_what_renders() {
    let renders: std::collections::HashSet<String> = lookups::K::ALL
        .iter()
        .map(|k| render("Lookups", &lookups_props(k.as_str(), None, "info", 1)).unwrap())
        .collect();
    assert_eq!(renders.len(), 3);
    let tags: std::collections::HashSet<String> = picked::PickedTag::ALL
        .iter()
        .map(|tag| render("Picked", &json!({ "k": "a", "tag": tag })).unwrap())
        .collect();
    assert_eq!(tags.len(), 3);
}

fn matches_over_enums(source: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut rest = source;
    while let Some(at) = rest.find("match props.") {
        let tail = &rest[at..];
        let open = tail.find('{').unwrap();
        let subject = &tail["match ".len()..open];
        let mut depth = 0;
        let mut end = open;
        for (i, c) in tail[open..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = open + i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        if !subject.contains("level") && !subject.contains("as_str") {
            found.push(&tail[..end]);
        }
        rest = &tail[end..];
    }
    found
}

#[test]
fn a_match_over_an_enum_has_no_catch_all_arm() {
    for source in [
        include_str!("closed_unions/generated/lookups.rs"),
        include_str!("closed_unions/generated/picked.rs"),
    ] {
        let render = &source[source.find("pub fn render").unwrap()..];
        let matches = matches_over_enums(render);
        assert!(matches.len() >= 3, "{matches:?}");
        for m in matches {
            assert!(!m.contains("_ =>"), "{m}");
        }
        assert!(
            !render.contains("as_str() {"),
            "a `match` over an enum's string"
        );
    }
}
