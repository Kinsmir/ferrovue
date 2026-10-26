/// The version check a generated `mod.rs` opens with: `ferrovue::__compat!(7);` names the version
/// of generated code its compiler writes, and stops the build with what to do when this crate does
/// not support that version.
#[doc(hidden)]
#[macro_export]
macro_rules! __compat {
    (6) => {};
    (7) => {};
    ($version:literal) => {
        ::core::compile_error!(::core::concat!(
            "this module was generated as version ",
            ::core::stringify!($version),
            " of ferrovue's generated code, and this `ferrovue` crate supports versions 6 to 7: ",
            "use the `ferrovue` npm package and the `ferrovue` crate of one release, and run ",
            "`ferrovue` to generate the module again"
        ));
    };
}
