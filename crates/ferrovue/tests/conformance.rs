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

/// Islands in a page that Dioxus renders: the markup inside each island is the HTML Vue recorded,
/// byte for byte, with no hydration marker in it, and it carries the same props.
#[cfg(feature = "dioxus")]
mod dioxus {
    use super::{generated, unescape};
    use dioxus_core::{
        Attribute, Element, IntoDynNode, Template, TemplateAttribute, TemplateNode, VNode,
    };
    use dioxus_ssr::Renderer;
    use std::fs;
    use std::path::Path;

    /// `<main><h1>Books</h1>{island}</main>`: `rsx! { main { h1 { "Books" } {island} } }`.
    static AROUND: Template = Template {
        roots: &[TemplateNode::Element {
            tag: "main",
            namespace: None,
            attrs: &[],
            children: &[
                TemplateNode::Element {
                    tag: "h1",
                    namespace: None,
                    attrs: &[],
                    children: &[TemplateNode::Text { text: "Books" }],
                },
                TemplateNode::Dynamic { id: 0 },
            ],
        }],
        node_paths: &[&[0, 1]],
        attr_paths: &[],
    };

    /// `rsx! { main { dangerous_inner_html: html } }`.
    static INSIDE: Template = Template {
        roots: &[TemplateNode::Element {
            tag: "main",
            namespace: None,
            attrs: &[TemplateAttribute::Dynamic { id: 0 }],
            children: &[],
        }],
        node_paths: &[],
        attr_paths: &[&[0]],
    };

    /// The page as `dioxus-ssr` writes it, then as a fullstack server does, with hydration ids.
    fn rendered(page: impl Fn() -> Element) -> [String; 2] {
        let mut hydratable = Renderer::new();
        hydratable.pre_render = true;
        [
            Renderer::new().render_element(page()),
            hydratable.render_element(page()),
        ]
    }

    /// An island's `data-props` value as it is written, and the markup inside the island.
    fn split_island<'h>(html: &'h str, name: &str, hydration: &str) -> (&'h str, &'h str) {
        let rest = html
            .strip_prefix(&format!(r#"<div data-island="{name}" data-props=""#))
            .unwrap_or_else(|| panic!("an island's start tag: {html}"));
        let (props, rest) = rest.split_once('"').expect("the end of data-props");
        let inner = rest
            .strip_prefix(hydration)
            .and_then(|r| r.strip_prefix('>'))
            .and_then(|r| r.strip_suffix("</div>"))
            .unwrap_or_else(|| panic!("the rest of the island: {rest}"));
        (props, inner)
    }

    /// What a browser reads an attribute's value as, whichever way its references are spelled.
    fn decoded(s: &str) -> String {
        unescape(
            &s.replace("&#34;", "&quot;")
                .replace("&#60;", "&lt;")
                .replace("&#62;", "&gt;")
                .replace("&#38;", "&amp;"),
        )
    }

    macro_rules! islands_in_a_dioxus_page {
        ($($name:literal => $module:ident),* $(,)?) => {{
            let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/conformance/fixtures");
            let mut checked = 0;
            $(
                for file in fs::read_dir(root.join($name)).expect("fixtures") {
                    let json = file.expect("fixture").path();
                    if json.extension().is_none_or(|e| e != "json") {
                        continue;
                    }
                    let source = fs::read_to_string(&json).unwrap();
                    let props: generated::$module::Props = serde_json::from_str(&source).unwrap();
                    let vue = fs::read_to_string(json.with_extension("html")).expect("recorded HTML");
                    let ferrovue = generated::$module::island(&props).into_string();
                    let (ferrovue_props, inner) = split_island(&ferrovue, $name, "");
                    assert_eq!(inner, vue, "{}", json.display());

                    // The island as an element of the page.
                    let [plain, hydratable] = rendered(|| {
                        Ok(VNode::new(
                            None,
                            AROUND,
                            Box::new([generated::$module::island(&props).into_dyn_node()]),
                            Box::new([]),
                        ))
                    });
                    for (page, start, hydration) in [
                        (&plain, "<main>", ""),
                        (&hydratable, r#"<main data-node-hydration="0">"#, r#" data-node-hydration="1""#),
                    ] {
                        let island = page
                            .strip_prefix(&format!("{start}<h1>Books</h1>"))
                            .and_then(|p| p.strip_suffix("</main>"))
                            .unwrap_or_else(|| panic!("the page around the island: {page}"));
                        let (dioxus_props, inner) = split_island(island, $name, hydration);
                        assert_eq!(inner, vue, "{}", json.display());
                        assert_eq!(decoded(dioxus_props), decoded(ferrovue_props), "{}", json.display());
                    }

                    // The island as the content of an element of the page's own: every byte.
                    let [plain, hydratable] = rendered(|| {
                        let html = generated::$module::island(&props).into_string();
                        Ok(VNode::new(
                            None,
                            INSIDE,
                            Box::new([]),
                            Box::new([Box::new([Attribute::new("dangerous_inner_html", html, None, false)])]),
                        ))
                    });
                    assert_eq!(plain, format!("<main>{ferrovue}</main>"), "{}", json.display());
                    assert_eq!(
                        hydratable,
                        format!(r#"<main data-node-hydration="0">{ferrovue}</main>"#),
                        "{}",
                        json.display()
                    );
                    checked += 1;
                }
            )*
            checked
        }};
    }

    #[test]
    fn an_island_in_a_dioxus_page_is_the_island_vue_hydrates() {
        let checked = islands_in_a_dioxus_page! {
            "Text" => text,
            "Strings" => strings,
            "Numbers" => numbers,
            "Exprs" => exprs,
            "Markup" => markup,
            "Attrs" => attrs,
            "Lists" => lists,
            "UserCard" => user_card,
            "Records" => records,
            "Regressions" => regressions,
            "ScopedLeaf" => scoped_leaf,
            "Prose" => prose,
            "Parsing" => parsing,
            "Chips" => chips,
        };
        assert!(checked >= 50, "only {checked} fixtures were found");
    }
}
