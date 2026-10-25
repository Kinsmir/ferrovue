//! The conformance suite's union components compiled with `unions`, which names enums of the
//! test's own for `Align`, `Hue`, `Level` and `Shade`, rendering the fixtures Vue recorded.

#[rustfmt::skip]
#[path = "own_unions/generated/mod.rs"]
#[allow(missing_docs)]
pub mod generated;

use std::fs;
use std::path::Path;

use ferrovue::union::Union;
use generated::{union_list_item, union_shade, union_types};

/// Enums an application keeps beside its domain, each implementing `ferrovue::union::Union`.
pub mod domain {
    use ferrovue::union::Union;

    /// `Align`, its variants in an order of its own.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub enum Align {
        /// `"right"`
        Right,
        /// `"left"`
        Left,
        /// `"center"`
        Center,
    }

    impl Union for Align {
        const ALL: &'static [Self] = &[Align::Right, Align::Left, Align::Center];

        fn as_str(self) -> &'static str {
            match self {
                Align::Left => "left",
                Align::Center => "center",
                Align::Right => "right",
            }
        }
    }

    impl Align {
        /// A method of the application's own of the same name, which generated code leaves alone.
        #[must_use]
        pub fn as_str(self) -> &'static str {
            "unused"
        }
    }

    /// `Level`, a string `enum` in TypeScript.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Level {
        /// `"low"`
        Low,
        /// `"high"`
        High,
    }

    impl Union for Level {
        const ALL: &'static [Self] = &[Level::Low, Level::High];

        fn as_str(self) -> &'static str {
            match self {
                Level::Low => "low",
                Level::High => "high",
            }
        }
    }

    /// `Hue`, which props hold in lists.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Hue {
        /// `"red"`
        Red,
        /// `"green"`
        Green,
        /// `"<b>&\"hue'"`
        BHue,
    }

    impl Union for Hue {
        const ALL: &'static [Self] = &[Hue::Red, Hue::Green, Hue::BHue];

        fn as_str(self) -> &'static str {
            match self {
                Hue::Red => "red",
                Hue::Green => "green",
                Hue::BHue => "<b>&\"hue'",
            }
        }
    }

    /// `Shade`, one of whose literals holds markup.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Shade {
        /// `"warm"`
        Warm,
        /// `"x-cool"`
        XCool,
        /// `"<b>&'q'\""`
        BQ,
    }

    impl Union for Shade {
        const ALL: &'static [Self] = &[Shade::Warm, Shade::XCool, Shade::BQ];

        fn as_str(self) -> &'static str {
            match self {
                Shade::Warm => "warm",
                Shade::XCool => "x-cool",
                Shade::BQ => "<b>&'q'\"",
            }
        }
    }
}

#[test]
fn every_fixture_renders_as_vue_rendered_it_with_the_applications_own_enums() {
    let mut rendered = Vec::new();
    for component in [
        "UnionTypes",
        "UnionShade",
        "UnionEnums",
        "UnionChild",
        "UnionObjects",
        "UnionStep",
        "UnionList",
        "UnionListItem",
    ] {
        let dir = Path::new("tests/conformance/fixtures").join(component);
        let mut names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .collect();
        names.sort();
        for json in names {
            let case = format!(
                "{component}/{}",
                json.file_stem().unwrap().to_string_lossy()
            );
            let html = generated::render_json(component, &fs::read_to_string(&json).unwrap())
                .unwrap_or_else(|e| panic!("{case}: {e}"));
            let want = fs::read_to_string(json.with_extension("html")).unwrap();
            assert_eq!(html, want, "{case}");
            rendered.push(case);
        }
    }
    assert_eq!(
        rendered,
        [
            "UnionTypes/empty",
            "UnionTypes/hostile",
            "UnionTypes/typical",
            "UnionShade/typical",
            "UnionEnums/empty",
            "UnionEnums/hostile",
            "UnionEnums/typical",
            "UnionChild/typical",
            "UnionObjects/empty",
            "UnionObjects/hostile",
            "UnionObjects/typical",
            "UnionStep/typical",
            "UnionList/empty",
            "UnionList/hostile",
            "UnionList/typical",
            "UnionListItem/hostile",
        ]
    );
}

#[test]
fn a_list_of_the_union_is_a_vec_of_the_applications_enum() {
    let props = union_list_item::Props::new([domain::Hue::BHue, domain::Hue::Red], "<l>")
        .hue(domain::Hue::Green)
        .extra([domain::Hue::Green]);
    let island = union_list_item::island(&props).into_string();
    assert!(
        island.starts_with(r#"<div data-island="UnionListItem" data-props="{&quot;hue&quot;:&quot;green&quot;,&quot;hues&quot;:[&quot;&lt;b&gt;&amp;\&quot;hue&#39;&quot;,&quot;red&quot;],&quot;extra&quot;:[&quot;green&quot;],&quot;label&quot;:&quot;&lt;l&gt;&quot;}">"#),
        "{island}"
    );
}

#[test]
fn data_props_hold_each_value_as_its_literal() {
    let props = union_types::Props::new(domain::Shade::BQ, "<i>")
        .other(domain::Shade::Warm)
        .picked(domain::Shade::XCool);
    let island = union_types::island(&props).into_string();
    assert!(
        island.starts_with(r#"<div data-island="UnionTypes" data-props="{&quot;tone&quot;:&quot;&lt;b&gt;&amp;&#39;q&#39;\&quot;&quot;,&quot;other&quot;:&quot;warm&quot;,&quot;picked&quot;:&quot;x-cool&quot;,&quot;label&quot;:&quot;&lt;i&gt;&quot;}">"#),
        "{island}"
    );
    let none = union_types::Props::new(domain::Shade::Warm, "");
    let island = union_types::island(&none).into_string();
    assert!(
        island.starts_with(r#"<div data-island="UnionTypes" data-props="{&quot;tone&quot;:&quot;warm&quot;,&quot;picked&quot;:null,&quot;label&quot;:&quot;&quot;}">"#),
        "{island}"
    );
}

#[test]
fn a_fixture_holding_a_string_outside_the_union_does_not_deserialise() {
    let e = generated::render_json("UnionShade", r#"{"tone": "hot", "text": ""}"#).unwrap_err();
    assert!(
        e.starts_with(
            "`hot` is not one of the members of the union: `warm`, `x-cool`, `<b>&'q'\"`"
        ),
        "{e}"
    );
}

#[test]
fn a_child_is_handed_the_applications_enum() {
    let mut out = String::new();
    union_shade::render(
        &mut out,
        &union_shade::Props::new(domain::Shade::XCool, "t"),
    );
    assert_eq!(out, r#"<span class="x-cool" data-tone="x-cool">t</span>"#);
    assert_eq!(Union::as_str(domain::Align::Center), "center");
    assert_eq!(domain::Align::Center.as_str(), "unused");
}
