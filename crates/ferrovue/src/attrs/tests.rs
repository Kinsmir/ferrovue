use super::*;
use crate::scope_attrs;

fn vector_attr(v: &serde_json::Value) -> Attr<'static> {
    use serde_json::Value;
    match v {
        Value::Null => Attr::Undefined,
        Value::Bool(b) => Attr::Bool(*b),
        Value::String(s) => Attr::from(s.clone()),
        Value::Number(n) => n
            .as_i64()
            .map_or_else(|| Attr::Float(n.as_f64().expect("a number")), Attr::Int),
        Value::Object(o) if o.contains_key("names") => {
            Attr::Names(o["names"].as_str().expect("names").to_owned().into())
        }
        Value::Object(o) => Attr::Style(
            o["style"]
                .as_array()
                .expect("a style")
                .iter()
                .map(|e| {
                    (
                        e[0].as_str().expect("a key").to_owned().into(),
                        vector_attr(&e[1]),
                    )
                })
                .collect(),
        ),
        Value::Array(_) => panic!("no attribute value is an array"),
    }
}

#[test]
fn attributes_merge_and_render_as_vue_merges_and_renders_them() {
    type Source = Vec<(String, serde_json::Value)>;
    let vectors: Vec<(Vec<Source>, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/attrs.json"))
            .expect("attrs vectors");
    assert!(vectors.len() >= 40, "the vectors were not all read");
    for (sources, want) in &vectors {
        let lists: Vec<Vec<(&str, Attr<'_>)>> = sources
            .iter()
            .map(|s| {
                s.iter()
                    .map(|(k, v)| (k.as_str(), vector_attr(v)))
                    .collect()
            })
            .collect();
        let slices: Vec<&[(&str, Attr<'_>)]> = lists.iter().map(Vec::as_slice).collect();
        let mut out = String::new();
        attrs_into(&mut out, &slices, slices.len(), "");
        assert_eq!(&out, want, "{sources:?}");
        let merged = merge_props(&slices);
        out.clear();
        attrs_into(&mut out, &[&merged], 0, "");
        assert_eq!(&out, want, "merged {sources:?}");
    }
}

#[test]
fn scope_ids_follow_the_attributes_of_the_sources_before_them() {
    let mut out = String::new();
    let own = [("class", Attr::str("a")), ("id", Attr::str("x"))];
    let passed = [("title", Attr::str("t")), ("id", Attr::Undefined)];
    let after = [("style", Attr::style([("display", Attr::str("none"))]))];
    attrs_into(&mut out, &[&own, &passed, &after], 1, " data-v-1");
    assert_eq!(
        out,
        r#" class="a" title="t" data-v-1 style="display:none;""#
    );
    out.clear();
    attrs_into(&mut out, &[&own, &passed, &after], 0, " data-v-1");
    assert_eq!(
        out,
        r#" class="a" data-v-1 title="t" style="display:none;""#
    );
}

#[test]
fn attrs_hold_what_a_parent_passes_and_the_scope_ids() {
    assert!(Attrs::NONE.is_empty());
    assert_eq!(Attrs::default().ids(), "");
    let passed = [("class", Attr::str(" b ")), ("title", Attr::Int(2))];
    let attrs = Attrs::new(&passed, " data-v-1");
    assert!(!attrs.is_empty());
    assert_eq!(attrs.ids(), " data-v-1");
    assert_eq!(attrs.list(), &passed);
    assert!(Attrs::scoped(" data-v-2").is_empty());
    let own = [("class", Attr::str("a"))];
    let merged = Attrs::merged(&[&own, attrs.list()], attrs.ids());
    assert_eq!(
        merged.list(),
        [("class", Attr::str("a b")), ("title", Attr::Int(2))]
    );
    assert_eq!(merged.ids(), " data-v-1");
}

#[test]
fn values_convert_into_attributes() {
    assert_eq!(Attr::from("x"), Attr::str("x"));
    assert_eq!(Attr::from(String::from("x")), Attr::str("x"));
    assert_eq!(Attr::from(true), Attr::Bool(true));
    assert_eq!(Attr::from(3_i64), Attr::Int(3));
    assert_eq!(Attr::from(0.5), Attr::Float(0.5));
    assert_eq!(Attr::from(None::<&str>), Attr::Undefined);
    assert_eq!(Attr::from(Some(4_i64)), Attr::Int(4));
    let mut out = String::new();
    attrs_into(
        &mut out,
        &[&[("class", Attr::Int(1))], &[("class", Attr::Float(1.0))]],
        1,
        "",
    );
    assert_eq!(out, r#" class="""#);
    out.clear();
    attrs_into(
        &mut out,
        &[
            &[("class", Attr::Float(f64::NAN))],
            &[("class", Attr::Float(f64::NAN))],
        ],
        1,
        "",
    );
    assert_eq!(out, r#" class="""#);
    out.clear();
    attrs_into(
        &mut out,
        &[&[
            ("data-x", Attr::Float(f64::NAN)),
            ("hidden", Attr::Float(f64::NAN)),
        ]],
        0,
        "",
    );
    assert_eq!(out, r#" data-x="NaN""#);
    out.clear();
    attrs_into(
        &mut out,
        &[&[
            ("disabled", Attr::Float(0.0)),
            ("checked", Attr::Float(-0.5)),
        ]],
        0,
        "",
    );
    assert_eq!(out, " checked");
}

#[test]
fn styles_merge_arrays_and_parse_text() {
    let style = Attr::styles([
        Attr::style([("color", Attr::str("red")), ("top", Attr::Int(1))]),
        Attr::Undefined,
        Attr::str("color: blue; 3: x"),
    ]);
    assert_eq!(
        style,
        Attr::Style(vec![
            ("3".into(), Attr::str("x")),
            ("color".into(), Attr::str("blue")),
            ("top".into(), Attr::Int(1)),
        ])
    );
    let mut out = String::new();
    style_text_into(&mut out, "a: \"/*\" ; b: 1 /* gone */; c: \\/* d");
    assert_eq!(out, "a:&quot;/*&quot;;b:1;c:\\/* d;");
    out.clear();
    style_text_into(&mut out, "a: 'x; b: y");
    assert_eq!(out, "a:&#39;x;b:y;");
    out.clear();
    style_text_into(&mut out, "a: 1 /* open");
    assert_eq!(out, "a:1 /* open;");
    assert_eq!(class_names(&["", "  ", " a", "b "]), "a b");
}

#[test]
fn scope_attrs_are_keys_of_an_object_in_the_order_first_given() {
    assert_eq!(scope_attrs("", "", ""), "");
    assert_eq!(scope_attrs(" data-v-a", "data-v-a", ""), " data-v-a");
    assert_eq!(
        scope_attrs(" data-v-a data-v-b", "data-v-c", " data-v-b data-v-d-s"),
        " data-v-a data-v-b data-v-c data-v-d-s"
    );
    assert_eq!(
        scope_attrs("", "data-v-a", "  data-v-b-s  data-v-c-s"),
        " data-v-a data-v-b-s data-v-c-s"
    );
}
