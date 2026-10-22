//! Components that read props typed as closed unions only through lookup tables and
//! `<component :is>`, rendered with values outside each union: such a value renders as the union's
//! last member, as the `props` guide says.

#[rustfmt::skip]
#[path = "closed_unions/generated/mod.rs"]
#[allow(missing_docs)]
pub mod generated;

use serde_json::{Map, Value, json};

struct Union {
    prop: &'static str,
    members: Vec<Value>,
    optional: bool,
}

fn strings(prop: &'static str, members: &[&str], optional: bool) -> Union {
    Union {
        prop,
        members: members.iter().map(|m| json!(m)).collect(),
        optional,
    }
}

fn integers(prop: &'static str, members: &[i64]) -> Union {
    Union {
        prop,
        members: members.iter().map(|m| json!(m)).collect(),
        optional: false,
    }
}

fn outside(member: &Value) -> Vec<Value> {
    if member.is_number() {
        vec![json!(0), json!(-1), json!(4), json!(i64::MAX)]
    } else {
        ["", "z", "A", "C", "toString", "__proto__", "<b>&amp;"]
            .iter()
            .map(|v| json!(v))
            .collect()
    }
}

fn render(component: &str, props: &Map<String, Value>) -> String {
    generated::render_json(component, &Value::Object(props.clone()).to_string())
        .unwrap_or_else(|e| panic!("{component} {props:?}: {e}"))
}

fn every_base(unions: &[Union]) -> Vec<Map<String, Value>> {
    let mut bases = vec![Map::new()];
    for union in unions {
        let mut choices: Vec<Option<&Value>> = union.members.iter().map(Some).collect();
        if union.optional {
            choices.push(None);
        }
        bases = bases
            .into_iter()
            .flat_map(|base| {
                choices.iter().map(move |choice| {
                    let mut next = base.clone();
                    if let Some(value) = choice {
                        next.insert(union.prop.to_owned(), (*value).clone());
                    }
                    next
                })
            })
            .collect();
    }
    bases
}

fn check(component: &str, unions: &[Union]) {
    for base in every_base(unions) {
        for union in unions {
            let last = union.members.last().unwrap();
            let mut at_last = base.clone();
            at_last.insert(union.prop.to_owned(), last.clone());
            let expected = render(component, &at_last);
            for value in outside(last) {
                let mut beyond = base.clone();
                beyond.insert(union.prop.to_owned(), value.clone());
                assert_eq!(
                    render(component, &beyond),
                    expected,
                    "{component}: `{}` = {value} renders as its last member {last}, with {base:?}",
                    union.prop
                );
            }
        }
    }
    let first = every_base(unions).into_iter().next().unwrap();
    for union in unions {
        let renders: std::collections::HashSet<String> = union
            .members
            .iter()
            .map(|member| {
                let mut props = first.clone();
                props.insert(union.prop.to_owned(), member.clone());
                render(component, &props)
            })
            .collect();
        assert!(
            renders.len() > 1,
            "{component}: `{}` changes what renders",
            union.prop
        );
    }
}

#[test]
fn a_lookup_table_reads_a_key_outside_its_union_as_the_last_member() {
    check(
        "Lookups",
        &[
            strings("k", &["a", "b", "c"], false),
            strings("m", &["a", "b", "c"], true),
            strings("tone", &["info", "warn", "calm"], false),
            integers("level", &[1, 2, 3]),
        ],
    );
}

#[test]
fn component_is_renders_a_choice_outside_its_union_as_the_last_member() {
    check(
        "Picked",
        &[
            strings("k", &["a", "b", "c"], false),
            strings("tag", &["b", "i", "u"], false),
        ],
    );
}
