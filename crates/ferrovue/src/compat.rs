/// The version check a generated `mod.rs` opens with: `ferrovue::__compat!(1);` names the version
/// of generated code its compiler writes, and stops the build with what to do when this crate does
/// not support that version.
#[doc(hidden)]
#[macro_export]
macro_rules! __compat {
    (1) => {};
    ($version:literal) => {
        ::core::compile_error!(::core::concat!(
            "this module was generated as version ",
            ::core::stringify!($version),
            " of ferrovue's generated code, and this `ferrovue` crate supports version 1: use the ",
            "`ferrovue` npm package and the `ferrovue` crate of one release, and run `ferrovue` ",
            "to generate the module again"
        ));
    };
}
