//! The generated half of ferrovue's conformance suite.

#[rustfmt::skip]
#[path = "conformance/generated/mod.rs"]
#[allow(missing_docs)]
pub mod generated;

#[path = "conformance/helpers.rs"]
mod helpers;

#[path = "conformance/vendor.rs"]
mod vendor;

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

ferrovue::conformance!(
    "tests/conformance/fixtures",
    generated::render_json,
    at_least = 50
);

fn unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

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

#[test]
fn an_island_leaves_absent_props_out() {
    let props: generated::text::Props =
        serde_json::from_str(r#"{"title":"t","count":0,"on":false,"padded":""}"#).unwrap();
    let island = generated::text::island(&props).into_string();
    assert!(!island.contains("null"), "{island}");
    assert!(!island.contains("note"), "{island}");
}

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

#[test]
fn an_island_carries_null_for_a_nullable_prop() {
    use generated::{nullable, types};
    let mut page = String::new();
    nullable::island(&nullable::Props::new(vec![], vec![None])).render_to(&mut page);
    let entry = types::Entry::new("e").score(0);
    nullable::island(
        &nullable::Props::new(vec![entry.clone()], vec![Some("t".into()), None])
            .label("")
            .on(false)
            .entry(entry),
    )
    .render_to(&mut page);
    page.push('\n');
    assert_eq!(page, include_str!("conformance/null-islands.html"));
    assert!(page.contains(
        r#"data-props="{&quot;label&quot;:null,&quot;count&quot;:null,&quot;ratio&quot;:null,&quot;on&quot;:null,&quot;entry&quot;:null,&quot;entries&quot;:[],&quot;tags&quot;:[null]}""#
    ));
    assert!(page.contains(
        r#"{&quot;title&quot;:&quot;e&quot;,&quot;deletedAt&quot;:null,&quot;score&quot;:0}"#
    ));
}

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

fn page_part(part: &serde_json::Value) -> ferrovue::Part<'static> {
    use generated::{client_side, prose, text};
    let props = part["p"].clone();
    match part["c"].as_str().expect("a component name") {
        "ClientSide" => ferrovue::Part::new(
            client_side::NAME,
            client_side::into_html(serde_json::from_value(props).unwrap()),
        ),
        "Text" => ferrovue::Part::new(
            text::NAME,
            text::into_html(serde_json::from_value(props).unwrap()),
        ),
        "Prose" => ferrovue::Part::new(
            prose::NAME,
            prose::into_html(serde_json::from_value(props).unwrap()),
        ),
        other => panic!("no page part called {other}"),
    }
}

#[test]
fn every_page_renders_as_vue_rendered_it_and_records_what_it_rendered() {
    use generated::{frame, panel};
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/conformance/pages");
    let mut checked = 0;
    for file in fs::read_dir(&root).expect("pages") {
        let json = file.expect("page fixture").path();
        if json.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let fixture: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&json).unwrap()).unwrap();
        let record = &fixture["record"];
        let mut page = ferrovue::Page::new();
        let slots: std::collections::HashMap<&str, ferrovue::PageSlot<'static>> = record["slots"]
            .as_object()
            .expect("the slots")
            .iter()
            .map(|(name, parts)| {
                let parts = parts
                    .as_array()
                    .expect("a slot's parts")
                    .iter()
                    .map(page_part);
                (name.as_str(), page.slot(name, parts))
            })
            .collect();
        let slot = |name: &str| slots.get(name).map(ferrovue::PageSlot::slot);
        let props = record["props"].clone();
        let mut out = String::new();
        let written = match fixture["layout"].as_str().expect("a layout") {
            "Panel" => {
                let props: panel::Props = serde_json::from_value(props).unwrap();
                let slots = panel::Slots {
                    title: slot("title"),
                    default: slot("default"),
                    footer: slot("footer"),
                };
                page.render_to(&mut out, panel::html(&props, slots))
            }
            "Frame" => {
                let props: frame::Props = serde_json::from_value(props).unwrap();
                let slots = frame::Slots {
                    head: slot("head"),
                    default: slot("default"),
                };
                page.render_to(&mut out, frame::html(&props, slots))
            }
            other => panic!("no layout called {other}"),
        };
        let want = fs::read_to_string(json.with_extension("html")).expect("recorded HTML");
        assert_eq!(out, want, "{}", json.display());

        let mut script = String::new();
        written.script_into(&mut script, "__fv_page");
        let body = script
            .strip_prefix(r#"<script type="application/json" id="__fv_page">"#)
            .and_then(|b| b.strip_suffix("</script>"))
            .expect("one script element");
        assert!(
            !body.contains(['<', '>', '&', '\u{2028}', '\u{2029}']),
            "{body}"
        );
        let read: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(&read, record, "{}", json.display());
        checked += 1;
    }
    assert!(checked >= 4, "only {checked} pages were found");
}

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

#[test]
fn props_named_after_rust_keywords_are_built_with_constructors_and_setters() {
    use generated::keywords;
    let built = keywords::Props::new("mp4", true, "<core>")
        .r#match("m")
        .self_(3)
        .r#static(true)
        .r#async("a&b");
    let mut from_rust = String::new();
    keywords::render(&mut from_rust, &built);
    let fixture = generated::render_json(
        "Keywords",
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/conformance/fixtures/Keywords/full.json"
        ))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(from_rust, fixture);
}

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

#[cfg(feature = "dioxus")]
mod dioxus {
    use super::{generated, unescape};
    use dioxus_core::{
        Attribute, Element, IntoDynNode, Template, TemplateAttribute, TemplateNode, VNode,
    };
    use dioxus_ssr::Renderer;
    use std::fs;
    use std::path::Path;

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

    fn rendered(page: impl Fn() -> Element) -> [String; 2] {
        let mut hydratable = Renderer::new();
        hydratable.pre_render = true;
        [
            Renderer::new().render_element(page()),
            hydratable.render_element(page()),
        ]
    }

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
            "Nullable" => nullable,
        };
        assert!(checked >= 50, "only {checked} fixtures were found");
    }
}
