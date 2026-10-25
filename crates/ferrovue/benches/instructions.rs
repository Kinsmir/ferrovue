//! The scenarios `render.rs` times, counted in instructions under Valgrind's Callgrind by gungraun.
//! `node scripts/instructions.ts` compares the counts with `instructions.json`.

#![allow(
    missing_docs,
    reason = "gungraun's macros declare a public module for each benchmark"
)]

use std::hint::black_box;

use ferrovue::router::Route;
use gungraun::{library_benchmark, library_benchmark_group, main};

#[rustfmt::skip]
#[path = "../tests/conformance/generated/mod.rs"]
mod generated;

#[allow(dead_code)]
#[path = "../tests/conformance/helpers.rs"]
mod helpers;

#[allow(dead_code)]
#[path = "../tests/conformance/vendor.rs"]
mod vendor;

mod scenarios;

/// What a `TrustedHtml` prop is here, as `tests/conformance.rs` defines it.
#[allow(dead_code)]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct Sanitised(String);

impl ferrovue::trusted::TrustedHtml for Sanitised {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

use generated::{dashboard, lists, nav, route_table, tree};
use scenarios::{
    SMALL_ROUTE, check, check_runtime, fractions, head, list_props, merged_attrs, page_props,
    small_props, tree_props,
};

fn small_input() -> (nav::Props<'static>, Route<'static>) {
    let router = Box::leak(Box::new(route_table::router()));
    let route = router.at(SMALL_ROUTE);
    let props = small_props();
    check("small", |out| nav::render(out, &props, &route));
    (props, route)
}

fn list_input() -> lists::Props<'static> {
    let props = list_props();
    check("list", |out| lists::render(out, &props));
    props
}

fn tree_input() -> tree::Props<'static> {
    let props = tree_props();
    check("tree", |out| tree::render(out, &props));
    props
}

fn page_input() -> dashboard::Props<'static> {
    let props = page_props();
    check("page", |out| dashboard::render(out, &props));
    props
}

fn runtime_input() -> String {
    check_runtime();
    String::with_capacity(256)
}

#[library_benchmark]
#[bench::small(small_input())]
fn render_small(input: (nav::Props<'static>, Route<'static>)) -> String {
    let mut out = String::new();
    nav::render(&mut out, black_box(&input.0), black_box(&input.1));
    out
}

#[library_benchmark]
#[bench::list(list_input())]
fn render_list(props: lists::Props<'static>) -> String {
    let mut out = String::new();
    lists::render(&mut out, black_box(&props));
    out
}

#[library_benchmark]
#[bench::tree(tree_input())]
fn render_tree(props: tree::Props<'static>) -> String {
    let mut out = String::new();
    tree::render(&mut out, black_box(&props));
    out
}

#[library_benchmark]
#[bench::page(page_input())]
fn render_page(props: dashboard::Props<'static>) -> String {
    let mut out = String::new();
    dashboard::render(&mut out, black_box(&props));
    out
}

#[library_benchmark]
#[bench::attrs_into(runtime_input())]
fn render_attrs(mut out: String) -> String {
    merged_attrs(black_box(&mut out));
    out
}

#[library_benchmark]
#[bench::push_number(runtime_input())]
fn render_number(mut out: String) -> String {
    fractions(black_box(&mut out));
    out
}

#[library_benchmark]
#[bench::head(runtime_input())]
fn render_head(_: String) -> ferrovue::head::HeadHtml {
    black_box(head()).render()
}

library_benchmark_group!(
    name = renderers,
    benchmarks = [render_small, render_list, render_tree, render_page]
);
library_benchmark_group!(
    name = runtime,
    benchmarks = [render_attrs, render_number, render_head]
);

main!(library_benchmark_groups = renderers, runtime);
