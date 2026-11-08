use super::*;

static UNEVALUABLE: &[Locale] = &[Locale {
    name: "en",
    messages: &[
        (
            "apples",
            Message {
                cases: &[
                    &[Part::Text("none")],
                    &[Part::Text("one")],
                    &[Part::Text("many")],
                ],
            },
        ),
        (
            "linked",
            Message {
                cases: &[&[
                    Part::Text("x "),
                    Part::Linked {
                        key: "apples",
                        modifier: Some("upper"),
                    },
                    Part::Text(" y"),
                ]],
            },
        ),
        (
            "loop",
            Message {
                cases: &[&[
                    Part::Text("x"),
                    Part::Linked {
                        key: "loop",
                        modifier: None,
                    },
                ]],
            },
        ),
    ],
}];

#[test]
fn a_cycle_of_linked_messages_ends_with_the_key_once_nested_too_deep() {
    let i18n = I18n::new(UNEVALUABLE, "en", &[]);
    let out = i18n.t("loop", &Args::default());
    assert_eq!(
        out,
        format!("{}loop", "x".repeat(33)),
        "the message and 32 links"
    );
}

#[test]
fn a_fraction_that_chooses_no_case_is_returned_where_vue_i18n_throws() {
    let i18n = I18n::new(UNEVALUABLE, "en", &[]);
    for (count, chosen) in [
        (1.5, Err(1.5)),
        (0.5, Err(0.5)),
        (-1.5, Err(-1.5)),
        (1e-300, Err(1e-300)),
        (2.5, Ok("many")),
        (-2.5, Ok("many")),
        (-0.0, Ok("none")),
    ] {
        let named = [("count", Value::Float(count))];
        let args = Args::new().with_named(&named);
        assert_eq!(
            i18n.try_t("apples", &args),
            chosen.map(str::to_owned),
            "{count}"
        );
    }
}

#[test]
fn a_linked_message_that_chooses_no_case_is_written_as_its_key() {
    let named = [("n", Value::Float(0.5))];
    let args = Args::new().with_named(&named);
    let i18n = I18n::new(UNEVALUABLE, "en", &[]);
    assert_eq!(i18n.try_t("linked", &args), Ok("x APPLES y".to_owned()));
}

#[test]
#[should_panic(expected = "`t(\"apples\")` with a plural number of 1.5, which chooses none")]
fn t_panics_where_a_fraction_chooses_no_case() {
    let named = [("count", Value::Float(1.5))];
    let _ = I18n::new(UNEVALUABLE, "en", &[]).t("apples", &Args::new().with_named(&named));
}

#[test]
fn the_plural_case_is_the_one_vue_i18n_chooses() {
    let cases = [
        (0.0, Some(1), Some(0)),
        (-0.0, Some(1), Some(0)),
        (1.0, Some(0), Some(1)),
        (-1.0, Some(0), Some(1)),
        (2.0, Some(1), Some(2)),
        (3.0, Some(1), Some(2)),
        (0.5, Some(1), None),
        (-0.5, Some(1), None),
        (1.5, Some(1), None),
        (2.5, Some(1), Some(2)),
        (f64::INFINITY, Some(1), Some(2)),
        (f64::NEG_INFINITY, Some(1), Some(2)),
        (f64::NAN, Some(1), None),
    ];
    for (choice, two, three) in cases {
        assert_eq!(plural_index(choice, 2), two, "{choice} of two cases");
        assert_eq!(plural_index(choice, 3), three, "{choice} of three cases");
    }
    for count in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let named = [("count", Value::Float(count)), ("n", Value::Float(0.5))];
        let given = |plural| Args {
            named: &named[..1],
            plural,
            ..Args::default()
        };
        assert_eq!(plural_choice(&given(None)), -1.0);
        assert_eq!(plural_choice(&given(Some(5))), 5.0);
        let args = Args {
            named: &named,
            ..Args::default()
        };
        assert_eq!(plural_choice(&args), 0.5);
    }
}
