use super::*;
use crate::push_number;

fn shown(x: f64) -> String {
    let mut out = String::new();
    if x == 0.0 && x.is_sign_negative() {
        out.push('-');
    }
    push_number(&mut out, x);
    out
}

fn panics<T>(run: impl FnOnce() -> T + std::panic::UnwindSafe) -> bool {
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let thrown = std::panic::catch_unwind(run).is_err();
    std::panic::set_hook(hook);
    thrown
}

#[test]
fn dates_are_javascripts() {
    let vectors: Vec<(String, String, serde_json::Value)> =
        serde_json::from_str(include_str!("../../tests/vectors/dates.json")).expect("date vectors");
    assert!(vectors.len() >= 4000, "the vectors were not all read");
    let number = |text: &str| -> f64 { text.parse().unwrap_or_else(|_| panic!("{text:?} parses")) };
    let mut accepted = 0;
    let mut refused = 0;
    let mut utc_refused = 0;
    for (op, input, want) in &vectors {
        if op == "parse" {
            if want.is_null() {
                refused += 1;
                assert!(
                    panics(|| js_date_parse(input)),
                    "{input:?} is outside the portable format"
                );
            } else {
                accepted += 1;
                assert_eq!(
                    Some(shown(js_date_parse(input)).as_str()),
                    want.as_str(),
                    "Date.parse({input:?})"
                );
            }
            continue;
        }
        if op == "UTC" {
            let mut parts = [f64::NAN, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0];
            for (part, text) in parts.iter_mut().zip(input.split(',')) {
                *part = number(text);
            }
            let utc = || {
                js_date_utc(
                    parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6],
                )
            };
            if want.is_null() {
                utc_refused += 1;
                assert!(
                    panics(utc),
                    "Date.UTC({input}) is computed differently by each engine"
                );
            } else {
                assert_eq!(
                    Some(shown(utc()).as_str()),
                    want.as_str(),
                    "Date.UTC({input})"
                );
            }
            continue;
        }
        let t = js_time_clip(number(input));
        let text = match op.as_str() {
            "toUTCString" => Some(js_to_utc_string(t)),
            "toJSON" => js_to_json(t),
            "stringify" => Some(js_json_date(t)),
            _ => None,
        };
        if op == "toJSON" || text.is_some() {
            assert_eq!(text.as_deref(), want.as_str(), "{op}({input})");
            continue;
        }
        if op == "toISOString" {
            if want.get("throws").is_some() {
                assert!(
                    panics(|| js_to_iso_string(t)),
                    "toISOString({input}) throws"
                );
            } else {
                assert_eq!(
                    Some(js_to_iso_string(t).as_str()),
                    want.as_str(),
                    "toISOString({input})"
                );
            }
            continue;
        }
        let got = match op.as_str() {
            "Date" => t,
            "getUTCFullYear" => js_utc_full_year(t),
            "getUTCMonth" => js_utc_month(t),
            "getUTCDate" => js_utc_date(t),
            "getUTCDay" => js_utc_day(t),
            "getUTCHours" => js_utc_hours(t),
            "getUTCMinutes" => js_utc_minutes(t),
            "getUTCSeconds" => js_utc_seconds(t),
            "getUTCMilliseconds" => js_utc_milliseconds(t),
            other => panic!("unknown op {other}"),
        };
        assert_eq!(Some(shown(got).as_str()), want.as_str(), "{op}({input})");
    }
    assert!(accepted >= 1000, "{accepted} portable strings");
    assert!(refused >= 300, "{refused} strings outside the format");
    assert!(utc_refused >= 20, "{utc_refused} parts of Date.UTC refused");
}

#[test]
fn a_part_beyond_2_53_ms_brought_back_to_the_last_date_is_refused() {
    let utc = |date: f64, hours: f64| try_date_utc(1970.0, 0.0, date, hours, 0.0, 0.0, 0.0);
    assert_eq!(utc(100_000_001.0, 0.0).ok(), Some(8.64e15));
    assert_eq!(
        utc(-4_249_991.0, 2_501_999_808.0).unwrap_err().code(),
        "FV1808"
    );
}

#[test]
fn every_date_writes_the_string_it_reads_back_from() {
    for t in [
        -8.64e15,
        -62_198_755_200_001.0,
        -1.0,
        0.0,
        951_782_400_000.0,
        253_402_300_800_000.0,
        8.64e15,
    ] {
        assert_eq!(js_date_parse(&js_to_iso_string(t)), t);
    }
}
