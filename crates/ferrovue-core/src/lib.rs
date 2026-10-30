//! The primitives [ferrovue](https://docs.rs/ferrovue)'s runtime crates share: Vue's HTML escaping,
//! numbers written as JavaScript writes them, and URIs encoded as JavaScript encodes them.
//!
//! # Example
//!
//! ```
//! # mod ferrovue { pub use ferrovue_core as core; }
//! let mut out = String::from("<p>");
//! ferrovue::core::escape_into(&mut out, "Tom & Jerry");
//! out.push(' ');
//! ferrovue::core::push_number(&mut out, 0.1 + 0.2);
//! out.push_str("</p>");
//! assert_eq!(out, "<p>Tom &amp; Jerry 0.30000000000000004</p>");
//! ```
#![warn(rustdoc::missing_crate_level_docs)]

/// `escapeHtml`: `"`, `&`, `'`, `<` and `>`, and nothing else.
///
/// Appends `s` to `out` with those five characters written as entities, which makes it safe as
/// text and as a quoted attribute value.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// let mut out = String::from("<p>");
/// ferrovue::core::escape_into(&mut out, r#"<a href="x">Tom & 'Jerry'</a>"#);
/// assert_eq!(out, "<p>&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
/// ```
pub fn escape_into(out: &mut String, s: &str) {
    if !needs_escape(s.as_bytes()) {
        out.push_str(s);
        return;
    }
    let mut last = 0;
    for (i, b) in s.bytes().enumerate() {
        let rep = match b {
            b'"' => "&quot;",
            b'&' => "&amp;",
            b'\'' => "&#39;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            _ => continue,
        };
        out.push_str(&s[last..i]);
        out.push_str(rep);
        last = i + 1;
    }
    out.push_str(&s[last..]);
}

fn needs_escape(s: &[u8]) -> bool {
    const ONES: u64 = u64::from_ne_bytes([0x01; 8]);
    const TOPS: u64 = u64::from_ne_bytes([0x80; 8]);
    let special = |word: u64| {
        let zero = |c: u8| {
            let t = word ^ (ONES * u64::from(c));
            t.wrapping_sub(ONES) & !t & TOPS
        };
        (zero(b'"') | zero(b'&') | zero(b'\'') | zero(b'<') | zero(b'>')) != 0
    };
    let Some(last) = s.last_chunk::<8>() else {
        return s
            .iter()
            .any(|b| matches!(b, b'"' | b'&' | b'\'' | b'<' | b'>'));
    };
    let (words, _) = s.as_chunks::<8>();
    words.iter().any(|w| special(u64::from_ne_bytes(*w))) || special(u64::from_ne_bytes(*last))
}

const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

const DIGIT_PAIRS: &[u8; 200] = b"\
    0001020304050607080910111213141516171819\
    2021222324252627282930313233343536373839\
    4041424344454647484950515253545556575859\
    6061626364656667686970717273747576777879\
    8081828384858687888990919293949596979899";

fn decimal(buf: &mut [u8; 20], mut n: u64) -> usize {
    let mut i = buf.len();
    while n >= 100 {
        let pair = (n % 100) as usize * 2;
        n /= 100;
        i -= 2;
        buf[i..i + 2].copy_from_slice(&DIGIT_PAIRS[pair..pair + 2]);
    }
    if n >= 10 {
        let pair = n as usize * 2;
        i -= 2;
        buf[i..i + 2].copy_from_slice(&DIGIT_PAIRS[pair..pair + 2]);
    } else {
        i -= 1;
        buf[i] = b'0' + n as u8;
    }
    i
}

fn push_decimal(out: &mut String, n: u64) {
    if n < 10 {
        out.push(char::from(b'0' + n as u8));
        return;
    }
    let mut buf = [0; 20];
    let start = decimal(&mut buf, n);
    out.reserve(buf.len() - start);
    for &b in &buf[start..] {
        out.push(char::from(b));
    }
}

/// `String(n)` for an integer, which is what `toDisplayString` and `escapeHtml` make of a number.
///
/// Exact within ±(2⁵³ − 1); beyond that it is written as JavaScript writes the rounded number.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// let mut out = String::new();
/// ferrovue::core::push_int(&mut out, 42);
/// out.push(' ');
/// // Beyond 2⁵³ the browser has the rounded number, so that is what is written.
/// ferrovue::core::push_int(&mut out, 9_007_199_254_740_993);
/// assert_eq!(out, "42 9007199254740992");
/// ```
pub fn push_int(out: &mut String, n: i64) {
    if n.unsigned_abs() <= MAX_SAFE_INTEGER {
        if n < 0 {
            out.push('-');
        }
        push_decimal(out, n.unsigned_abs());
    } else {
        push_number(out, n as f64);
    }
}

/// ASCII text on the stack, long enough for any `u128` in decimal: what `push_number` writes and
/// reads digits in, so writing a fraction allocates nothing.
struct Short {
    buf: [u8; 48],
    len: usize,
}

impl Short {
    const fn new() -> Short {
        Short {
            buf: [0; 48],
            len: 0,
        }
    }

    fn of(digits: &str) -> Short {
        let mut short = Short::new();
        short.extend(digits.bytes());
        short
    }

    fn extend(&mut self, bytes: impl Iterator<Item = u8>) {
        for b in bytes {
            self.buf[self.len] = b;
            self.len += 1;
        }
    }

    fn as_str(&self) -> &str {
        std::str::from_utf8(&self.buf[..self.len]).expect("only ASCII is written")
    }
}

impl std::fmt::Write for Short {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        let end = self.len + s.len();
        self.buf
            .get_mut(self.len..end)
            .ok_or(std::fmt::Error)?
            .copy_from_slice(s.as_bytes());
        self.len = end;
        Ok(())
    }
}

/// `Number.prototype.toString()`: JavaScript's shortest round-trip digits, laid out as ECMAScript
/// lays them out: `0.30000000000000004`, `1e+21`, `1.5e-7`, `NaN`, `-Infinity`.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// let written = |x: f64| {
///     let mut out = String::new();
///     ferrovue::core::push_number(&mut out, x);
///     out
/// };
/// assert_eq!(written(0.1 + 0.2), "0.30000000000000004");
/// assert_eq!(written(1e21), "1e+21");
/// assert_eq!(written(-0.0), "0");
/// assert_eq!(written(f64::NAN), "NaN");
/// ```
pub fn push_number(out: &mut String, x: f64) {
    write_number(out, x);
}

trait Sink: std::fmt::Write {
    fn put_str(&mut self, s: &str);
    fn put_byte(&mut self, c: u8);
    fn put_zeros(&mut self, n: usize);
    fn put_decimal(&mut self, n: u64);
}

impl Sink for String {
    fn put_str(&mut self, s: &str) {
        self.push_str(s);
    }

    fn put_byte(&mut self, c: u8) {
        self.push(char::from(c));
    }

    fn put_zeros(&mut self, n: usize) {
        self.extend(std::iter::repeat_n('0', n));
    }

    fn put_decimal(&mut self, n: u64) {
        push_decimal(self, n);
    }
}

impl Sink for Short {
    fn put_str(&mut self, s: &str) {
        self.extend(s.bytes());
    }

    fn put_byte(&mut self, c: u8) {
        self.extend(std::iter::once(c));
    }

    fn put_zeros(&mut self, n: usize) {
        self.extend(std::iter::repeat_n(b'0', n));
    }

    fn put_decimal(&mut self, n: u64) {
        let mut buf = [0; 20];
        let start = decimal(&mut buf, n);
        self.extend(buf[start..].iter().copied());
    }
}

fn write_number(out: &mut impl Sink, x: f64) {
    if x.is_nan() {
        out.put_str("NaN");
        return;
    }
    if x == 0.0 {
        out.put_byte(b'0');
        return;
    }
    if x.is_infinite() {
        out.put_str(if x < 0.0 { "-Infinity" } else { "Infinity" });
        return;
    }
    if x < 0.0 {
        out.put_byte(b'-');
    }
    let x = x.abs();
    if x.fract() == 0.0 && x <= MAX_SAFE_INTEGER as f64 {
        out.put_decimal(x as u64);
        return;
    }
    let (digits, exp) = shortest_digits(x);
    let digits = digits.as_str();
    let k = digits.len() as i32;
    let n = exp + 1;
    if k <= n && n <= 21 {
        out.put_str(digits);
        out.put_zeros((n - k) as usize);
    } else if 0 < n && n <= 21 {
        out.put_str(&digits[..n as usize]);
        out.put_byte(b'.');
        out.put_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.put_str("0.");
        out.put_zeros((-n) as usize);
        out.put_str(digits);
    } else {
        out.put_str(&digits[..1]);
        if k > 1 {
            out.put_byte(b'.');
            out.put_str(&digits[1..]);
        }
        let e = n - 1;
        let _ = write!(out, "e{}{}", if e < 0 { '-' } else { '+' }, e.abs());
    }
}

fn shortest_digits(x: f64) -> (Short, i32) {
    use std::fmt::Write;
    let mut sci = Short::new();
    let _ = write!(sci, "{x:e}");
    let (mantissa, exp) = sci
        .as_str()
        .split_once('e')
        .expect("`{:e}` writes an exponent");
    let exp: i32 = exp.parse().expect("`{:e}` writes an integer exponent");
    let mut digits = Short::new();
    digits.extend(mantissa.bytes().filter(|b| *b != b'.'));
    if let Some((exact, exact_exp)) = few_exact_digits(x)
        && exact_exp == exp
    {
        let exact = exact.as_str();
        let k = digits.len;
        if exact.len() == k + 1 && exact.ends_with('5') {
            let lower = &exact[..k];
            let upper = increment_digits(lower);
            let even = |d: &str| {
                d.bytes()
                    .last()
                    .is_some_and(|b| (b - b'0').is_multiple_of(2))
            };
            if upper.len() == k && (digits.as_str() == lower || digits.as_str() == upper) {
                digits = Short::of(if even(lower) { lower } else { &upper });
            }
        }
    }
    (digits, exp)
}

fn few_exact_digits(x: f64) -> Option<(Short, i32)> {
    use std::fmt::Write;
    let bits = x.to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1 << 52) - 1);
    let (m, e) = if biased == 0 {
        (fraction, -1074)
    } else {
        (fraction | 1 << 52, biased - 1075)
    };
    let shift = m.trailing_zeros();
    let (m, e) = (m >> shift, e + shift as i32);
    let (value, scale) = if e < 0 {
        if -e >= 26 {
            return None;
        }
        (u128::from(m) * 5u128.pow(e.unsigned_abs()), e)
    } else if e <= 74 {
        (u128::from(m) << e, 0)
    } else if e < 82 {
        let mut s = String::new();
        let _ = write!(s, "{x:.40e}");
        let (mantissa, exp) = s.split_once('e')?;
        let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
        let digits = digits.trim_end_matches('0');
        let exp = exp.parse().ok()?;
        return (digits.len() <= 18).then(|| (Short::of(digits), exp));
    } else {
        return None;
    };
    let mut digits = Short::new();
    let _ = write!(digits, "{value}");
    let all = digits.len;
    digits.len = digits.as_str().trim_end_matches('0').len();
    (digits.len <= 18).then_some((digits, all as i32 - 1 + scale))
}

/// `Math.round`: the nearest integer, a half rounding up toward +∞ (`-2.5` to `-2`, where Rust's
/// `f64::round` gives `-3`), and `-0` from `-0.5` up to zero, which `1 / Math.round(x)` shows.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// use ferrovue::core::js_round;
///
/// assert_eq!(js_round(2.5), 3.0);
/// assert_eq!(js_round(-2.5), -2.0); // `f64::round` gives -3
/// assert_eq!(js_round(-2.6), -3.0);
/// assert!(js_round(-0.2).is_sign_negative()); // -0, as JavaScript gives
/// assert!(js_round(f64::NAN).is_nan());
/// ```
#[must_use]
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    let r = if x - f >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 && x.is_sign_negative() {
        -0.0
    } else {
        r
    }
}

/// `Math.sign`: 1 or -1 by the sign of a number other than zero, and `NaN`, `0` and `-0` as they
/// are, where Rust's `f64::signum` gives 1 for `0`.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// use ferrovue::core::js_sign;
///
/// assert_eq!(js_sign(-7.5), -1.0);
/// assert_eq!(js_sign(1e-300), 1.0);
/// assert!(js_sign(-0.0).is_sign_negative()); // -0, as JavaScript gives
/// assert_eq!(js_sign(0.0), 0.0); // `f64::signum` gives 1
/// assert!(js_sign(f64::NAN).is_nan());
/// ```
#[must_use]
pub fn js_sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x
    }
}

/// `Math.max` of two numbers: `NaN` if either is, where Rust's `f64::max` ignores a `NaN`.
///
/// `+0` is larger than `-0`, as in JavaScript.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// use ferrovue::core::js_max;
///
/// assert_eq!(js_max(2.0, 3.5), 3.5);
/// assert!(js_max(1.0, f64::NAN).is_nan()); // `f64::max` gives 1
/// assert!(js_max(-0.0, 0.0).is_sign_positive());
/// ```
#[must_use]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b || (a == b && b.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `Math.min` of two numbers: `NaN` if either is, where Rust's `f64::min` ignores a `NaN`.
///
/// `-0` is smaller than `+0`, as in JavaScript.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// use ferrovue::core::js_min;
///
/// assert_eq!(js_min(2.0, 3.5), 2.0);
/// assert!(js_min(1.0, f64::NAN).is_nan()); // `f64::min` gives 1
/// assert!(js_min(0.0, -0.0).is_sign_negative());
/// ```
#[must_use]
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b || (a == b && a.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `Number.prototype.toFixed(digits)`: the number rounded to `digits` places, from its exact binary
/// value. An exact tie rounds away from zero, where Rust's formatting rounds it to even; at 10²¹ and
/// beyond, JavaScript writes the number as `String(x)` does.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// use ferrovue::core::js_to_fixed;
///
/// assert_eq!(js_to_fixed(2.5, 0), "3"); // an exact tie, away from zero; Rust's `{:.0}` gives "2"
/// assert_eq!(js_to_fixed(1.005, 2), "1.00"); // 1.005 is a little less as a double
/// assert_eq!(js_to_fixed(-0.04, 1), "-0.0");
/// assert_eq!(js_to_fixed(1e21, 2), "1e+21");
/// ```
#[must_use]
pub fn js_to_fixed(x: f64, digits: u32) -> String {
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x.abs() >= 1e21 || x.is_infinite() {
        let mut s = String::new();
        push_number(&mut s, x);
        return s;
    }
    let d = digits as usize;
    let (exact, exp) = exact_digits(x);
    let scaled = match usize::try_from(exp + 1 + digits as i32) {
        Ok(0) => if exact.as_bytes()[0] >= b'5' {
            "1"
        } else {
            "0"
        }
        .to_owned(),
        Ok(keep) => rounded_half_up(&exact, keep),
        Err(_) => "0".to_owned(),
    };
    let mut out = String::with_capacity(d + 3);
    if x < 0.0 {
        out.push('-');
    }
    out.extend(std::iter::repeat_n(
        '0',
        (d + 1).saturating_sub(scaled.len()),
    ));
    out.push_str(&scaled);
    if d > 0 {
        out.insert(out.len() - d, '.');
    }
    out
}

/// `Number.prototype.toPrecision(precision)`: the number rounded to `precision` significant
/// digits, from its exact binary value, an exact tie rounding away from zero. It is written with
/// an exponent (`1.2e+5`, `1.2e-7`) when the exponent is below -6 or at least `precision`, and
/// without one otherwise; `NaN` and the infinities are written as `String(x)` writes them.
/// `toPrecision()` without an argument is `String(x)`, which [`push_number`] writes.
///
/// # Panics
///
/// When `precision` is 0 or above 100 and `x` is finite, where JavaScript throws a `RangeError`.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// use ferrovue::core::js_to_precision;
///
/// assert_eq!(js_to_precision(123.456, 4), "123.5");
/// assert_eq!(js_to_precision(123_456.0, 2), "1.2e+5");
/// assert_eq!(js_to_precision(0.000_001_5, 2), "0.0000015");
/// assert_eq!(js_to_precision(2.5, 1), "3"); // an exact tie, away from zero
/// assert_eq!(js_to_precision(-0.0, 3), "0.00");
/// ```
#[must_use]
pub fn js_to_precision(x: f64, precision: u32) -> String {
    use std::fmt::Write;
    if !x.is_finite() {
        let mut s = String::new();
        push_number(&mut s, x);
        return s;
    }
    assert!(
        (1..=100).contains(&precision),
        "toPrecision() takes a precision from 1 to 100: {precision} was given"
    );
    let p = precision as usize;
    let (digits, e) = significant(x, p);
    let mut out = String::with_capacity(p + 8);
    if x < 0.0 {
        out.push('-');
    }
    if e < -6 || e >= precision as i32 {
        push_mantissa(&mut out, &digits);
        let _ = write!(out, "e{}{}", if e < 0 { '-' } else { '+' }, e.abs());
    } else if let Ok(point) = usize::try_from(e) {
        let whole = point + 1;
        out.push_str(&digits[..whole]);
        if whole < p {
            out.push('.');
            out.push_str(&digits[whole..]);
        }
    } else {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-e - 1) as usize));
        out.push_str(&digits);
    }
    out
}

/// `Number.prototype.toExponential(fractionDigits)`: the number written with one digit before the
/// point and an exponent, `1.23e+5`. Given `Some(f)`, the digits are rounded to `f` places after
/// the point from the number's exact binary value, an exact tie rounding away from zero; given
/// `None`, as `toExponential()` without an argument, they are as many as it takes to tell the
/// number from every other, the digits `String(x)` writes. `NaN` and the infinities are written as
/// `String(x)` writes them.
///
/// # Panics
///
/// When `fraction_digits` is above 100 and `x` is finite, where JavaScript throws a `RangeError`.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// use ferrovue::core::js_to_exponential;
///
/// assert_eq!(js_to_exponential(123_456.0, Some(2)), "1.23e+5");
/// assert_eq!(js_to_exponential(0.000_15, None), "1.5e-4");
/// assert_eq!(js_to_exponential(1.25, Some(1)), "1.3e+0"); // an exact tie, away from zero
/// assert_eq!(js_to_exponential(-0.0, None), "0e+0");
/// ```
#[must_use]
pub fn js_to_exponential(x: f64, fraction_digits: Option<u32>) -> String {
    use std::fmt::Write;
    if !x.is_finite() {
        let mut s = String::new();
        push_number(&mut s, x);
        return s;
    }
    let (digits, e) = match fraction_digits {
        Some(f) => {
            assert!(
                f <= 100,
                "toExponential() takes from 0 to 100 fraction digits: {f} were given"
            );
            significant(x, f as usize + 1)
        }
        None if x == 0.0 => ("0".to_owned(), 0),
        None => {
            let (digits, e) = shortest_digits(x.abs());
            (digits.as_str().to_owned(), e)
        }
    };
    let mut out = String::with_capacity(digits.len() + 8);
    if x < 0.0 {
        out.push('-');
    }
    push_mantissa(&mut out, &digits);
    let _ = write!(out, "e{}{}", if e < 0 { '-' } else { '+' }, e.abs());
    out
}

fn push_mantissa(out: &mut String, digits: &str) {
    out.push_str(&digits[..1]);
    if digits.len() > 1 {
        out.push('.');
        out.push_str(&digits[1..]);
    }
}

fn significant(x: f64, keep: usize) -> (String, i32) {
    let (exact, e) = exact_digits(x);
    let mut digits = rounded_half_up(&exact, keep);
    if digits.len() > keep {
        digits.truncate(keep);
        (digits, e + 1)
    } else {
        (digits, e)
    }
}

fn exact_digits(x: f64) -> (String, i32) {
    use std::fmt::Write;
    let mut s = String::new();
    let _ = write!(s, "{:.800e}", x.abs());
    let (mantissa, exp) = s.split_once('e').expect("`{:e}` writes an exponent");
    let exp = exp.parse().expect("`{:e}` writes an integer exponent");
    let mut digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    digits.truncate(digits.trim_end_matches('0').len().max(1));
    (digits, exp)
}

fn rounded_half_up(exact: &str, keep: usize) -> String {
    match exact.as_bytes().get(keep) {
        None => {
            let mut digits = exact.to_owned();
            digits.extend(std::iter::repeat_n('0', keep - exact.len()));
            digits
        }
        Some(&next) if next >= b'5' => increment_digits(&exact[..keep]),
        Some(_) => exact[..keep].to_owned(),
    }
}

fn increment_digits(digits: &str) -> String {
    let mut bytes: Vec<u8> = digits.bytes().collect();
    for b in bytes.iter_mut().rev() {
        if *b == b'9' {
            *b = b'0';
        } else {
            *b += 1;
            return String::from_utf8(bytes).expect("ASCII digits");
        }
    }
    bytes.insert(0, b'1');
    String::from_utf8(bytes).expect("ASCII digits")
}

/// A number written as JavaScript writes it, for `format!` in generated code: `${n}` in a template
/// literal, `"#" + n`, `n.toString()`.
///
/// `Display` is implemented for `Js<i64>`, written as [`push_int`] writes it, and `Js<f64>`,
/// written as [`push_number`] writes it.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// use ferrovue::core::Js;
///
/// assert_eq!(format!("{} items", Js(3_i64)), "3 items");
/// assert_eq!(format!("{}", Js(1.5e-7_f64)), "1.5e-7");
/// ```
#[derive(Debug, Clone, Copy)]
pub struct Js<T>(pub T);

impl std::fmt::Display for Js<i64> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.0.unsigned_abs() > MAX_SAFE_INTEGER {
            return Js(self.0 as f64).fmt(f);
        }
        let mut buf = [0; 20];
        let start = decimal(&mut buf, self.0.unsigned_abs());
        if self.0 < 0 {
            f.write_str("-")?;
        }
        f.write_str(std::str::from_utf8(&buf[start..]).expect("ASCII digits"))
    }
}

impl std::fmt::Display for Js<f64> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut s = Short::new();
        write_number(&mut s, self.0);
        f.write_str(s.as_str())
    }
}

/// `encodeURIComponent(s)`: every character but the ASCII letters and digits and `-_.!~*'()`
/// written as `%XX` for each byte of its UTF-8, the hexadecimal digits in upper case.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// assert_eq!(ferrovue::core::js_encode_uri_component("a b&c/é"), "a%20b%26c%2F%C3%A9");
/// assert_eq!(ferrovue::core::js_encode_uri_component("🦀"), "%F0%9F%A6%80");
/// ```
#[must_use]
pub fn js_encode_uri_component(s: &str) -> String {
    encoded(s, kept_by_encode_uri_component)
}

/// `encodeURI(s)`: as [`js_encode_uri_component`], but keeping the characters a URI reserves as
/// well, `;/?:@&=+$,#`.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// assert_eq!(ferrovue::core::js_encode_uri("/a b?q=1&r=é#top"), "/a%20b?q=1&r=%C3%A9#top");
/// assert_eq!(ferrovue::core::js_encode_uri("[|]"), "%5B%7C%5D");
/// ```
#[must_use]
pub fn js_encode_uri(s: &str) -> String {
    encoded(s, kept_by_encode_uri)
}

fn encoded(s: &str, keep: fn(char) -> bool) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if keep(c) {
            out.push(c);
        } else {
            percent_encode_into(&mut out, c);
        }
    }
    out
}

fn kept_by_encode_uri_component(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '(' | ')')
}

/// Whether `encodeURI` writes `c` as it is.
#[doc(hidden)]
#[must_use]
pub fn kept_by_encode_uri(c: char) -> bool {
    kept_by_encode_uri_component(c)
        || matches!(
            c,
            ';' | '/' | '?' | ':' | '@' | '&' | '=' | '+' | '$' | ',' | '#'
        )
}

/// Appends `c` as `%XX` for each byte of its UTF-8, the hexadecimal digits in upper case.
#[doc(hidden)]
pub fn percent_encode_into(out: &mut String, c: char) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut buf = [0; 4];
    for &b in c.encode_utf8(&mut buf).as_bytes() {
        out.push('%');
        out.push(char::from(HEX[usize::from(b >> 4)]));
        out.push(char::from(HEX[usize::from(b & 0xF)]));
    }
}

#[cfg(test)]
mod tests;
