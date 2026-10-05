//! Components compiled with `"builders": false`, whose props are built as struct literals.

#[rustfmt::skip]
#[path = "literal_props/generated/mod.rs"]
#[allow(missing_docs)]
pub mod generated;

use generated::{badge, card, types};

#[test]
fn props_built_as_struct_literals_render() {
    let props = card::Props {
        title: "Notes & <drafts>".into(),
        owner: types::Owner {
            name: "Ada".into(),
            email: Some("ada@example.com".into()),
        },
        tags: vec![
            types::Tag {
                label: "a".into(),
                hint: None,
            },
            types::Tag {
                label: "b".into(),
                hint: Some("second".into()),
            },
        ],
        note: None,
    };
    let mut out = String::new();
    card::render(&mut out, &props);
    assert_eq!(
        out,
        concat!(
            "<article><h2>Notes &amp; &lt;drafts&gt;</h2>",
            r#"<p>Ada<a href="mailto:ada@example.com">ada@example.com</a></p>"#,
            r#"<ul><!--[--><li>a</li><li title="second">b</li><!--]--></ul><!---->"#,
            r#"<span class="badge">new<b>2</b></span></article>"#,
        )
    );
}

#[test]
fn a_struct_with_no_required_field_still_derives_default() {
    let mut out = String::new();
    badge::render(
        &mut out,
        &badge::Props {
            count: Some(3),
            ..Default::default()
        },
    );
    assert_eq!(out, r#"<span class="badge">new<b>3</b></span>"#);
}
