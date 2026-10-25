//! The conformance suite's generated renderers, timed on the scenarios
//! `packages/ferrovue/bench/ssr.bench.ts` times Vue's `renderToString` on.

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};

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

impl ferrovue::html::TrustedHtml for Sanitised {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

use generated::{dashboard, lists, nav, route_table, tree};
use scenarios::{
    SMALL_ROUTE, check, check_runtime, fractions, head, list_props, merged_attrs, page_props,
    small_props, tree_props,
};

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

fn runtime(c: &mut Criterion) {
    let mut group = c.benchmark_group("runtime");

    check_runtime();
    group.bench_function("attrs_into", |b| {
        let mut out = String::with_capacity(256);
        b.iter(|| {
            out.clear();
            merged_attrs(black_box(&mut out));
        })
    });
    group.bench_function("push_number", |b| {
        let mut out = String::with_capacity(256);
        b.iter(|| {
            out.clear();
            fractions(black_box(&mut out));
        })
    });
    group.bench_function("head", |b| b.iter(|| black_box(head()).render()));

    group.finish();
}

criterion_group!(benches, bench, runtime);
criterion_main!(benches);
