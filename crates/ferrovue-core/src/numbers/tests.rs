use super::*;

#[test]
fn numbers_are_written_as_javascript_writes_them() {
    let vectors: Vec<(String, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/numbers.json"))
            .expect("number vectors");
    assert!(vectors.len() >= 300, "the vectors were not all read");
    for (input, want) in &vectors {
        let x: f64 = input.parse().unwrap_or_else(|_| panic!("{input:?} parses"));
        let mut out = String::new();
        push_number(&mut out, x);
        assert_eq!(&out, want, "String({input})");
    }
}

#[test]
fn math_is_javascripts_math() {
    let vectors: Vec<(String, String, String, String)> =
        serde_json::from_str(include_str!("../../tests/vectors/math.json")).expect("math vectors");
    assert!(vectors.len() >= 600, "the vectors were not all read");
    let num = |s: &str| -> f64 { s.parse().unwrap_or_else(|_| panic!("{s:?} parses")) };
    let text = |x: f64| {
        if x == 0.0 && x.is_sign_negative() {
            return "-0".to_owned();
        }
        let mut out = String::new();
        push_number(&mut out, x);
        out
    };
    for (op, x, arg, want) in &vectors {
        let got = match op.as_str() {
            "round" => text(js_round(num(x))),
            "toFixed" => js_to_fixed(num(x), arg.parse().unwrap()),
            "max" => text(js_max(num(x), num(arg))),
            "min" => text(js_min(num(x), num(arg))),
            other => panic!("unknown op {other}"),
        };
        assert_eq!(&got, want, "{op}({x}, {arg})");
    }
}

#[test]
fn integers_beyond_two_to_the_53_are_written_rounded_as_javascript_does() {
    for (n, want) in [
        (9_007_199_254_740_991, "9007199254740991"),
        (9_007_199_254_740_993, "9007199254740992"),
        (-9_007_199_254_740_993, "-9007199254740992"),
        (i64::MIN, "-9223372036854776000"),
    ] {
        let mut out = String::new();
        push_int(&mut out, n);
        assert_eq!(out, want, "{n}");
        assert_eq!(Js(n).to_string(), want);
    }
}

#[test]
fn integers_are_written_as_javascript_writes_them() {
    for (n, want) in [
        (0, "0"),
        (-1, "-1"),
        (42, "42"),
        (i64::MAX, "9223372036854776000"),
    ] {
        let mut out = String::new();
        push_int(&mut out, n);
        assert_eq!(out, want);
    }
}

#[test]
fn a_number_shows_in_debug() {
    assert_eq!(format!("{:?}", Js(2.5_f64)), "Js(2.5)");
}

fn push_number_exactly(out: &mut String, x: f64) {
    use std::fmt::Write;
    if x.is_nan() {
        out.push_str("NaN");
        return;
    }
    if x == 0.0 {
        out.push('0');
        return;
    }
    if x.is_infinite() {
        out.push_str(if x < 0.0 { "-Infinity" } else { "Infinity" });
        return;
    }
    if x < 0.0 {
        out.push('-');
    }
    let mut sci = String::new();
    let _ = write!(sci, "{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').expect("`{:e}` writes an exponent");
    let mut digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let mut exact = String::new();
    let _ = write!(exact, "{:.1100e}", x.abs());
    if let Some((exact_mantissa, exact_exp)) = exact.split_once('e')
        && exact_exp == exp
    {
        let exact_digits: String = exact_mantissa.chars().filter(|c| *c != '.').collect();
        let exact_digits = exact_digits.trim_end_matches('0');
        let k = digits.len();
        if exact_digits.len() == k + 1 && exact_digits.ends_with('5') {
            let lower = &exact_digits[..k];
            let upper = increment_digits(lower);
            let even = |d: &str| {
                d.bytes()
                    .last()
                    .is_some_and(|b| (b - b'0').is_multiple_of(2))
            };
            if upper.len() == k && (digits == lower || digits == upper) {
                digits = if even(lower) { lower.to_owned() } else { upper };
            }
        }
    }
    let k = digits.len() as i32;
    let n = exp
        .parse::<i32>()
        .expect("`{:e}` writes an integer exponent")
        + 1;
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let e = n - 1;
        let _ = write!(out, "e{}{}", if e < 0 { '-' } else { '+' }, e.abs());
    }
}

fn written(push: fn(&mut String, f64), x: f64) -> String {
    let mut out = String::new();
    push(&mut out, x);
    out
}

fn owned_exact_digits(x: f64) -> Option<(String, i32)> {
    few_exact_digits(x).map(|(digits, exp)| (digits.as_str().to_owned(), exp))
}

fn few_exact_digits_exactly(x: f64) -> Option<(String, i32)> {
    let exact = format!("{x:.1100e}");
    let (mantissa, exp) = exact.split_once('e').expect("`{:e}` writes an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0');
    let exp = exp.parse().expect("`{:e}` writes an integer exponent");
    (digits.len() <= 18).then(|| (digits.to_owned(), exp))
}

#[test]
fn few_exact_digits_finds_eighteen_digits_in_two_to_the_59_times_ten_to_the_22() {
    let x = 2f64.powi(59) * 1e22;
    assert_eq!(
        owned_exact_digits(x),
        Some(("576460752303423488".to_owned(), 39))
    );
    assert_eq!(owned_exact_digits(x), few_exact_digits_exactly(x));
}

proptest::proptest! {
    #![proptest_config(proptest::prelude::ProptestConfig::with_cases(20_000))]

    #[test]
    fn a_number_is_written_as_the_exact_reference_writes_it(bits in proptest::prelude::any::<u64>()) {
        let x = f64::from_bits(bits);
        proptest::prop_assert_eq!(written(push_number, x), written(push_number_exactly, x));
    }

    #[test]
    fn a_short_fraction_is_written_as_the_exact_reference_writes_it(m in 1u64..1 << 53, n in 0i32..64, negative in proptest::prelude::any::<bool>()) {
        let x = m as f64 * 2f64.powi(-n) * if negative { -1.0 } else { 1.0 };
        proptest::prop_assert_eq!(written(push_number, x), written(push_number_exactly, x));
    }

    #[test]
    fn a_large_whole_number_is_written_as_the_exact_reference_writes_it(m in 1u64..1 << 53, e in 0i32..100) {
        let x = m as f64 * 2f64.powi(e);
        proptest::prop_assert_eq!(written(push_number, x), written(push_number_exactly, x));
    }

    #[test]
    fn a_decimal_is_written_as_the_exact_reference_writes_it(digits in 0u64..100_000_000_000_000_000, point in -30i32..30) {
        let x: f64 = format!("{digits}e{point}").parse().expect("a decimal parses");
        proptest::prop_assert_eq!(written(push_number, x), written(push_number_exactly, x));
    }

    #[test]
    fn few_exact_digits_are_the_exact_expansion_when_it_is_short(m in 1u64..1 << 53, e in -60i32..100) {
        let x = m as f64 * 2f64.powi(e);
        proptest::prop_assert_eq!(owned_exact_digits(x), few_exact_digits_exactly(x));
    }

    #[test]
    fn an_integer_is_written_as_the_number_it_is(n in proptest::prelude::any::<i64>()) {
        let mut out = String::new();
        push_int(&mut out, n);
        proptest::prop_assert_eq!(&out, &written(push_number_exactly, n as f64));
        proptest::prop_assert_eq!(&Js(n).to_string(), &out);
        if n.unsigned_abs() <= MAX_SAFE_INTEGER {
            proptest::prop_assert_eq!(&out, &n.to_string());
        }
    }
}
