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
/// # use ferrovue_core as ferrovue;
/// let mut out = String::new();
/// ferrovue::push_int(&mut out, 42);
/// out.push(' ');
/// // Beyond 2⁵³ the browser has the rounded number, so that is what is written.
/// ferrovue::push_int(&mut out, 9_007_199_254_740_993);
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

struct Short {
    buf: [u8; 32],
    len: usize,
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
/// lays them out — `0.30000000000000004`, `1e+21`, `1.5e-7`, `NaN`, `-Infinity`.
///
/// # Example
///
/// ```
/// # use ferrovue_core as ferrovue;
/// let written = |x: f64| {
///     let mut out = String::new();
///     ferrovue::push_number(&mut out, x);
///     out
/// };
/// assert_eq!(written(0.1 + 0.2), "0.30000000000000004");
/// assert_eq!(written(1e21), "1e+21");
/// assert_eq!(written(-0.0), "0");
/// assert_eq!(written(f64::NAN), "NaN");
/// ```
pub fn push_number(out: &mut String, x: f64) {
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
    let x = x.abs();
    if x.fract() == 0.0 && x <= MAX_SAFE_INTEGER as f64 {
        push_decimal(out, x as u64);
        return;
    }
    let mut sci = Short {
        buf: [0; 32],
        len: 0,
    };
    let _ = write!(sci, "{x:e}");
    let sci = std::str::from_utf8(&sci.buf[..sci.len]).expect("`{:e}` writes ASCII");
    let (mantissa, exp) = sci.split_once('e').expect("`{:e}` writes an exponent");
    let exp: i32 = exp.parse().expect("`{:e}` writes an integer exponent");
    let mut digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    if let Some((exact, exact_exp)) = few_exact_digits(x)
        && exact_exp == exp
    {
        let k = digits.len();
        if exact.len() == k + 1 && exact.ends_with('5') {
            let lower = &exact[..k];
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
    let n = exp + 1;
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

fn few_exact_digits(x: f64) -> Option<(String, i32)> {
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
        use std::fmt::Write;
        let mut s = String::new();
        let _ = write!(s, "{x:.40e}");
        let (mantissa, exp) = s.split_once('e')?;
        let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
        let digits = digits.trim_end_matches('0');
        let exp = exp.parse().ok()?;
        return (digits.len() <= 18).then(|| (digits.to_owned(), exp));
    } else {
        return None;
    };
    let all = value.to_string();
    let digits = all.trim_end_matches('0');
    (digits.len() <= 18).then(|| (digits.to_owned(), all.len() as i32 - 1 + scale))
}

/// `Math.round`: the nearest integer, a half rounding up toward +∞ — `-2.5` to `-2`, where Rust's
/// `f64::round` gives `-3` — and `-0` from `-0.5` up to zero, which `1 / Math.round(x)` shows.
///
/// # Example
///
/// ```
/// # use ferrovue_core as ferrovue;
/// use ferrovue::js_round;
///
/// assert_eq!(js_round(2.5), 3.0);
/// assert_eq!(js_round(-2.5), -2.0); // `f64::round` gives -3
/// assert_eq!(js_round(-2.6), -3.0);
/// assert!(js_round(-0.2).is_sign_negative()); // -0, as JavaScript gives
/// assert!(js_round(f64::NAN).is_nan());
/// ```
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    let r = if x - f >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 && x.is_sign_negative() {
        -0.0
    } else {
        r
    }
}

/// `Math.max` of two numbers: `NaN` if either is, where Rust's `f64::max` ignores a `NaN`.
///
/// `+0` is larger than `-0`, as in JavaScript.
///
/// # Example
///
/// ```
/// # use ferrovue_core as ferrovue;
/// use ferrovue::js_max;
///
/// assert_eq!(js_max(2.0, 3.5), 3.5);
/// assert!(js_max(1.0, f64::NAN).is_nan()); // `f64::max` gives 1
/// assert!(js_max(-0.0, 0.0).is_sign_positive());
/// ```
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
/// # use ferrovue_core as ferrovue;
/// use ferrovue::js_min;
///
/// assert_eq!(js_min(2.0, 3.5), 2.0);
/// assert!(js_min(1.0, f64::NAN).is_nan()); // `f64::min` gives 1
/// assert!(js_min(0.0, -0.0).is_sign_negative());
/// ```
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
/// # use ferrovue_core as ferrovue;
/// use ferrovue::js_to_fixed;
///
/// assert_eq!(js_to_fixed(2.5, 0), "3"); // an exact tie, away from zero; Rust's `{:.0}` gives "2"
/// assert_eq!(js_to_fixed(1.005, 2), "1.00"); // 1.005 is a little less as a double
/// assert_eq!(js_to_fixed(-0.04, 1), "-0.0");
/// assert_eq!(js_to_fixed(1e21, 2), "1e+21");
/// ```
pub fn js_to_fixed(x: f64, digits: u32) -> String {
    use std::fmt::Write;
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x.abs() >= 1e21 || x.is_infinite() {
        let mut s = String::new();
        push_number(&mut s, x);
        return s;
    }
    let d = digits as usize;
    let mut out = String::new();
    let _ = write!(out, "{:.*}", d, x.abs());
    let mut exact = String::new();
    let _ = write!(exact, "{:.1100}", x.abs());
    let exact = exact.trim_end_matches('0');
    let fraction = exact.split_once('.').map_or("", |(_, f)| f);
    if fraction.len() == d + 1 && fraction.ends_with('5') {
        out = round_up_magnitude(&exact[..exact.len() - 1]);
    }
    if x < 0.0 {
        out.insert(0, '-');
    }
    out
}

fn round_up_magnitude(digits: &str) -> String {
    let digits = digits.trim_end_matches('.');
    let mut bytes: Vec<u8> = digits.bytes().collect();
    let mut i = bytes.len();
    loop {
        if i == 0 {
            bytes.insert(0, b'1');
            break;
        }
        i -= 1;
        match bytes[i] {
            b'.' => continue,
            b'9' => bytes[i] = b'0',
            d => {
                bytes[i] = d + 1;
                break;
            }
        }
    }
    String::from_utf8(bytes).expect("ASCII digits")
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
/// # use ferrovue_core as ferrovue;
/// use ferrovue::Js;
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
        let mut s = String::new();
        push_number(&mut s, self.0);
        f.write_str(&s)
    }
}

#[cfg(test)]
mod tests;
