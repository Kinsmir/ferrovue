use super::*;

#[test]
fn js_trim_is_javascripts_trim() {
    let vectors: Vec<(String, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/trim.json")).expect("trim vectors");
    assert!(vectors.len() >= 6, "the vectors were not all read");
    for (input, want) in &vectors {
        assert_eq!(js_trim(input), want, "trim({input:?})");
    }
}

#[test]
fn js_length_counts_utf16_code_units() {
    let vectors: Vec<(String, i64)> =
        serde_json::from_str(include_str!("../../tests/vectors/length.json"))
            .expect("length vectors");
    for (input, want) in &vectors {
        assert_eq!(js_length(input), *want, "length({input:?})");
    }
}

fn vector_number(s: &str) -> f64 {
    s.parse().unwrap_or_else(|_| panic!("{s:?} parses"))
}

#[test]
fn string_methods_are_javascripts() {
    let vectors: Vec<(String, String, Vec<String>, serde_json::Value)> =
        serde_json::from_str(include_str!("../../tests/vectors/strings.json"))
            .expect("string vectors");
    assert!(vectors.len() >= 4000, "the vectors were not all read");
    for (op, s, args, want) in &vectors {
        let num = |i: usize| vector_number(&args[i]);
        let opt = |i: usize| args.get(i).map(|a| vector_number(a));
        let fill = args.get(1).map_or(" ", String::as_str);
        let run = || -> serde_json::Value {
            match op.as_str() {
                "slice" => js_slice(s, num(0), opt(1)).into(),
                "substring" => js_substring(s, num(0), opt(1)).into(),
                "at" => js_at(s, num(0)).into(),
                "charAt" => js_char_at(s, num(0)).into(),
                "indexOf" => js_index_of(s, &args[0]).into(),
                "lastIndexOf" => js_last_index_of(s, &args[0]).into(),
                "split" => js_split(s, &args[0]).into(),
                "replace" => js_replace(s, &args[0], &args[1]).into(),
                "replaceAll" => js_replace_all(s, &args[0], &args[1]).into(),
                "padStart" => js_pad_start(s, num(0), fill).into(),
                "padEnd" => js_pad_end(s, num(0), fill).into(),
                "repeat" => js_repeat(s, num(0)).into(),
                other => panic!("unknown op {other}"),
            }
        };
        if want.get("throws").is_some() {
            let hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(|_| {}));
            let thrown = std::panic::catch_unwind(run);
            std::panic::set_hook(hook);
            assert!(
                thrown.is_err(),
                "{op}({s:?}, {args:?}) throws in JavaScript"
            );
        } else if let Some(length) = want.get("length") {
            let got = run();
            let got = got.as_str().expect("a string");
            assert_eq!(
                js_length(got),
                length.as_i64().expect("a length"),
                "{op}({s:?}, {args:?})"
            );
        } else {
            assert_eq!(&run(), want, "{op}({s:?}, {args:?})");
        }
    }
}

#[test]
fn strings_are_ordered_as_javascript_orders_them() {
    let vectors: Vec<(String, String, i8)> =
        serde_json::from_str(include_str!("../../tests/vectors/compare.json"))
            .expect("compare vectors");
    assert!(vectors.len() >= 400, "the vectors were not all read");
    for (a, b, want) in &vectors {
        assert_eq!(js_cmp(a, b) as i8, *want, "{a:?} against {b:?}");
    }
}

#[test]
fn strings_are_read_as_numbers_as_javascript_reads_them() {
    let vectors: Vec<(String, String, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/parse.json"))
            .expect("parse vectors");
    assert!(vectors.len() >= 400, "the vectors were not all read");
    for (op, input, want) in &vectors {
        let x = match op.as_str() {
            "Number" => js_number(input),
            "parseInt" => js_parse_int(input, 0),
            "parseInt10" => js_parse_int(input, 10),
            "parseInt16" => js_parse_int(input, 16),
            "parseInt7" => js_parse_int(input, 7),
            "parseInt36" => js_parse_int(input, 36),
            "parseFloat" => js_parse_float(input),
            other => panic!("unknown op {other}"),
        };
        let mut got = String::new();
        if x == 0.0 && x.is_sign_negative() {
            got.push('-');
        }
        push_number(&mut got, x);
        assert_eq!(&got, want, "{op}({input:?})");
    }
}

#[test]
fn strings_are_written_as_json_stringify_writes_them() {
    let vectors: Vec<(String, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/json.json")).expect("json vectors");
    for (input, want) in &vectors {
        assert_eq!(&js_json_string(input), want, "{input:?}");
    }
}

#[test]
fn json_numbers_are_null_when_not_finite() {
    assert_eq!(js_json_number(f64::NAN), "null");
    assert_eq!(js_json_number(f64::NEG_INFINITY), "null");
    assert_eq!(js_json_number(-0.0), "0");
    assert_eq!(js_json_number(1e21), "1e+21");
}

#[test]
fn slicing_inside_a_pair_keeps_the_rest_whole() {
    assert_eq!(js_slice("a🦀🦀b", 2.0, Some(5.0)), "\u{FFFD}🦀");
    assert_eq!(js_substring("🦀🦀", 3.0, Some(1.0)), "\u{FFFD}\u{FFFD}");
    assert_eq!(js_char_at("🦀", 1.0), "\u{FFFD}");
    assert_eq!(js_at("é🦀", -2.0), Some("\u{FFFD}"));
    assert_eq!(
        js_replace_all("🦀", "", ""),
        "🦀",
        "an empty replacement joins the halves again"
    );
}

#[test]
fn padding_beyond_the_longest_string_panics_as_javascript_throws() {
    let long = std::panic::catch_unwind(|| js_pad_start("a", 1e10, "b"));
    assert!(long.is_err());
    assert_eq!(
        js_pad_end("a", 1e10, ""),
        "a",
        "an empty fill pads nothing, and does not throw"
    );
}

#[test]
fn padding_to_exactly_the_longest_string_v8_makes_does_not_panic() {
    let s = "a".repeat(536_870_887);
    assert_eq!(js_length(&js_pad_end(&s, 536_870_888.0, "b")), 536_870_888);
}
