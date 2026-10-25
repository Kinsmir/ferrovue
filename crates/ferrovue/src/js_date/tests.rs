use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::*;
use crate::dates::js_date_parse;

#[derive(Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Props {
    #[serde(with = "date_prop")]
    posted: JsDate,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "opt_date_prop"
    )]
    edited: Option<JsDate>,
    #[serde(default, with = "opt_date_prop")]
    deleted: Option<JsDate>,
}

#[test]
fn parse_reads_what_js_date_parse_reads_and_refuses_the_rest() {
    let vectors: Vec<(String, String, serde_json::Value)> =
        serde_json::from_str(include_str!("../../tests/vectors/dates.json")).expect("date vectors");
    let mut read = 0;
    for (op, input, want) in vectors.iter().filter(|(op, _, _)| op == "parse") {
        let parsed = JsDate::parse(input);
        if want.is_null() {
            assert_eq!(
                parsed, None,
                "{op}({input:?}) is outside the portable format"
            );
        } else {
            read += 1;
            let t = js_date_parse(input);
            assert_eq!(parsed, Some(JsDate::from_millis(t)), "{input:?}");
            assert_eq!(parsed.map(JsDate::is_valid), Some(!t.is_nan()), "{input:?}");
        }
    }
    assert!(read >= 1000, "{read} portable strings");
}

#[test]
fn from_millis_is_new_date_of_a_number() {
    assert_eq!(JsDate::from_millis(1.9).time_value(), 1.0);
    assert_eq!(JsDate::from_millis(-1.9).time_value(), -1.0);
    assert!(JsDate::from_millis(-0.0).time_value().is_sign_positive());
    assert_eq!(JsDate::from_millis(8.64e15).time_value(), 8.64e15);
    assert_eq!(JsDate::from_millis(-8.64e15).time_value(), -8.64e15);
    for beyond in [8.64e15 + 1.0, -8.64e15 - 1.0, f64::INFINITY, f64::NAN] {
        assert!(!JsDate::from_millis(beyond).is_valid(), "{beyond}");
    }
    assert_eq!(JsDate::UNIX_EPOCH, JsDate::from_millis(0.0));
    assert_eq!(JsDate::INVALID.to_iso_string(), None);
}

#[test]
fn an_invalid_date_equals_another_and_hashes_alike() {
    assert_eq!(JsDate::INVALID, JsDate::from_millis(f64::NAN));
    assert_ne!(JsDate::INVALID, JsDate::UNIX_EPOCH);
    let set: HashSet<JsDate> = [
        JsDate::INVALID,
        JsDate::from_millis(9e15),
        JsDate::UNIX_EPOCH,
        JsDate::from_millis(0.5),
    ]
    .into_iter()
    .collect();
    assert_eq!(set.len(), 2);
    let hash = |date: JsDate| {
        let mut hasher = std::hash::DefaultHasher::new();
        date.hash(&mut hasher);
        hasher.finish()
    };
    assert_eq!(hash(JsDate::INVALID), hash(JsDate::from_millis(-9e15)));
    assert_eq!(
        hash(JsDate::INVALID),
        hash(JsDate::parse("+275761-01-01").unwrap())
    );
    assert_eq!(hash(JsDate::UNIX_EPOCH), hash(JsDate::from_millis(-0.5)));
    assert_ne!(hash(JsDate::UNIX_EPOCH), hash(JsDate::from_millis(1.0)));
    assert_eq!(format!("{:?}", JsDate::INVALID), "JsDate(Invalid Date)");
    assert_eq!(
        format!("{:?}", JsDate::UNIX_EPOCH),
        "JsDate(1970-01-01T00:00:00.000Z)"
    );
}

#[test]
fn a_system_time_is_floored_to_the_millisecond() {
    assert_eq!(JsDate::from(UNIX_EPOCH), JsDate::UNIX_EPOCH);
    let at = |nanos: i64| {
        let d = Duration::from_nanos(nanos.unsigned_abs());
        JsDate::from(if nanos < 0 {
            UNIX_EPOCH - d
        } else {
            UNIX_EPOCH + d
        })
        .time_value()
    };
    assert_eq!(at(1), 0.0);
    assert_eq!(at(1_999_999), 1.0);
    assert_eq!(at(-1), -1.0);
    assert_eq!(at(-1_000_000), -1.0);
    assert_eq!(at(-1_000_001), -2.0);
    let far = UNIX_EPOCH + Duration::from_millis(8_640_000_000_000_001);
    assert!(!JsDate::from(far).is_valid());
    let now = JsDate::now().time_value();
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    assert!(now <= elapsed.as_millis() as f64 && now > 1.7e12, "{now}");
}

#[test]
fn serde_writes_the_iso_string_and_reads_strings_and_numbers() {
    let posted = JsDate::parse("+010000-01-01T00:00:00.000Z").unwrap();
    assert_eq!(
        serde_json::to_string(&posted).unwrap(),
        r#""+010000-01-01T00:00:00.000Z""#
    );
    assert_eq!(serde_json::to_string(&JsDate::INVALID).unwrap(), "null");
    assert_eq!(crate::json::to_string(&JsDate::INVALID), "NaN");
    let read = |json: &str| serde_json::from_str::<JsDate>(json);
    assert_eq!(read(r#""+010000-01-01T00:00:00.000Z""#).unwrap(), posted);
    assert_eq!(
        read(r#""2024-05-01""#).unwrap().time_value(),
        1_714_521_600_000.0
    );
    assert_eq!(read("-1").unwrap().time_value(), -1.0);
    assert_eq!(read("1.5").unwrap().time_value(), 1.0);
    assert_eq!(read("8640000000000001").unwrap(), JsDate::INVALID);
    assert_eq!(read(r#""+275761-01-01""#).unwrap(), JsDate::INVALID);
    let refused = read(r#""2024-05-01T09:30""#).unwrap_err().to_string();
    assert!(refused.contains("date time string format"), "{refused}");
    let wrong = read("true").unwrap_err().to_string();
    assert!(wrong.contains("expected a date in ECMAScript's date time string format with a time zone, or a number of milliseconds"), "{wrong}");
    assert!(read("null").is_err());
}

#[test]
fn every_date_reads_back_as_itself() {
    for t in [
        -8.64e15,
        -62_198_755_200_001.0,
        -1.0,
        0.0,
        1e12,
        8.64e15,
        f64::NAN,
    ] {
        let date = JsDate::from_millis(t);
        let json = crate::json::to_string(&date);
        let read: JsDate = if date.is_valid() {
            serde_json::from_str(&json).unwrap()
        } else {
            assert_eq!(json, "NaN");
            JsDate::from_millis(f64::NAN)
        };
        assert_eq!(read, date, "{json}");
    }
}

#[test]
fn a_props_struct_writes_its_dates_as_an_island_does() {
    let props = Props {
        posted: JsDate::from_millis(0.0),
        edited: None,
        deleted: Some(JsDate::INVALID),
    };
    assert_eq!(
        crate::json::to_string(&props),
        r#"{"posted":"1970-01-01T00:00:00.000Z","deleted":NaN}"#
    );
    let edited = Props {
        edited: Some(JsDate::from_millis(1.0)),
        deleted: None,
        ..props
    };
    let json = crate::json::to_string(&edited);
    assert_eq!(
        json,
        r#"{"posted":"1970-01-01T00:00:00.000Z","edited":"1970-01-01T00:00:00.001Z","deleted":null}"#
    );
    assert_eq!(serde_json::from_str::<Props>(&json).unwrap(), edited);
    let read: Props = serde_json::from_str(r#"{"posted":86400000}"#).unwrap();
    assert_eq!(read.posted, JsDate::parse("1970-01-02").unwrap());
    assert_eq!((read.edited, read.deleted), (None, None));
    assert!(serde_json::from_str::<Props>(r#"{"posted":"1970-01-02T00:00"}"#).is_err());
}

#[test]
fn a_child_prop_takes_any_date_a_js_date_holds() {
    let date: JsDate = js_date_prop(f64::NAN);
    assert_eq!(date, JsDate::INVALID);
    let date: JsDate = js_date_prop(1.0);
    assert_eq!(date.time_value(), 1.0);
}

#[cfg(feature = "chrono")]
mod chrono_dates {
    use chrono::{DateTime, TimeDelta, Utc};

    use super::*;

    fn panics<T>(run: impl FnOnce() -> T + std::panic::UnwindSafe) -> bool {
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let thrown = std::panic::catch_unwind(run).is_err();
        std::panic::set_hook(hook);
        thrown
    }

    #[test]
    fn every_chrono_date_is_a_js_date_floored_to_the_millisecond() {
        let min = JsDate::from(DateTime::<Utc>::MIN_UTC);
        let max = JsDate::from(DateTime::<Utc>::MAX_UTC);
        assert_eq!(
            min.to_iso_string().as_deref(),
            Some("-262143-01-01T00:00:00.000Z")
        );
        assert_eq!(
            max.to_iso_string().as_deref(),
            Some("+262142-12-31T23:59:59.999Z")
        );
        let before = DateTime::<Utc>::UNIX_EPOCH - TimeDelta::nanoseconds(1);
        assert_eq!(JsDate::from(before).time_value(), -1.0);
        assert_eq!(before.time_value(), -1.0);
        let after = DateTime::<Utc>::UNIX_EPOCH + TimeDelta::nanoseconds(999_999);
        assert_eq!(JsDate::from(after), JsDate::UNIX_EPOCH);
    }

    #[test]
    fn a_js_date_beyond_chrono_is_refused() {
        let edge = |iso: &str| DateTime::<Utc>::try_from(JsDate::parse(iso).unwrap());
        let min = edge("-262143-01-01T00:00:00.000Z").unwrap();
        assert_eq!(min, DateTime::<Utc>::MIN_UTC);
        let max = edge("+262142-12-31T23:59:59.999Z").unwrap();
        assert_eq!(
            JsDate::from(max).time_value(),
            JsDate::from(DateTime::<Utc>::MAX_UTC).time_value()
        );
        for beyond in [
            "-262144-12-31T23:59:59.999Z",
            "+262143-01-01T00:00:00.000Z",
            "-271821-04-20T00:00:00.000Z",
            "+275760-09-13T00:00:00.000Z",
        ] {
            let refused = edge(beyond).unwrap_err();
            assert_eq!(refused.date(), JsDate::parse(beyond).unwrap());
            assert_eq!(
                refused.to_string(),
                format!("{beyond} is beyond the dates chrono holds")
            );
            assert!(DateTime::<Utc>::from_time_value(refused.date().time_value()).is_none());
        }
        let invalid = DateTime::<Utc>::try_from(JsDate::INVALID).unwrap_err();
        assert_eq!(invalid.to_string(), "an invalid date has no chrono date");
    }

    #[test]
    fn a_chrono_prop_reads_and_writes_as_a_js_date() {
        #[derive(Debug, PartialEq, serde::Serialize, serde::Deserialize)]
        struct Chrono {
            #[serde(with = "date_prop")]
            posted: DateTime<Utc>,
            #[serde(default, with = "opt_date_prop")]
            deleted: Option<DateTime<Utc>>,
        }
        let json = r#"{"posted":"+010000-01-01T00:00:00.000Z","deleted":null}"#;
        let read: Chrono = serde_json::from_str(json).unwrap();
        assert_eq!(crate::json::to_string(&read), json);
        assert_eq!(read.posted.timestamp_millis(), 253_402_300_800_000);
        let refused = serde_json::from_str::<Chrono>(r#"{"posted":"+270000-01-01"}"#);
        assert!(
            refused
                .unwrap_err()
                .to_string()
                .contains("beyond what the prop's Rust type holds")
        );
        assert!(serde_json::from_str::<Chrono>(r#"{"posted":9e15}"#).is_err());
        let date: DateTime<Utc> = js_date_prop(0.0);
        assert_eq!(date, DateTime::<Utc>::UNIX_EPOCH);
        assert!(panics(|| js_date_prop::<DateTime<Utc>>(f64::NAN)));
        assert!(panics(|| js_date_prop::<DateTime<Utc>>(8.64e15)));
    }
}

#[derive(Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Nested {
    #[serde(with = "dates_in")]
    days: Vec<JsDate>,
    #[serde(with = "dates_in")]
    seen: Vec<Option<JsDate>>,
    #[serde(with = "dates_in")]
    by: crate::record::Record<'static, JsDate>,
    #[serde(default, skip_serializing_if = "Option::is_none", with = "dates_in")]
    maybe: Option<Vec<JsDate>>,
}

#[test]
fn dates_inside_lists_dictionaries_and_optionals_are_written_and_read_as_one_date_is() {
    let nested = Nested {
        days: vec![JsDate::UNIX_EPOCH, JsDate::from_millis(8.64e15)],
        seen: vec![None, Some(JsDate::from_millis(-1.0))],
        by: [("b", JsDate::from_millis(1.0)), ("2", JsDate::UNIX_EPOCH)]
            .into_iter()
            .collect(),
        maybe: None,
    };
    let json = serde_json::to_string(&nested).unwrap();
    assert_eq!(
        json,
        concat!(
            r#"{"days":["1970-01-01T00:00:00.000Z","+275760-09-13T00:00:00.000Z"],"#,
            r#""seen":[null,"1969-12-31T23:59:59.999Z"],"by":{"2":"1970-01-01T00:00:00.000Z","b":"1970-01-01T00:00:00.001Z"}}"#
        )
    );
    assert_eq!(serde_json::from_str::<Nested>(&json).unwrap(), nested);
    let read: Nested = serde_json::from_str(
        r#"{"days":[0,"2024-05-01T09:30+02:00"],"seen":[],"by":{},"maybe":["+275761-01-01"]}"#,
    )
    .unwrap();
    assert_eq!(read.days[1], JsDate::parse("2024-05-01T07:30Z").unwrap());
    assert_eq!(read.maybe, Some(vec![JsDate::INVALID]));
    let wrong = serde_json::from_str::<Nested>(r#"{"days":["May 1"],"seen":[],"by":{}}"#);
    assert!(
        wrong
            .unwrap_err()
            .to_string()
            .contains("is not in ECMAScript's date time string format")
    );
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Whole(i64);

impl JsTime for Whole {
    fn time_value(&self) -> f64 {
        self.0 as f64
    }

    fn from_time_value(t: f64) -> Option<Whole> {
        (t.is_finite() && t >= 0.0).then_some(Whole(t as i64))
    }
}

#[derive(Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Owned {
    #[serde(with = "dates_in")]
    days: Vec<Option<Whole>>,
}

#[test]
fn a_date_type_of_its_own_is_written_as_a_jsdate_and_refused_where_it_cannot_hold_the_date() {
    let owned = Owned {
        days: vec![Some(Whole(1)), None],
    };
    assert_eq!(
        serde_json::to_string(&owned).unwrap(),
        r#"{"days":["1970-01-01T00:00:00.001Z",null]}"#
    );
    assert_eq!(
        serde_json::from_str::<Owned>(r#"{"days":[1,null]}"#).unwrap(),
        owned
    );
    let refused = serde_json::from_str::<Owned>(r#"{"days":[-1]}"#).unwrap_err();
    assert!(refused.to_string().contains(
        "the date JsDate(1969-12-31T23:59:59.999Z) is beyond what the prop's Rust type holds"
    ));
}
