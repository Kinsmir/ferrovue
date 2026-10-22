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
#[cfg(debug_assertions)]
#[should_panic(expected = "chooses none of the cases")]
fn a_fraction_that_chooses_no_case_fails_a_debug_render() {
    let named = [("count", Value::Float(1.5))];
    let args = Args {
        named: &named,
        ..Args::default()
    };
    let _ = I18n::new(UNEVALUABLE, "en", &[]).t("apples", &args);
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
