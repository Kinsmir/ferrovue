use super::*;

#[test]
fn a_record_keeps_javascripts_order_of_keys() {
    let vectors: Vec<(String, Vec<String>)> =
        serde_json::from_str(include_str!("../../tests/vectors/keys.json")).expect("key vectors");
    assert!(vectors.len() >= 8, "the vectors were not all read");
    for (json, want) in &vectors {
        let record: Record<'_, i64> = serde_json::from_str(json).expect("a record");
        assert_eq!(record.keys().collect::<Vec<_>>(), *want, "{json}");
        let again: Record<'_, i64> =
            serde_json::from_str(&serde_json::to_string(&record).unwrap()).unwrap();
        assert_eq!(again, record);
    }
}

#[test]
fn a_record_takes_the_last_value_of_a_repeated_key_in_its_first_place() {
    let record: Record<'_, &str> = [("a", "1"), ("b", "2"), ("a", "3")].into_iter().collect();
    assert_eq!(
        record.iter().collect::<Vec<_>>(),
        [("a", &"3"), ("b", &"2")]
    );
    assert_eq!(record.len(), 2);
    assert!(Record::<'_, i64>::new().is_empty());
}

#[test]
fn a_record_with_an_entry_is_not_empty() {
    let record: Record<'_, i64> = [("a", 1)].into_iter().collect();
    assert!(!record.is_empty());
}

#[test]
fn a_record_read_from_anything_but_an_object_is_an_error_expecting_an_object() {
    let error = serde_json::from_str::<Record<'_, i64>>("[1]").unwrap_err();
    assert_eq!(
        error.to_string(),
        "invalid type: sequence, expected an object at line 1 column 0"
    );
}

mod union {
    use super::*;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Tone {
        Warm,
        Cool,
    }

    impl Union for Tone {
        const ALL: &'static [Self] = &[Tone::Warm, Tone::Cool];

        fn as_str(self) -> &'static str {
            match self {
                Tone::Warm => "<warm & \"w\">",
                Tone::Cool => "cool",
            }
        }
    }

    #[derive(Debug, serde::Serialize, serde::Deserialize, PartialEq)]
    struct Props {
        #[serde(with = "union_prop")]
        tone: Tone,
        #[serde(default, skip_serializing_if = "Option::is_none", with = "union_prop")]
        picked: Option<Tone>,
        #[serde(with = "union_prop")]
        tones: Vec<Tone>,
        #[serde(with = "union_prop")]
        maybe: Vec<Option<Tone>>,
    }

    #[test]
    fn a_union_value_is_written_and_read_as_its_literal_alone_optional_and_in_lists() {
        let props = Props {
            tone: Tone::Warm,
            picked: Some(Tone::Cool),
            tones: vec![Tone::Cool, Tone::Warm],
            maybe: vec![None, Some(Tone::Warm)],
        };
        let json = serde_json::to_string(&props).unwrap();
        assert_eq!(
            json,
            r#"{"tone":"<warm & \"w\">","picked":"cool","tones":["cool","<warm & \"w\">"],"maybe":[null,"<warm & \"w\">"]}"#
        );
        assert_eq!(serde_json::from_str::<Props>(&json).unwrap(), props);
        let absent: Props =
            serde_json::from_str(r#"{"tone":"cool","tones":[],"maybe":[]}"#).unwrap();
        assert_eq!(absent.picked, None);
        assert_eq!(
            serde_json::to_string(&absent).unwrap(),
            r#"{"tone":"cool","tones":[],"maybe":[]}"#
        );
    }

    #[test]
    fn a_string_outside_the_union_does_not_deserialise() {
        let e =
            serde_json::from_str::<Props>(r#"{"tone":"hot","tones":[],"maybe":[]}"#).unwrap_err();
        assert!(
            e.to_string().starts_with(
                "`hot` is not one of the members of the union: `<warm & \"w\">`, `cool`"
            ),
            "{e}"
        );
        assert!(
            serde_json::from_str::<Props>(r#"{"tone":"cool","tones":["x"],"maybe":[]}"#).is_err()
        );
        assert!(serde_json::from_str::<Props>(r#"{"tone":1,"tones":[],"maybe":[]}"#).is_err());
    }

    #[test]
    fn parse_union_finds_the_value_of_a_literal_and_refuses_another_string() {
        let members = &["<warm & \"w\">", "cool"];
        let cool = Cow::<str>::Owned("cool".to_owned());
        assert_eq!(cool.parse_union::<Tone>("Tone", members), Ok(Tone::Cool));
        let e = "hot".parse_union::<Tone>("Tone", members).unwrap_err();
        assert_eq!(
            e.to_string(),
            "`hot` is not one of the members of `Tone`: `<warm & \"w\">`, `cool`"
        );
    }

    #[test]
    fn check_union_passes_an_enum_that_gives_each_member_its_literal() {
        check_union(
            "Tone",
            &[(Tone::Warm, "<warm & \"w\">"), (Tone::Cool, "cool")],
        );
    }

    #[test]
    #[should_panic(
        expected = "`Tone` gives `Cool` the literal `cool`, and the union's member is `Cool`: return `Cool` from `as_str` for it"
    )]
    fn check_union_refuses_another_literal() {
        check_union(
            "Tone",
            &[(Tone::Warm, "<warm & \"w\">"), (Tone::Cool, "Cool")],
        );
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Short {
        A,
        B,
    }

    impl Union for Short {
        const ALL: &'static [Self] = &[Short::A, Short::A];

        fn as_str(self) -> &'static str {
            match self {
                Short::A => "a",
                Short::B => "b",
            }
        }
    }

    #[test]
    #[should_panic(expected = "`Short::ALL` holds `A` 2 times: list each value once")]
    fn check_union_refuses_a_value_listed_twice() {
        check_union("Short", &[(Short::A, "a"), (Short::B, "b")]);
    }

    #[test]
    #[should_panic(expected = "`Short::ALL` holds `B` 0 times: list each value once")]
    fn check_union_refuses_a_value_left_out() {
        check_union("Short", &[(Short::B, "b")]);
    }

    #[test]
    #[should_panic(expected = "`Short::ALL` holds 2 values, and the union has 0 members")]
    fn check_union_refuses_more_values_than_members() {
        check_union::<Short>("Short", &[]);
    }
}
