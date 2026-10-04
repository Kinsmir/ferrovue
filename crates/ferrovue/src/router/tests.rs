use super::*;
use std::collections::BTreeMap;

/// The vectors the TypeScript side runs against the real vue-router, with its answers recorded.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vectors {
    routes: Vec<String>,
    names: BTreeMap<String, String>,
    links: Vec<(String, String)>,
    expected: Vec<(String, bool)>,
    objects: Vec<(String, Object)>,
    expected_objects: Vec<(String, bool)>,
    locations: Vec<String>,
    expected_locations: Vec<Location>,
    bases: Vec<(String, String, String)>,
    expected_bases: Vec<(String, bool)>,
}

/// A `to` written as an object.
#[derive(serde::Deserialize)]
struct Object {
    name: Option<String>,
    path: Option<String>,
    #[serde(default)]
    params: BTreeMap<String, String>,
    /// `[key, value]` pairs, in the order vue-router writes them.
    #[serde(default)]
    query: Vec<(String, String)>,
    #[serde(default)]
    hash: String,
}

/// What `useRoute()` reads.
#[derive(serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Location {
    path: String,
    hash: String,
    name: Option<String>,
    params: BTreeMap<String, String>,
    full_path: String,
    /// `[key, value]`, the value a string, `null`, or an array of those.
    query: Vec<(String, serde_json::Value)>,
}

/// Nested routes, with what vue-router answered for each link and location.
#[derive(serde::Deserialize)]
struct Nested {
    routes: Vec<NestedRoute>,
    links: Vec<(String, String)>,
    named: Vec<(String, Object)>,
    locations: Vec<String>,
}

#[derive(serde::Deserialize)]
struct NestedRoute {
    path: String,
    name: Option<String>,
    #[serde(default)]
    children: Vec<NestedRoute>,
}

#[derive(serde::Deserialize)]
struct NestedExpected {
    links: Vec<(String, bool, bool)>,
    named: Vec<(String, bool, bool)>,
    locations: Vec<NestedLocation>,
}

#[derive(serde::Deserialize)]
struct NestedLocation {
    path: String,
    name: Option<String>,
    params: BTreeMap<String, String>,
}

/// The vectors' routes as `RouteDef`s, which borrow for as long as the test runs.
fn route_defs(routes: &[NestedRoute]) -> &'static [RouteDef<'static>] {
    let defs: Vec<RouteDef<'static>> = routes
        .iter()
        .map(|r| RouteDef {
            path: Box::leak(r.path.clone().into_boxed_str()),
            name: r.name.clone().map(|n| &*Box::leak(n.into_boxed_str())),
            children: route_defs(&r.children),
        })
        .collect();
    Box::leak(defs.into_boxed_slice())
}

#[test]
fn nested_routes_resolve_and_activate_as_vue_router_does() {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct File {
        nested: Nested,
        expected_nested: NestedExpected,
    }
    let file: File = serde_json::from_str(include_str!("../../tests/vectors/router.expected.json"))
        .expect("router vectors");
    let (v, want) = (file.nested, file.expected_nested);
    let router = Router::tree(route_defs(&v.routes));
    for ((at, to), (href, active, exact)) in v.links.iter().zip(&want.links) {
        let link = router.at(at).link(to);
        assert_eq!(
            (&link.href, link.active, link.exact),
            (href, *active, *exact),
            "at {at:?}, a link to {to:?}"
        );
    }
    for ((at, to), (href, active, exact)) in v.named.iter().zip(&want.named) {
        let params: Vec<(&str, &str)> = to
            .params
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let link = router
            .at(at)
            .link_named(to.name.as_deref().unwrap(), &params, "", "");
        assert_eq!(
            (&link.href, link.active, link.exact),
            (href, *active, *exact),
            "at {at:?}, a link to {:?}",
            to.name
        );
    }
    for (at, want) in v.locations.iter().zip(&want.locations) {
        let route = router.at(at);
        assert_eq!(
            (route.path(), route.name()),
            (want.path.as_str(), want.name.as_deref()),
            "at {at:?}"
        );
        for (name, value) in &want.params {
            assert_eq!(
                route.param(name),
                Some(value.as_str()),
                "at {at:?}, param {name:?}"
            );
        }
    }
}

fn vectors() -> Vectors {
    let text = include_str!("../../tests/vectors/router.expected.json");
    serde_json::from_str(text).expect("router vectors")
}

fn router(v: &Vectors) -> Router {
    let routes: Vec<(&str, Option<&str>)> = v
        .routes
        .iter()
        .map(|p| (p.as_str(), v.names.get(p).map(String::as_str)))
        .collect();
    Router::named(&routes)
}

#[test]
fn links_resolve_as_vue_router_resolves_them() {
    let v = vectors();
    assert!(v.links.len() >= 40, "the vectors were not all read");
    assert_eq!(v.links.len(), v.expected.len());
    let router = router(&v);
    for ((at, to), (href, active)) in v.links.iter().zip(&v.expected) {
        let link = router.at(at).link(to);
        assert_eq!(
            (&link.href, link.active),
            (href, *active),
            "at {at:?}, a link to {to:?}"
        );
    }
}

#[test]
fn object_links_resolve_as_vue_router_resolves_them() {
    let v = vectors();
    assert!(v.objects.len() >= 20, "the vectors were not all read");
    let router = router(&v);
    for ((at, to), (href, active)) in v.objects.iter().zip(&v.expected_objects) {
        let mut search = String::new();
        for (k, value) in &to.query {
            query_into(&mut search, k, value);
        }
        let route = router.at(at);
        let link = match (&to.name, &to.path) {
            (Some(name), _) => {
                let params: Vec<(&str, &str)> = to
                    .params
                    .iter()
                    .map(|(k, v)| (k.as_str(), v.as_str()))
                    .collect();
                route.link_named(name, &params, &search, &to.hash)
            }
            (None, Some(path)) => route.link_path(path, &search, &to.hash),
            (None, None) => unreachable!("a vector names a route or a path"),
        };
        assert_eq!(
            (&link.href, link.active),
            (href, *active),
            "at {at:?}, a link to {:?}",
            (&to.name, &to.path, &to.params, &to.query, &to.hash)
        );
    }
}

#[test]
fn use_route_reads_what_vue_router_reads() {
    let v = vectors();
    let router = router(&v);
    for (at, want) in v.locations.iter().zip(&v.expected_locations) {
        let route = router.at(at);
        for (name, value) in &want.params {
            assert_eq!(
                route.param(name),
                Some(value.as_str()),
                "at {at:?}, param {name:?}"
            );
        }
        assert_eq!(route.param("nonexistent"), None);
        assert_eq!(route.full_path(), want.full_path, "fullPath at {at:?}");
        for (key, value) in &want.query {
            let got = match route.query(key) {
                Query::Absent => panic!("at {at:?}, query {key:?} is absent"),
                Query::Null => serde_json::Value::Null,
                Query::One(s) => serde_json::Value::from(s),
                Query::Many(values) => serde_json::Value::from(values.to_vec()),
            };
            assert_eq!(&got, value, "at {at:?}, query {key:?}");
        }
        assert_eq!(route.query("absent-key"), Query::Absent);
        assert_eq!(
            (route.path(), route.hash(), route.name()),
            (want.path.as_str(), want.hash.as_str(), want.name.as_deref()),
            "at {at:?}"
        );
    }
}

#[test]
fn links_under_a_base_resolve_as_vue_router_resolves_them() {
    let v = vectors();
    for ((base, at, to), (href, active)) in v.bases.iter().zip(&v.expected_bases) {
        let router = router(&v).with_base(base);
        let link = router.at(at).link(to);
        assert_eq!(
            (&link.href, link.active),
            (href, *active),
            "base {base:?}, at {at:?}, a link to {to:?}"
        );
    }
}

#[test]
#[should_panic(expected = "two routes are called")]
fn two_routes_of_one_name_are_refused() {
    Router::named(&[("/a", Some("x")), ("/b", Some("x"))]);
}

#[test]
#[should_panic(expected = "`(.*)` is supported on the last segment only")]
fn a_wildcard_before_the_end_is_refused() {
    Router::new(&["/a/:x(.*)/b"]);
}

#[test]
#[should_panic(expected = "a parameter is `:name` or `:name(.*)`")]
fn an_optional_parameter_is_refused() {
    Router::new(&["/a/:x?"]);
}

#[test]
fn a_static_segment_outranks_a_parameter_whatever_the_order_given() {
    let router = Router::new(&["/blog/:slug", "/blog/latest"]);
    let at_latest = router.at("/blog/latest");
    assert!(at_latest.link("/blog/latest").active);
    assert!(
        !at_latest.link("/blog/other").active,
        "`latest` matched the static route, not the parameter"
    );
}

#[test]
fn the_location_path_drops_the_query_and_hash() {
    let router = Router::new(&["/"]);
    assert_eq!(router.at("/a/b?x=1#h").path(), "/a/b");
    assert_eq!(router.at("/?x").path(), "/");
}

#[test]
fn a_link_matching_no_route_is_never_active() {
    let router = Router::new(&["/a"]);
    let link = router.at("/nowhere").link("/nowhere");
    assert_eq!(link.href, "/nowhere");
    assert!(!link.active);
}

#[test]
fn parameters_compare_decoded() {
    let router = Router::new(&["/t/:tag"]);
    assert!(router.at("/t/a%20b").link("/t/a b").active);
    assert!(!router.at("/t/a%20b").link("/t/a%2520b").active);
}

#[test]
fn decode_leaves_malformed_escapes_alone() {
    assert_eq!(decode("a%2"), "a%2");
    assert_eq!(decode("%zz"), "%zz");
    assert_eq!(decode("%C3%A9"), "é");
    assert_eq!(decode("%C3"), "%C3", "a lone UTF-8 lead byte");
    assert_eq!(decode("%"), "%");
}

#[test]
fn relative_links_resolve_against_the_location() {
    assert_eq!(resolve_relative_path("c", "/a/b"), "/a/c");
    assert_eq!(resolve_relative_path("../c", "/a/b/d"), "/a/c");
    assert_eq!(resolve_relative_path("../../../../c", "/a/b"), "/c");
    assert_eq!(resolve_relative_path("", "/a/b"), "/a/b");
    assert_eq!(resolve_relative_path("/x", "/a/b"), "/x");
}

#[test]
#[should_panic(expected = "a route path starts with `/`")]
fn a_relative_route_is_refused() {
    Router::new(&["a/b"]);
}

#[test]
#[should_panic(expected = "a static segment is plain ASCII text")]
fn a_non_ascii_static_segment_is_refused() {
    Router::new(&["/café"]);
}

#[test]
#[should_panic(expected = "a static segment is plain ASCII text")]
fn an_empty_segment_is_refused() {
    Router::new(&["/a//b"]);
}

/// vue-router throws on an empty parameter; a debug build fails the render the same way.
#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "missing required param")]
fn an_empty_parameter_fails_a_debug_render() {
    let router = Router::named(&[("/users/:id", Some("user"))]);
    router.at("/").link_named("user", &[("id", "")], "", "");
}
