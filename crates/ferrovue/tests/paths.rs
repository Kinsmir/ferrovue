//! The public paths of `ferrovue-core`, `ferrovue-router` and `ferrovue-i18n` through the
//! `ferrovue` crate's modules `core`, `router` and `i18n`.

#[allow(unused_imports)]
use ferrovue::core::{
    escape::escape_into,
    numbers::{
        Js, js_max, js_min, js_round, js_sign, js_to_exponential, js_to_fixed, js_to_precision,
        push_int, push_number,
    },
    uri::{js_encode_uri, js_encode_uri_component},
};

#[cfg(feature = "router")]
#[allow(unused_imports)]
use ferrovue::router::{Link, Query, Route, RouteDef, Router, query_into};

#[cfg(feature = "i18n")]
#[allow(unused_imports)]
use ferrovue::i18n::{Args, I18n, Locale, Message, Part, Value};

#[cfg(all(feature = "router", feature = "i18n"))]
#[test]
fn the_modules_are_the_crates_they_name() {
    let router: ferrovue_router::Router = ferrovue::router::Router::new(&["/"]);
    let _: ferrovue::router::Route<'_> = router.at("/");
    let _: ferrovue_i18n::I18n = ferrovue::i18n::I18n::new(&[], "en", &[]);
    let _: ferrovue::i18n::I18n = ferrovue_i18n::I18n::new(&[], "en", &[]);
    let _: ferrovue_core::numbers::Js<i64> = ferrovue::core::numbers::Js(1);
}
