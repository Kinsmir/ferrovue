//! The conformance suite's generated renderers, timed on the scenarios
//! `packages/ferrovue/bench/ssr.bench.ts` times Vue's `renderToString` on.
//!
//! Each scenario's props are built here exactly as the JavaScript side builds them, and before
//! anything is timed the output is held to `benches/expected/<scenario>.html`, which that side
//! records from Vue: the two halves time the same work, writing the same bytes.
//!
//! What is timed: a fresh `String` and one call of the component's `render`. The props, the
//! router and the route are built once, outside the loop, as an app holds them across requests.

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};

// Written by the compiler, and shared with `tests/conformance.rs`: never reformatted.
#[rustfmt::skip]
#[path = "../tests/conformance/generated/mod.rs"]
mod generated;

/// The Rust twins of the helpers the components call.
#[allow(dead_code)]
#[path = "../tests/conformance/helpers.rs"]
mod helpers;

/// What a `TrustedHtml` prop is here, as `tests/conformance.rs` defines it.
#[allow(dead_code)]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct Sanitised(String);

impl ferrovue::TrustedHtml for Sanitised {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

use generated::{dashboard, lists, nav, panel, route_table, tree};

/// `small`: one `<Nav>`, two `<RouterLink>`s resolved against the reader's location.
fn small_props() -> nav::Props<'static> {
    nav::Props::new("/users/me", "Me & you").note("3 new")
}
const SMALL_ROUTE: &str = "/users/me";

/// `list`: `<Lists>` with 1,000 words, 1,000 numbers and 100 groups of 10 members.
fn list_props() -> lists::Props<'static> {
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

/// `tree`: a recursive `<Tree>`, a full binary tree 8 levels deep (255 nodes).
fn tree_props() -> tree::Props<'static> {
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

/// `page`: `<Dashboard>`, 22 `<Panel>`s with named slots, a `<Text>`, and 20 `<Frame>`s each
/// holding a loop.
fn page_props() -> dashboard::Props<'static> {
    let panels = (0..20)
        .map(|i| {
            let p = panel::Props::new(format!("Panel {i}"));
            if i % 2 == 0 { p.count(i) } else { p }
        })
        .collect();
    let words = (0..10).map(|i| format!("tag {i}"));
    dashboard::Props::new("Dashboard <beta>", panels, words, 42).footer("Updated & synced")
}

/// What Vue rendered for each scenario, recorded by the JavaScript half.
const EXPECTED: [(&str, &str); 4] = [
    ("small", include_str!("expected/small.html")),
    ("list", include_str!("expected/list.html")),
    ("tree", include_str!("expected/tree.html")),
    ("page", include_str!("expected/page.html")),
];

fn expected(scenario: &str) -> &'static str {
    EXPECTED.iter().find(|(s, _)| *s == scenario).unwrap().1
}

/// Render once and hold the output to Vue's before any timing.
fn check(scenario: &str, render: impl Fn(&mut String)) {
    let mut out = String::new();
    render(&mut out);
    assert!(
        out == expected(scenario),
        "{scenario}: the generated renderer's output differs from Vue's (benches/expected/{scenario}.html)"
    );
}

fn bench(c: &mut Criterion) {
    let mut group = c.benchmark_group("ferrovue");

    let router = route_table::router();
    let route = router.at(SMALL_ROUTE);
    let props = small_props();
    check("small", |out| nav::render(out, &props, &route));
    group.bench_function("small", |b| {
        b.iter(|| {
            let mut out = String::new();
            nav::render(&mut out, black_box(&props), black_box(&route));
            out
        })
    });

    let props = list_props();
    check("list", |out| lists::render(out, &props));
    group.bench_function("list", |b| {
        b.iter(|| {
            let mut out = String::new();
            lists::render(&mut out, black_box(&props));
            out
        })
    });

    let props = tree_props();
    check("tree", |out| tree::render(out, &props));
    group.bench_function("tree", |b| {
        b.iter(|| {
            let mut out = String::new();
            tree::render(&mut out, black_box(&props));
            out
        })
    });

    let props = page_props();
    check("page", |out| dashboard::render(out, &props));
    group.bench_function("page", |b| {
        b.iter(|| {
            let mut out = String::new();
            dashboard::render(&mut out, black_box(&props));
            out
        })
    });

    group.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
