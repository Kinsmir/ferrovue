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
