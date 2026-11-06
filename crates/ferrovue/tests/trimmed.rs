//! Components compiled with `"whitespace": "trim-edges"`, rendered as Vue renders them with
//! `trimEdges`.

#[rustfmt::skip]
#[path = "trimmed/generated/mod.rs"]
#[allow(missing_docs, missing_debug_implementations)]
pub mod generated;

ferrovue::conformance!(
    "tests/trimmed/fixtures",
    generated::render_json,
    at_least = 12
);
