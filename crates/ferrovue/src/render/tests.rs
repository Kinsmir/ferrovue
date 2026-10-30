use super::*;

#[test]
fn an_integer_within_i64_is_held_exactly() {
    assert_eq!(try_int(0.0).ok(), Some(0));
    assert_eq!(try_int(-0.0).ok(), Some(0));
    assert_eq!(
        try_int(9_007_199_254_740_993.0).ok(),
        Some(9_007_199_254_740_992)
    );
    assert_eq!(try_int(-9_223_372_036_854_775_808.0).ok(), Some(i64::MIN));
    assert_eq!(
        try_int(9_223_372_036_854_774_784.0).ok(),
        Some(9_223_372_036_854_774_784)
    );
}

#[test]
fn an_integer_beyond_i64_or_a_fraction_is_refused() {
    for x in [
        9_223_372_036_854_775_808.0,
        -9.3e18,
        1.6e19,
        1.5,
        f64::NAN,
        f64::INFINITY,
    ] {
        let refused = try_int(x).unwrap_err();
        assert_eq!(refused.code(), "FV0724", "{x}");
        assert_eq!(refused.component(), None);
        assert_eq!(refused.line(), None);
    }
    let refused = try_int(1.6e19).unwrap_err();
    assert!(
        refused
            .message()
            .starts_with("the number 16000000000000000000 is beyond the range of i64"),
        "{refused}"
    );
    for held in [
        "a child's `number` prop",
        "an index",
        "a range's count",
        "a `computed`",
        "`.reduce()`",
    ] {
        assert!(refused.message().contains(held), "{held}: {refused}");
    }
}

#[test]
fn a_kept_refusal_is_located_in_the_component() {
    let refusals = Refusals::new("Total", "components/Total.vue");
    assert_eq!(refusals.keep(try_int(2.0), 4, 7), 2);
    assert_eq!(refusals.keep(try_int(1e20), 4, 7), 0);
    let refused = refusals.check(Ok(())).unwrap_err();
    assert_eq!(refused.component(), Some("Total"));
    assert_eq!(refused.file(), Some("components/Total.vue"));
    assert_eq!((refused.line(), refused.column()), (Some(4), Some(7)));
    assert!(
        refused.to_string().starts_with(
            "error[FV0724]: components/Total.vue:4:7: the number 100000000000000000000 "
        ),
        "{refused}"
    );
    assert!(refusals.check(Ok(())).is_ok());
}

#[test]
fn the_first_refusal_met_is_the_one_returned() {
    let child = Refusals::new("Child", "Child.vue");
    let parent = Refusals::new("Parent", "Parent.vue");
    let early = try_int(1e20).unwrap_err();
    let late = try_int(2e20).unwrap_err();
    parent.keep(Err::<i64, _>(late), 9, 1);
    let returned = child.check(Err(early.located("Child", "Child.vue", 2, 3)));
    let refused = parent.check(returned).unwrap_err();
    assert_eq!(refused.component(), Some("Child"));
    assert_eq!(refused.line(), Some(2));

    let parent = Refusals::new("Parent", "Parent.vue");
    let early = try_int(1e20).unwrap_err();
    let late = try_int(2e20).unwrap_err();
    parent.keep(Err::<i64, _>(early), 9, 1);
    parent.keep(Err::<i64, _>(late), 10, 1);
    parent.join(Err(try_int(3e20).unwrap_err()));
    let refused = parent.check(Ok(())).unwrap_err();
    assert_eq!(refused.line(), Some(9));
}

#[test]
fn a_child_keeps_its_own_location() {
    let parent = Refusals::new("Parent", "Parent.vue");
    let located = try_int(1e20)
        .unwrap_err()
        .located("Child", "Child.vue", 2, 3);
    parent.join(Err(located));
    let refused = parent.check(Ok(())).unwrap_err();
    assert_eq!(
        (refused.component(), refused.line()),
        (Some("Child"), Some(2))
    );
}

#[test]
fn rendered_panics_with_the_message() {
    let refused = try_int(1e20).unwrap_err();
    let message = refused.to_string();
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let caught = std::panic::catch_unwind(|| rendered(Err(refused))).unwrap_err();
    std::panic::set_hook(hook);
    assert_eq!(caught.downcast_ref::<String>(), Some(&message));
    rendered(Ok(()));
}

#[test]
fn a_date_its_type_cannot_hold_is_refused_and_the_epoch_kept() {
    struct Year2k(f64);
    impl JsTime for Year2k {
        fn time_value(&self) -> f64 {
            self.0
        }
        fn from_time_value(t: f64) -> Option<Self> {
            (t >= 0.0).then_some(Year2k(t))
        }
    }
    let refusals = Refusals::new("Post", "Post.vue");
    assert_eq!(refusals.date::<Year2k>(5.0, 1, 1).0, 5.0);
    assert_eq!(refusals.date::<Year2k>(-5.0, 3, 9).0, 0.0);
    let refused = refusals.check(Ok(())).unwrap_err();
    assert_eq!(refused.code(), "FV1812");
    assert_eq!(refused.line(), Some(3));
}

#[test]
fn a_column_is_given_only_with_its_line() {
    let at = |line, column| {
        let refusals = Refusals::new("Total", "Total.vue");
        refusals.keep(try_int(1e20), line, column);
        let refused = refusals.check(Ok(())).unwrap_err();
        (refused.line(), refused.column())
    };
    assert_eq!(at(4, 7), (Some(4), Some(7)));
    assert_eq!(at(0, 7), (None, None));
    assert_eq!(at(4, 0), (Some(4), None));
    assert_eq!(at(0, 0), (None, None));
}

#[test]
fn of_two_copies_of_one_refusal_the_one_held_is_returned() {
    let parent = Refusals::new("Parent", "Parent.vue");
    let refused = try_int(1e20).unwrap_err();
    parent.keep(Err::<i64, _>(refused.clone()), 9, 1);
    let returned = parent
        .check(Err(refused.located("Child", "Child.vue", 2, 3)))
        .unwrap_err();
    assert_eq!(
        (returned.component(), returned.line()),
        (Some("Parent"), Some(9))
    );
}

#[test]
fn debug_shows_the_code_message_and_location() {
    let refusals = Refusals::new("Total", "components/Total.vue");
    assert_eq!(
        format!("{refusals:?}"),
        r#"Refusals { component: "Total", file: "components/Total.vue", .. }"#
    );
    refusals.keep(try_int(1.5), 4, 7);
    let refused = refusals.check(Ok(())).unwrap_err();
    assert_eq!(
        format!("{refused:?}"),
        format!(
            r#"Refused {{ code: "FV0724", message: {:?}, component: Some("Total"), file: Some("components/Total.vue"), line: Some(4), column: Some(7) }}"#,
            refused.message()
        )
    );
}

mod slots {
    use super::*;
    use crate::page::{hole, split_holes};

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
}
