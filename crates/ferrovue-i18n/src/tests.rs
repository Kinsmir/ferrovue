use super::*;

/// Messages that vue-i18n cannot evaluate at all: it overflows its stack on a cycle, and throws on
/// a plural number that chooses no case. The rest of `t()` is held to vue-i18n by the conformance
/// components `Translated` and `Plurals`.
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

/// vue-i18n throws on `t("apples", { count: 1.5 })` with three cases; a debug build fails the
/// render the same way.
#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "chooses none of the cases")]
fn a_fraction_that_chooses_no_case_fails_a_debug_render() {
    let named = [("count", Value::Float(1.5))];
    let args = Args {
        named: &named,
        ..Args::default()
    };
    I18n::new(UNEVALUABLE, "en", &[]).t("apples", &args);
}
