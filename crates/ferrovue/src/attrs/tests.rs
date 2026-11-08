use super::*;
use crate::attrs::scope_attrs;

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

fn formatted<'a>(v: &'a Attr<'a>) -> Attr<'a> {
    match v {
        Attr::Str(s) => Attr::Fmt(s),
        Attr::Style(entries) => Attr::Style(
            entries
                .iter()
                .map(|(k, v)| (k.clone(), formatted(v)))
                .collect(),
        ),
        other => other.clone(),
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
        let lists: Vec<Vec<(&str, Attr<'_>)>> = lists
            .iter()
            .map(|l| l.iter().map(|(k, v)| (*k, formatted(v))).collect())
            .collect();
        let slices: Vec<&[(&str, Attr<'_>)]> = lists.iter().map(Vec::as_slice).collect();
        out.clear();
        attrs_into(&mut out, &slices, slices.len(), "");
        assert_eq!(&out, want, "formatted {sources:?}");
        assert_eq!(
            merge_props(&slices),
            merged,
            "formatted, merged {sources:?}"
        );
    }
}

#[test]
fn a_formatted_value_is_written_as_it_is_formatted() {
    let (tone, n, none, red) = ("a&'b'", 2, "", "red");
    let value = format(|f| write!(f, "{tone}-{n}"));
    let empty = format(|f| write!(f, "{none}{none}"));
    let attr = Attr::Fmt(&value);
    assert_eq!(attr, Attr::str("a&'b'-2"));
    assert_eq!(Attr::str("a&'b'-2"), attr);
    assert_ne!(attr, Attr::Fmt(&empty));
    assert_ne!(attr, Attr::Int(2));
    assert_eq!(format!("{attr:?}"), r#"Fmt("a&'b'-2")"#);
    assert_eq!(format!("{value:?}"), r#"Format("a&'b'-2")"#);
    assert!(attr.truthy() && !Attr::Fmt(&empty).truthy());
    let mut out = String::new();
    attrs_into(
        &mut out,
        &[&[
            ("title", attr.clone()),
            ("data-e", Attr::Fmt(&empty)),
            ("disabled", Attr::Fmt(&empty)),
            ("hidden", Attr::Fmt(&empty)),
            ("class", Attr::Fmt(&value)),
            ("style", Attr::Fmt(&format(|f| write!(f, "color: {red}")))),
        ]],
        1,
        "",
    );
    assert_eq!(
        out,
        r#" title="a&amp;&#39;b&#39;-2" data-e disabled hidden class="a&amp;&#39;b&#39;-2" style="color:red;""#
    );
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

mod class {
    use super::*;

    #[test]
    fn a_class_object_is_normalized_as_vue_normalizes_it() {
        let vectors: Vec<(Vec<(String, bool)>, String)> =
            serde_json::from_str(include_str!("../../tests/vectors/class.json"))
                .expect("class vectors");
        assert!(vectors.len() >= 10, "the vectors were not all read");
        for (entries, want) in &vectors {
            let entries: Vec<(bool, &str)> =
                entries.iter().map(|(n, on)| (*on, n.as_str())).collect();
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
}

#[cfg(feature = "router")]
mod links {
    use super::{link_named_open, link_open, link_path_open, link_to_open};
    use crate::router::{RouteDef, Router};

    fn open(
        location: &str,
        to: &str,
        names: (&str, &str),
        classes: &[&str],
        string: bool,
    ) -> String {
        let router = Router::tree(&[
            RouteDef::new("/"),
            RouteDef::new("/blog").with_children(&[RouteDef::new(":slug")]),
        ]);
        let route = router.at(location);
        let link = route.link(to);
        let mut out = String::new();
        link_open(&mut out, &link, "page", names.0, names.1, classes, string);
        let mut written = String::new();
        link_to_open(
            &mut written,
            &route,
            to,
            "page",
            names.0,
            names.1,
            classes,
            string,
        );
        assert_eq!(written, out, "a link to {to:?} written in place");
        out
    }

    const NAMES: (&str, &str) = ("near", "near here");

    #[test]
    fn an_exact_link_takes_aria_current_and_its_exact_names_before_its_own() {
        assert_eq!(
            open("/blog/intro", "/blog/intro", NAMES, &["tab", " "], false),
            r#"<a aria-current="page" href="/blog/intro" class="near here tab""#
        );
    }

    #[test]
    fn an_active_link_takes_its_active_names() {
        assert_eq!(
            open("/blog/intro", "/blog", NAMES, &["", "tab"], false),
            r#"<a href="/blog" class="near tab""#
        );
    }

    #[test]
    fn a_link_elsewhere_takes_its_own_classes_with_no_separator_before_them() {
        assert_eq!(
            open("/", "/blog/a?b=<c>", NAMES, &["tab"], false),
            r#"<a href="/blog/a?b=&lt;c&gt;" class="tab""#
        );
        assert_eq!(
            open("/", "/blog", NAMES, &[], false),
            r#"<a href="/blog" class="""#
        );
    }

    #[test]
    fn empty_active_names_leave_an_active_link_its_own_classes_alone() {
        assert_eq!(
            open("/blog/intro", "/blog/intro", ("", "here"), &[], false),
            r#"<a aria-current="page" href="/blog/intro" class="here""#
        );
        assert_eq!(
            open("/blog/intro", "/blog", ("", "here"), &[" tab "], true),
            r#"<a href="/blog" class="tab""#
        );
    }

    #[test]
    fn the_names_keep_their_inner_spaces() {
        assert_eq!(
            open(
                "/blog/intro",
                "/blog/intro",
                ("on", "on  here"),
                &[" a ", "b"],
                false
            ),
            r#"<a aria-current="page" href="/blog/intro" class="on  here a b""#
        );
    }

    #[test]
    fn an_own_class_equal_to_the_names_is_written_once() {
        assert_eq!(
            open(
                "/blog/intro",
                "/blog/intro",
                NAMES,
                &["near", "here"],
                false
            ),
            r#"<a aria-current="page" href="/blog/intro" class="near here""#
        );
        assert_eq!(
            open("/blog/intro", "/blog", NAMES, &["near"], true),
            r#"<a href="/blog" class="near""#
        );
        assert_eq!(
            open("/blog/intro", "/blog", NAMES, &[" near "], false),
            r#"<a href="/blog" class="near""#
        );
        assert_eq!(
            open("/blog/intro", "/blog", ("&lt;a", "&lt;a b"), &["<a"], true),
            r#"<a href="/blog" class="&lt;a""#
        );
    }

    #[test]
    fn an_own_string_with_spaces_around_it_is_written_after_equal_names() {
        assert_eq!(
            open("/blog/intro", "/blog", NAMES, &[" near "], true),
            r#"<a href="/blog" class="near near""#
        );
        assert_eq!(
            open("/blog/intro", "/blog/intro", NAMES, &["near here\t"], true),
            "<a aria-current=\"page\" href=\"/blog/intro\" class=\"near here near here\""
        );
    }

    #[test]
    fn an_own_class_that_only_starts_like_the_names_is_written_after_them() {
        assert_eq!(
            open("/blog/intro", "/blog", NAMES, &["near", "by"], false),
            r#"<a href="/blog" class="near near by""#
        );
        assert_eq!(
            open("/blog/intro", "/blog/intro", NAMES, &["near"], true),
            r#"<a aria-current="page" href="/blog/intro" class="near here near""#
        );
    }

    #[test]
    fn an_object_link_written_in_place_is_its_link_opened() {
        let router = Router::tree(&[
            RouteDef::new("/").with_name("home"),
            RouteDef::new("/blog")
                .with_name("blog")
                .with_children(&[RouteDef::new(":slug").with_name("post")]),
        ]);
        for at in ["/", "/blog", "/blog/a'b&c", "/blog/intro"] {
            let route = router.at(at);
            for (name, params) in [
                ("home", &[][..]),
                ("blog", &[][..]),
                ("post", &[("slug", "a'b&c")][..]),
                ("post", &[("slug", "intro")][..]),
            ] {
                for (search, hash) in [("", ""), ("q=%3C'&r", "#<'\"&>")] {
                    let mut out = String::new();
                    let link = route.link_named(name, params, search, hash);
                    link_open(&mut out, &link, "page", NAMES.0, NAMES.1, &["x"], false);
                    let mut written = String::new();
                    link_named_open(
                        &mut written,
                        &route,
                        name,
                        params,
                        search,
                        hash,
                        "page",
                        NAMES.0,
                        NAMES.1,
                        &["x"],
                        false,
                    );
                    assert_eq!(
                        written, out,
                        "at {at:?}, {name:?} {params:?} written in place"
                    );
                }
            }
            for path in ["/", "/blog", "/blog/a'b&c", "intro", "/blog/a\"<b>"] {
                let mut out = String::new();
                let link = route.link_path(path, "q=1&r", "#h'");
                link_open(&mut out, &link, "page", NAMES.0, NAMES.1, &[], false);
                let mut written = String::new();
                link_path_open(
                    &mut written,
                    &route,
                    path,
                    "q=1&r",
                    "#h'",
                    "page",
                    NAMES.0,
                    NAMES.1,
                    &[],
                    false,
                );
                assert_eq!(written, out, "at {at:?}, {path:?} written in place");
            }
        }
        let route = router.at("/blog/intro");
        let mut out = String::new();
        link_named_open(
            &mut out,
            &route,
            "post",
            &[("slug", "intro")],
            "",
            "",
            "page",
            NAMES.0,
            NAMES.1,
            &[],
            false,
        );
        assert_eq!(
            out,
            r#"<a aria-current="page" href="/blog/intro" class="near here""#
        );
    }
}

fn strip_comments_by_chars(css: &str) -> String {
    let chars: Vec<char> = css.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' {
            let mut j = i + 1;
            let mut closed = false;
            while j < chars.len() {
                if chars[j] == '\\' {
                    j += 2;
                    continue;
                }
                if chars[j] == c {
                    closed = true;
                    break;
                }
                j += 1;
            }
            if closed {
                out.extend(&chars[i..=j]);
                i = j + 1;
                continue;
            }
        } else if c == '\\' && i + 1 < chars.len() {
            out.push(c);
            out.push(chars[i + 1]);
            i += 2;
            continue;
        } else if c == '/' && chars.get(i + 1) == Some(&'*') {
            let rest: String = chars[i + 2..].iter().collect();
            if let Some(end) = rest.find("*/") {
                i += 2 + rest[..end].chars().count() + 2;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

#[test]
fn comments_are_stripped_as_a_scan_of_characters_strips_them() {
    let pieces = ["/", "*", "\"", "'", "\\", "a", "é", "🦀"];
    let mut texts = vec![String::new()];
    for _ in 0..6 {
        let longer: Vec<String> = texts
            .iter()
            .flat_map(|t| pieces.iter().map(move |p| format!("{t}{p}")))
            .collect();
        for text in &longer {
            assert_eq!(
                strip_comments(text),
                strip_comments_by_chars(text),
                "{text:?}"
            );
        }
        texts = longer;
    }
    for text in [
        "a: 1 /**/ b",
        "/*/ a */ b",
        "a /* 'b */ c' d",
        "a: \"x /* y\" /* z */ ; b: '\\'/* w */'",
        "\\/* a */ b",
        "a: 1 /* open /* open */ c /* open",
        "\"a\"/**/\"",
        "'x'/* y */'",
        "a \\",
    ] {
        assert_eq!(
            strip_comments(text),
            strip_comments_by_chars(text),
            "{text:?}"
        );
    }
    let many = "/* a".repeat(20_000);
    assert_eq!(strip_comments(&many), many);
}
