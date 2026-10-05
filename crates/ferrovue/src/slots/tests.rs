use super::*;

/// `tests/vectors/comment.json`, recorded from `ssrRenderSlot`'s `isComment` on the TypeScript side.
#[test]
fn is_comment_is_what_ssr_render_slot_reads_as_nothing() {
    let vectors: Vec<(String, bool)> =
        serde_json::from_str(include_str!("../../tests/vectors/comment.json"))
            .expect("comment vectors");
    assert!(vectors.len() >= 20, "the vectors were not all read");
    for (chunk, want) in &vectors {
        assert_eq!(is_comment(chunk), *want, "isComment({chunk:?})");
    }
}

#[test]
fn content_a_caller_supplies_is_never_replaced_by_the_fallback() {
    let comment = |out: &mut String| out.push_str("<!---->");
    let mut out = String::new();
    slot_into(
        &mut out,
        Some(Slot::new(&comment)),
        Some(&mut |out: &mut String| out.push_str("fallback")),
    );
    assert_eq!(out, "<!--[--><!----><!--]-->");
}

#[test]
fn generated_content_of_comments_alone_gives_way_to_the_fallback() {
    let nothing = |out: &mut String| {
        out.push_str("<!---->");
        false
    };
    let mut out = String::new();
    slot_into(
        &mut out,
        Some(Slot::markup(&nothing)),
        Some(&mut |out: &mut String| out.push_str("fallback")),
    );
    assert_eq!(out, "<!--[-->fallback<!--]-->");
}

#[test]
fn generated_content_of_comments_alone_is_dropped_when_there_is_no_fallback() {
    let nothing = |out: &mut String| {
        out.push_str("<!---->");
        false
    };
    let mut out = String::new();
    let filled = slot_into(&mut out, Some(Slot::markup(&nothing)), None);
    assert!(!filled);
    assert_eq!(out, "<!--[--><!--]-->");
}

struct RowProps<'v> {
    label: &'v str,
}

#[test]
fn a_scoped_slot_is_given_the_outlets_props() {
    let content = |out: &mut String, p: &RowProps<'_>| {
        out.push_str(p.label);
        true
    };
    let slot: &dyn for<'v> Fn(&mut String, &RowProps<'v>) -> bool = &content;
    let mut out = String::new();
    let label = String::from("row one");
    assert!(scoped_slot_into(
        &mut out,
        Some(slot),
        &RowProps { label: &label },
        None
    ));
    assert_eq!(out, "<!--[-->row one<!--]-->");
}

#[test]
fn a_scoped_slot_of_comments_alone_or_none_gives_way_to_the_fallback() {
    let nothing = |out: &mut String, _: &RowProps<'_>| {
        out.push_str("<!---->");
        false
    };
    let slot: &dyn for<'v> Fn(&mut String, &RowProps<'v>) -> bool = &nothing;
    for given in [Some(slot), None] {
        let mut out = String::new();
        let filled = scoped_slot_into(
            &mut out,
            given,
            &RowProps { label: "x" },
            Some(&mut |out: &mut String| out.push_str("fallback")),
        );
        assert!(!filled);
        assert_eq!(out, "<!--[-->fallback<!--]-->");
    }
}

#[test]
fn slot_content_is_given_the_slot_scope_id_after_a_space() {
    let content = |out: &mut String, id: &str| {
        out.push_str("<p");
        out.push_str(id);
        out.push_str(">x</p>");
        true
    };
    let mut out = String::new();
    assert!(slot_into_slotted(
        &mut out,
        Some(Slot::slotted(&content)),
        "data-v-a-s",
        None
    ));
    assert_eq!(out, "<!--[--><p data-v-a-s>x</p><!--]-->");
    // No id, and content that takes none, which ignores it.
    out.clear();
    slot_into_slotted(&mut out, Some(Slot::slotted(&content)), "", None);
    let plain = |out: &mut String| out.push_str("<i>y</i>");
    slot_into_slotted(&mut out, Some(Slot::new(&plain)), "data-v-a-s", None);
    assert_eq!(out, "<!--[--><p>x</p><!--]--><!--[--><i>y</i><!--]-->");

    let row = |out: &mut String, p: &RowProps<'_>, id: &str| {
        out.push_str(p.label);
        out.push_str(id);
        true
    };
    let slot: &dyn for<'v> Fn(&mut String, &RowProps<'v>, &str) -> bool = &row;
    out.clear();
    scoped_slot_into_slotted(
        &mut out,
        Some(slot),
        &RowProps { label: "r" },
        "data-v-b-s  data-v-c-s",
        None,
    );
    assert_eq!(out, "<!--[-->r data-v-b-s  data-v-c-s<!--]-->");
}

#[test]
fn an_absent_slot_writes_its_fallback_or_nothing() {
    let mut out = String::new();
    assert!(!slot_into(&mut out, None, None));
    assert_eq!(out, "<!--[--><!--]-->");
    out.clear();
    assert!(!slot_into(
        &mut out,
        None,
        Some(&mut |out: &mut String| out.push_str("fallback"))
    ));
    assert_eq!(out, "<!--[-->fallback<!--]-->");
}

#[test]
fn a_render_without_holes_is_one_piece() {
    assert_eq!(split_holes("<a></a>"), ["<a></a>"]);
    assert_eq!(split_holes(""), [""]);
}

#[test]
fn holes_cut_a_render_where_the_caller_writes_later() {
    let mut out = String::new();
    out.push_str("<a>");
    slot_into(&mut out, Some(hole()), None);
    out.push_str("<b>");
    slot_into(
        &mut out,
        Some(hole()),
        Some(&mut |out: &mut String| out.push_str("fallback")),
    );
    out.push_str("</b></a>");
    assert_eq!(
        split_holes(&out),
        ["<a><!--[-->", "<!--]--><b><!--[-->", "<!--]--></b></a>"]
    );
}

#[test]
fn a_slot_shows_in_debug() {
    let body = |out: &mut String| out.push_str("<p>x</p>");
    assert_eq!(format!("{:?}", Slot::new(&body)), "Slot { .. }");
    assert_eq!(format!("{:?}", hole()), "Slot { .. }");
    assert_eq!(format!("{:?}", Some(Slot::new(&body))), "Some(Slot { .. })");
}
