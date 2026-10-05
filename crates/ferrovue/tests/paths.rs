//! The public paths `ferrovue` re-exports from its own crates (`ferrovue-core`, `ferrovue-router`,
//! `ferrovue-i18n`), each where it was in 0.3.0, before those crates were split off. Generated code
//! names them by these paths. `cargo semver-checks` does not follow a re-export from another crate,
//! so this is what holds them in place: it compiles only while every one of them resolves.

#[allow(unused_imports)]
use ferrovue::{Js, escape_into, js_max, js_min, js_round, js_to_fixed, push_int, push_number};

#[cfg(feature = "router")]
#[allow(unused_imports)]
use ferrovue::{Link, Query, Route, RouteDef, Router, query_into};

#[cfg(feature = "i18n")]
#[allow(unused_imports)]
use ferrovue::{
    I18n,
    i18n::{Args, Locale, Message, Part, Value},
};

/// The same items, by both paths: one type, not two that look alike.
#[cfg(all(feature = "router", feature = "i18n"))]
#[test]
fn the_re_exports_are_the_items_of_the_crates_they_come_from() {
    let router: ferrovue_router::Router = ferrovue::Router::new(&["/"]);
    let _: ferrovue::Route<'_> = router.at("/");
    let _: ferrovue_i18n::I18n = ferrovue::i18n::I18n::new(&[], "en", &[]);
    let _: ferrovue::I18n = ferrovue_i18n::I18n::new(&[], "en", &[]);
    let _: ferrovue_core::Js<i64> = ferrovue::Js(1);
}
