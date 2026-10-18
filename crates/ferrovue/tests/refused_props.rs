//! Props serde_json cannot write, in a debug build of a crate that renders them.

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "serde_json cannot write these props as JSON")]
fn a_debug_build_stops_at_an_island_whose_props_serde_json_refuses() {
    type ByList = std::collections::BTreeMap<Vec<i64>, f64>;
    let props: ByList = [(vec![1], 2.0)].into_iter().collect();
    let _ = ferrovue::Html::island("ByList", &props, |_: &mut String, _: &ByList| {}).into_string();
}
