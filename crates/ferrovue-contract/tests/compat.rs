//! Generated code of a version this `ferrovue` crate does not support stops the build with a
//! message that says what to do, and so does an enum `unions` names whose variants are not the
//! union's.

#[test]
fn the_version_check_names_what_to_do() {
    let cases = trybuild::TestCases::new();
    cases.pass("tests/compat/current.rs");
    cases.pass("tests/compat/older.rs");
    cases.compile_fail("tests/compat/previous.rs");
    cases.compile_fail("tests/compat/newer.rs");
}

#[test]
fn an_enum_missing_a_variant_of_the_union_or_holding_another_stops_the_build_at_the_generated_module()
 {
    let cases = trybuild::TestCases::new();
    cases.compile_fail("tests/compat/missing_variant.rs");
    cases.compile_fail("tests/compat/extra_variant.rs");
}
