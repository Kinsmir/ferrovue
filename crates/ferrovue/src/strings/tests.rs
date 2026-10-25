use super::*;

#[test]
fn js_trim_is_javascripts_trim() {
    let vectors: Vec<(String, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/trim.json")).expect("trim vectors");
    assert!(vectors.len() >= 10, "the vectors were not all read");
    for (input, want) in &vectors {
        assert_eq!(js_trim(input), want, "trim({input:?})");
    }
}

#[test]
fn js_length_counts_utf16_code_units() {
    let vectors: Vec<(String, i64)> =
        serde_json::from_str(include_str!("../../tests/vectors/length.json"))
            .expect("length vectors");
    assert!(vectors.len() >= 12, "the vectors were not all read");
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
                "indexOf" if args.len() == 2 => js_index_of_from(s, &args[0], num(1)).into(),
                "indexOf" => js_index_of(s, &args[0]).into(),
                "lastIndexOf" if args.len() == 2 => {
                    js_last_index_of_from(s, &args[0], num(1)).into()
                }
                "lastIndexOf" => js_last_index_of(s, &args[0]).into(),
                "includes" => js_includes_from(s, &args[0], num(1)).into(),
                "startsWith" => js_starts_with_at(s, &args[0], num(1)).into(),
                "endsWith" => js_ends_with_at(s, &args[0], num(1)).into(),
                "split" if args.len() == 2 => js_split_limit(s, &args[0], num(1)).into(),
                "split" => js_split(s, &args[0]).into(),
                "substr" => js_substr(s, num(0), opt(1)).into(),
                "charCodeAt" => {
                    let code = js_char_code_at(s, num(0));
                    if code.is_nan() {
                        "NaN".into()
                    } else {
                        (code as i64).into()
                    }
                }
                "codePointAt" => js_code_point_at(s, num(0)).into(),
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
    assert!(vectors.len() >= 12, "the vectors were not all read");
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
fn searching_back_from_inside_a_pair_starts_at_the_pair() {
    assert_eq!(js_last_index_of_from("xxxxxxxx😀ab", "x", 9.0), 7);
    assert_eq!(js_last_index_of_from("xxxxxxxx😀ab", "x😀", 9.0), 7);
    assert_eq!(js_last_index_of_from("xxxxxxxx😀ab", "😀", 9.0), 8);
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

#[test]
fn list_at_counts_from_either_end_as_javascript_does() {
    let at = |index: f64| js_item_at([10, 20, 30].into_iter(), index);
    assert_eq!(at(0.0), Some(10));
    assert_eq!(at(2.9), Some(30));
    assert_eq!(at(-0.5), Some(10));
    assert_eq!(at(-1.0), Some(30));
    assert_eq!(at(-3.0), Some(10));
    assert_eq!(at(-3.5), Some(10));
    assert_eq!(at(-4.0), None);
    assert_eq!(at(3.0), None);
    assert_eq!(at(f64::NAN), Some(10));
    assert_eq!(at(f64::INFINITY), None);
    assert_eq!(at(f64::NEG_INFINITY), None);
    assert_eq!(js_item_at(std::iter::empty::<i64>(), 0.0), None);
}

#[test]
fn sorting_keeps_equal_items_in_their_order() {
    let pairs = [(2, 'a'), (1, 'b'), (2, 'c'), (1, 'd')];
    let sorted: Vec<_> = js_sorted(pairs.into_iter(), |a, b| a.0.cmp(&b.0)).collect();
    assert_eq!(sorted, [(1, 'b'), (1, 'd'), (2, 'a'), (2, 'c')]);
    let down: Vec<_> = js_sorted(pairs.into_iter(), |a, b| b.0.cmp(&a.0)).collect();
    assert_eq!(down, [(2, 'a'), (2, 'c'), (1, 'b'), (1, 'd')]);
    assert_eq!(js_sorted(std::iter::empty::<i64>(), i64::cmp).count(), 0);
}

#[test]
fn default_sort_orders_by_string_as_javascript_does() {
    let key = |v: &f64| ferrovue_core::numbers::Js(*v).to_string();
    let numbers = [
        10.0,
        9.0,
        1.0,
        -1.0,
        f64::NAN,
        f64::INFINITY,
        0.0,
        -0.0,
        1e21,
        2.5,
    ];
    let sorted: Vec<String> = js_sorted_by_string(numbers.into_iter(), key)
        .map(|v| key(&v))
        .collect();
    assert_eq!(
        sorted,
        [
            "-1", "0", "0", "1", "10", "1e+21", "2.5", "9", "Infinity", "NaN"
        ]
    );
    let zeros: Vec<bool> = js_sorted_by_string([0.0, -0.0, 0.0].into_iter(), key)
        .map(f64::is_sign_negative)
        .collect();
    assert_eq!(zeros, [false, true, false]);
    let words: Vec<&str> = js_sorted_by_string(["\u{ff5e}", "\u{1f980}", "a"].into_iter(), |v| {
        (*v).to_owned()
    })
    .collect();
    assert_eq!(words, ["a", "\u{1f980}", "\u{ff5e}"]);
}

#[test]
fn order_is_the_sign_of_the_difference() {
    assert_eq!(js_order(1.0, 2.0), Ordering::Less);
    assert_eq!(js_order(2.0, 1.0), Ordering::Greater);
    assert_eq!(js_order(2.0, 2.0), Ordering::Equal);
    assert_eq!(js_order(-0.0, 0.0), Ordering::Equal);
    assert_eq!(js_order(f64::NAN, 1.0), Ordering::Equal);
    assert_eq!(
        js_order(f64::NEG_INFINITY, f64::NEG_INFINITY),
        Ordering::Equal
    );
    assert_eq!(js_order(f64::NEG_INFINITY, 0.0), Ordering::Less);
    assert_eq!(js_order(5e-324, 0.0), Ordering::Greater);
}

#[test]
fn reduce_folds_from_the_initial_value() {
    assert_eq!(
        js_reduce([1, 2, 3].into_iter(), 10, |acc, x| acc * 2 + x),
        91
    );
    assert_eq!(
        js_reduce(["x", "y"].into_iter().rev(), String::new(), |acc, x| acc
            + x),
        "yx"
    );
    assert!(js_reduce(std::iter::empty::<f64>(), -0.0, |acc, x| acc + x).is_sign_negative());
}
