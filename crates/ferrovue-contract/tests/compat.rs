//! Generated code of a version this `ferrovue` crate does not support stops the build with a
//! message that says what to do.

#[test]
fn the_version_check_names_what_to_do() {
    let cases = trybuild::TestCases::new();
    cases.pass("tests/compat/current.rs");
    cases.compile_fail("tests/compat/newer.rs");
}
