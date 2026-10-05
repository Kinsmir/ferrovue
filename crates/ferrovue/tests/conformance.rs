//! The generated half of ferrovue's own conformance suite: the renderers in
//! `conformance/generated/`, written by the compiler from `conformance/components/`, held to the
//! HTML Vue recorded for each fixture (`packages/ferrovue/test/conformance.test.ts`).

// Written by the compiler, and held to its output byte for byte: never reformatted.
#[rustfmt::skip]
#[path = "conformance/generated/mod.rs"]
mod generated;

/// The Rust twins of the helpers the components call.
#[path = "conformance/helpers.rs"]
mod helpers;

/// What a `TrustedHtml` prop is here. A real project's type would hold only a sanitiser's output;
/// the fixtures' HTML is trusted because it is written by hand.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct Sanitised(String);

impl ferrovue::TrustedHtml for Sanitised {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

use std::fs;
use std::path::Path;

#[test]
fn every_fixture_renders_as_vue_rendered_it() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/conformance/fixtures");
    let mut checked = 0;
    for component in fs::read_dir(&root).expect("fixtures") {
        let component = component.expect("fixture directory").path();
        let name = component.file_name().unwrap().to_str().unwrap().to_owned();
        for file in fs::read_dir(&component).expect("fixture files") {
            let json = file.expect("fixture").path();
            if json.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let want = fs::read_to_string(json.with_extension("html")).expect("recorded HTML");
            let got = generated::render_json(&name, &fs::read_to_string(&json).unwrap())
                .unwrap_or_else(|e| panic!("{}: {e}", json.display()));
            assert_eq!(got, want, "{}", json.display());
            checked += 1;
        }
    }
    assert!(checked >= 50, "only {checked} fixtures were found");
}

/// What a browser reads an attribute's value as.
fn unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// An island is the component's own markup, wrapped with the props the client hydrates it from —
/// which must be the props it was rendered with, or the client's first render differs.
#[test]
fn an_island_carries_the_props_it_was_rendered_from() {
    let json = r#"{"title":"\"><script>","count":-3,"on":true,"note":"é","padded":" x "}"#;
    let props: generated::text::Props = serde_json::from_str(json).unwrap();
    let mut markup = String::new();
    generated::text::render(&mut markup, &props);
    assert_eq!(generated::text::html(&props).into_string(), markup);

    let island = generated::text::island(&props).into_string();
    let rest = island
        .strip_prefix(r#"<div data-island="Text" data-props=""#)
        .expect("the island wrapper");
    let (attr, inner) = rest
        .split_once(r#"">"#)
        .expect("the end of the props attribute");
    assert_eq!(inner, format!("{markup}</div>"));
    assert!(!attr.contains(['"', '<', '>']), "{attr}");
    let read: serde_json::Value = serde_json::from_str(&unescape(attr)).unwrap();
    assert_eq!(
        read,
        serde_json::from_str::<serde_json::Value>(json).unwrap()
    );
}

/// An absent optional prop is left out of the island's props, as it is absent to Vue; never `null`.
#[test]
fn an_island_leaves_absent_props_out() {
    let props: generated::text::Props =
        serde_json::from_str(r#"{"title":"t","count":0,"on":false,"padded":""}"#).unwrap();
    let island = generated::text::island(&props).into_string();
    assert!(!island.contains("null"), "{island}");
    assert!(!island.contains("note"), "{island}");
}

/// A `Float` prop that is `NaN` or infinite reaches the client as itself, not as the `null`
/// `serde_json` would write. `islands.html` is this page, which `packages/ferrovue/test/islands.test.ts`
/// holds to Vue's own render of the same props and hydrates with no mismatch.
#[test]
fn an_island_carries_numbers_that_are_not_finite() {
    use generated::narrowing;
    let mut page = String::new();
    for ratio in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        narrowing::island(&narrowing::Props::new().ratio(ratio)).render_to(&mut page);
    }
    page.push('\n');
    assert_eq!(page, include_str!("conformance/islands.html"));
    for ratio in ["NaN", "Infinity", "-Infinity"] {
        assert!(page.contains(&format!(r#"data-props="{{&quot;ratio&quot;:{ratio}}}""#)));
    }
}

/// A component that takes slots, a route or stores has no island: what it was given beyond its
/// props cannot travel to the client in an attribute.
#[test]
fn a_component_with_slots_renders_through_html() {
    let props: generated::frame::Props = serde_json::from_str(r#"{"title":"t"}"#).unwrap();
    let body = |out: &mut String| out.push_str("<p>hi</p>");
    let slots = generated::frame::Slots {
        head: None,
        default: Some(ferrovue::Slot::new(&body)),
    };
    let html = generated::frame::html(&props, slots).into_string();
    assert_eq!(
        html,
        r#"<div class="frame"><header><!--[-->t<!--]--></header><main><!--[--><p>hi</p><!--]--></main></div>"#
    );
}

/// A tree renders to depth with one buffer, its reservation an estimate rather than a limit. (60
/// levels: deeper than that, `serde_json` refuses the fixture before the renderer sees it.)
#[test]
fn a_deep_tree_renders_whole() {
    let mut json = String::from(r#"{"label":"leaf","children":[]}"#);
    for i in 0..60 {
        json = format!(r#"{{"label":"n{i}","children":[{json}]}}"#);
    }
    let html = generated::render_json("Tree", &json).unwrap();
    assert_eq!(html.matches("<li>").count(), 61);
    assert!(
        html.starts_with("<li>n59<ul><!--[--><li>n58"),
        "{}",
        &html[..60]
    );
}

/// A scoped slot filled from Rust: a closure given the props the outlet passes, which returns
/// whether it wrote content — and the fallback when it did not.
#[test]
fn a_scoped_slot_is_filled_by_a_closure_given_its_props() {
    use generated::data_list;
    let props: data_list::Props =
        serde_json::from_str(r#"{"rows":[{"id":1,"label":"a<b","tags":["x"]},{"id":2,"label":"c","tags":[]}],"title":"t"}"#)
            .unwrap();
    let row = |out: &mut String, p: &data_list::RowSlotProps<'_>| {
        if p.tags.is_empty() {
            return false;
        }
        out.push_str("<b>");
        ferrovue::escape_into(out, p.label);
        out.push_str("</b>");
        ferrovue::push_int(out, p.index);
        true
    };
    let slots = data_list::Slots {
        row: Some(&row),
        ..Default::default()
    };
    let html = data_list::html(&props, slots).into_string();
    assert!(
        html.contains("<li><!--[--><b>a&lt;b</b>0<!--]--></li>"),
        "{html}"
    );
    assert!(
        html.contains("<li><!--[-->1. c<!--]--></li>"),
        "the fallback: {html}"
    );
}

/// Props built in Rust with the generated constructors and setters render as the same props
/// deserialised from a fixture do: no `Cow`, no `None`, strings and lists of them taken as they come.
#[test]
fn props_are_built_with_constructors_and_setters() {
    use generated::{types, user_card};
    let built = user_card::Props::new(
        types::User::new(
            1,
            "Ann",
            vec![
                types::Role::new("owner", true),
                types::Role::new("dev", false),
            ],
        )
        .avatar("/a.png")
        .size(String::from("sm")),
    )
    .badges(vec![
        types::Badge::new("new").tone("green"),
        types::Badge::new("x"),
    ])
    .note("n");
    let mut from_rust = String::new();
    user_card::render(&mut from_rust, &built);
    let fixture = generated::render_json(
        "UserCard",
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/conformance/fixtures/UserCard/full.json"
        ))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(from_rust, fixture);

    let lists = generated::lists::Props::new(["a", "b"], vec![1, 2], vec![]);
    assert_eq!(lists.words.len(), 2);
}
