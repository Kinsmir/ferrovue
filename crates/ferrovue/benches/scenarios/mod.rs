//! The scenarios both benchmarks measure: the conformance suite's generated renderers on the props
//! `packages/ferrovue/bench/ssr.bench.ts` gives Vue's `renderToString`, and the runtime's own paths
//! those barely reach. Each is checked against its expected output before it is measured.

use std::hint::black_box;

use ferrovue::{Attr, Head, HeadValue};

use crate::generated::{dashboard, lists, nav, panel, tree};

pub fn small_props() -> nav::Props<'static> {
    nav::Props::new("/users/me", "Me & you").note("3 new")
}

pub const SMALL_ROUTE: &str = "/users/me";

pub fn list_props() -> lists::Props<'static> {
    let words = (0..1000).map(|i| {
        if i % 10 == 0 {
            format!("<word {i}>")
        } else {
            format!("word {i}")
        }
    });
    let numbers = (0..1000).map(|i| i * 7).collect();
    let groups = (0..100)
        .map(|i| {
            let group = lists::Group::new(
                format!("group {i}"),
                (0..10).map(|j| format!("member {i}.{j}")),
            );
            if i % 2 == 0 {
                group.lead(format!("lead {i}"))
            } else {
                group
            }
        })
        .collect();
    lists::Props::new(words, numbers, groups)
}

pub fn tree_props() -> tree::Props<'static> {
    fn node(label: String, depth: u32) -> tree::Props<'static> {
        let children = if depth < 8 {
            (0..2)
                .map(|i| node(format!("{label}.{i}"), depth + 1))
                .collect()
        } else {
            Vec::new()
        };
        tree::Props::new(label, children)
    }
    node("n".to_owned(), 1)
}

pub fn page_props() -> dashboard::Props<'static> {
    let panels = (0..20)
        .map(|i| {
            let p = panel::Props::new(format!("Panel {i}"));
            if i % 2 == 0 { p.count(i) } else { p }
        })
        .collect();
    let words = (0..10).map(|i| format!("tag {i}"));
    dashboard::Props::new("Dashboard <beta>", panels, words, 42).footer("Updated & synced")
}

const EXPECTED: [(&str, &str); 4] = [
    ("small", include_str!("../expected/small.html")),
    ("list", include_str!("../expected/list.html")),
    ("tree", include_str!("../expected/tree.html")),
    ("page", include_str!("../expected/page.html")),
];

fn expected(scenario: &str) -> &'static str {
    EXPECTED.iter().find(|(s, _)| *s == scenario).unwrap().1
}

pub fn check(scenario: &str, render: impl Fn(&mut String)) {
    let mut out = String::new();
    render(&mut out);
    assert!(
        out == expected(scenario),
        "{scenario}: the generated renderer's output differs from Vue's (benches/expected/{scenario}.html)"
    );
}

/// Attributes merged from an element, a parent's fallthrough and a bound style object, as a root that
/// takes `$attrs` writes them.
pub fn merged_attrs(out: &mut String) {
    ferrovue::attrs_into(
        out,
        &[
            &[("id", Attr::str("own")), ("class", Attr::str("card"))],
            &[
                ("title", Attr::str("<t>")),
                ("data-k", Attr::str("v")),
                ("ariaLabel", Attr::str("x")),
                ("class", Attr::str("big")),
            ],
            &[(
                "style",
                Attr::style([("display", Attr::str("none")), ("fontSize", Attr::Int(12))]),
            )],
        ],
        1,
        " data-v-1",
    );
}

/// Fractions, which JavaScript writes with the fewest digits that read back the same.
pub fn fractions(out: &mut String) {
    for x in [0.1, 2.5, 1234.5678, 0.30000000000000004, 1e-7, 19.99] {
        ferrovue::push_number(out, black_box(x));
        out.push(' ');
    }
}

/// A head with a title, a meta tag, inline JSON-LD and attributes on `<html>`.
pub fn head() -> Head {
    let head = Head::new();
    head.push(HeadValue::object([
        ("title", HeadValue::str("Dune \"2\"")),
        (
            "meta",
            HeadValue::array([HeadValue::object([
                ("name", HeadValue::str("description")),
                ("content", HeadValue::str("A \"desert\" planet")),
            ])]),
        ),
        (
            "script",
            HeadValue::array([HeadValue::object([
                ("type", HeadValue::str("application/ld+json")),
                ("innerHTML", HeadValue::str("{\"a\":\"</script>\"}")),
            ])]),
        ),
        (
            "htmlAttrs",
            HeadValue::object([
                ("class", HeadValue::str("a b")),
                ("lang", HeadValue::str("en")),
            ]),
        ),
    ]));
    head
}

/// The runtime's paths, each checked against what it wrote when it was last made faster, so a
/// change to its output fails here as well as in the vectors.
pub fn check_runtime() {
    let mut out = String::new();
    merged_attrs(&mut out);
    assert_eq!(out, MERGED_ATTRS);
    let mut out = String::new();
    fractions(&mut out);
    assert_eq!(out, FRACTIONS);
    let html = head().render();
    assert_eq!((html.head_tags.as_str(), html.html_attrs.as_str()), HEAD);
}

const MERGED_ATTRS: &str = r#" id="own" class="card big" title="&lt;t&gt;" data-k="v" arialabel="x" data-v-1 style="display:none;font-size:12;""#;
const FRACTIONS: &str = "0.1 2.5 1234.5678 0.30000000000000004 1e-7 19.99 ";
const HEAD: (&str, &str) = (
    concat!(
        "<meta charset=\"utf-8\">\n",
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n",
        "<title>Dune &quot;2&quot;</title>\n",
        "<meta name=\"description\" content=\"A &quot;desert&quot; planet\">\n",
        r#"<script type="application/ld+json">{"a":"\u003C/script>"}</script>"#,
    ),
    r#" lang="en" class="a b""#,
);
