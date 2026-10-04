//! JavaScript's string methods, counted in UTF-16 code units as JavaScript counts them, and the
//! conversions a template may write: `Number(s)`, `parseInt`, `parseFloat`, `JSON.stringify`.
//!
//! A JavaScript string can hold half of a surrogate pair: `"🦀".slice(0, 1)` is `"\uD83E"`. A Rust
//! `&str` cannot. Where a method's result would hold such a half, these functions put U+FFFD in its
//! place — the character a server sends for it when it writes JavaScript's string as UTF-8
//! (`res.end`, `Buffer.from` and `TextEncoder` each replace a lone surrogate with U+FFFD) — so the
//! page's bytes are the same, and so is the result's length in code units.

use std::borrow::Cow;
use std::cmp::Ordering;

use crate::{js_length, js_trim, js_trim_start, push_number};

/// The longest string V8 makes: 2²⁹ − 24 code units. Making a longer one is a `RangeError`.
const MAX_STRING_LENGTH: f64 = ((1 << 29) - 24) as f64;

/// `ToIntegerOrInfinity`: `NaN` is 0, anything else is truncated toward zero.
fn to_integer(x: f64) -> f64 {
    // `+ 0.0` turns the `-0` of `trunc(-0.5)` into `0`.
    if x.is_nan() { 0.0 } else { x.trunc() + 0.0 }
}

/// An index as `slice` reads it: counted from the end when negative, then clamped to `0..=len`.
fn relative(x: f64, len: usize) -> usize {
    let n = to_integer(x);
    let len = len as f64;
    (if n < 0.0 {
        (len + n).max(0.0)
    } else {
        n.min(len)
    }) as usize
}

/// The range `slice(start, end)` takes from a string of `len` code units, or a list of `len` items:
/// negative indices count from the end, `end` defaults to the end, and an empty range is `(a, a)`.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_slice_range(5, -2.0, None), (3, 5));
/// assert_eq!(ferrovue::js_slice_range(5, 4.0, Some(1.0)), (4, 4));
/// assert_eq!(ferrovue::js_slice_range(5, f64::NAN, Some(2.9)), (0, 2));
/// ```
pub fn js_slice_range(len: usize, start: f64, end: Option<f64>) -> (usize, usize) {
    let from = relative(start, len);
    let to = end.map_or(len, |e| relative(e, len));
    (from, to.max(from))
}

/// `Array.prototype.slice(start, end)` of a list's items: those [`js_slice_range`] takes.
///
/// # Example
///
/// ```
/// let last_two: Vec<i64> = ferrovue::js_slice_items([1, 2, 3].into_iter(), -2.0, None).collect();
/// assert_eq!(last_two, [2, 3]);
/// ```
pub fn js_slice_items<T>(
    items: impl Iterator<Item = T>,
    start: f64,
    end: Option<f64>,
) -> std::vec::IntoIter<T> {
    let mut all: Vec<T> = items.collect();
    let (from, to) = js_slice_range(all.len(), start, end);
    all.truncate(to);
    all.drain(..from);
    all.into_iter()
}

/// The byte where code unit `i` of `s` starts — or, when `i` falls between the two halves of a
/// pair, where the pair ends, and `true`.
fn boundary(s: &str, i: usize) -> (usize, bool) {
    let mut unit = 0;
    for (byte, c) in s.char_indices() {
        if unit >= i {
            return (byte, false);
        }
        let width = c.len_utf16();
        if unit + width > i {
            return (byte + c.len_utf8(), true);
        }
        unit += width;
    }
    (s.len(), false)
}

/// Code units `from..to` of `s`, a half pair at either end written as U+FFFD.
fn units(s: &str, from: usize, to: usize) -> Cow<'_, str> {
    if from >= to {
        return Cow::Borrowed("");
    }
    if s.is_ascii() {
        return Cow::Borrowed(&s[from..to]);
    }
    let (start, low_half) = boundary(s, from);
    let (end, high_half) = boundary(s, to);
    if !low_half && !high_half {
        return Cow::Borrowed(&s[start..end]);
    }
    // A pair that `to` splits is four bytes, and only its first half is kept.
    let whole_end = if high_half { end - 4 } else { end };
    let mut out = String::with_capacity(whole_end.saturating_sub(start) + 6);
    if low_half {
        out.push('\u{FFFD}');
    }
    if whole_end > start {
        out.push_str(&s[start..whole_end]);
    }
    if high_half {
        out.push('\u{FFFD}');
    }
    Cow::Owned(out)
}

/// Code unit `k` of `s`, which must be in range: its character, or U+FFFD for half of a pair.
fn unit(s: &str, k: usize) -> &str {
    if s.is_ascii() {
        return &s[k..k + 1];
    }
    let mut at = 0;
    for (byte, c) in s.char_indices() {
        let width = c.len_utf16();
        if k < at + width {
            return if width == 1 {
                &s[byte..byte + c.len_utf8()]
            } else {
                "\u{FFFD}"
            };
        }
        at += width;
    }
    unreachable!("code unit {k} is in range")
}

/// The number of UTF-16 code units in `s`.
fn length(s: &str) -> usize {
    js_length(s) as usize
}

/// `String.prototype.slice(start, end)`, on UTF-16 code units.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_slice("café au lait", -4.0, None), "lait");
/// // Half of 🦀 is a lone surrogate in JavaScript, sent as U+FFFD.
/// assert_eq!(ferrovue::js_slice("🦀x", 1.0, None), "\u{FFFD}x");
/// ```
pub fn js_slice(s: &str, start: f64, end: Option<f64>) -> Cow<'_, str> {
    let (from, to) = js_slice_range(length(s), start, end);
    units(s, from, to)
}

/// `String.prototype.substring(start, end)`: negative indices are 0, and the two are swapped when
/// `start` is the larger.
pub fn js_substring(s: &str, start: f64, end: Option<f64>) -> Cow<'_, str> {
    let len = length(s);
    let clamp = |x: f64| to_integer(x).clamp(0.0, len as f64) as usize;
    let (a, b) = (clamp(start), end.map_or(len, clamp));
    units(s, a.min(b), a.max(b))
}

/// `String.prototype.at(index)`: the code unit there, counted from the end when negative, or
/// `None` (JavaScript's `undefined`) outside the string.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_at("abc", -1.0), Some("c"));
/// assert_eq!(ferrovue::js_at("abc", 3.0), None);
/// ```
pub fn js_at(s: &str, index: f64) -> Option<&str> {
    let len = length(s) as f64;
    let n = to_integer(index);
    let k = if n < 0.0 { len + n } else { n };
    (0.0 <= k && k < len).then(|| unit(s, k as usize))
}

/// `String.prototype.charAt(index)`: the code unit there, or `""` outside the string — a negative
/// index too.
pub fn js_char_at(s: &str, index: f64) -> &str {
    let n = to_integer(index);
    if n < 0.0 || n >= length(s) as f64 {
        ""
    } else {
        unit(s, n as usize)
    }
}

/// `String.prototype.indexOf(search)`: the code unit where `search` first starts, or -1.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_index_of("🦀 crab", "crab"), 3);
/// assert_eq!(ferrovue::js_index_of("abc", "z"), -1);
/// ```
pub fn js_index_of(s: &str, search: &str) -> i64 {
    // The first match of a whole string is the same whether bytes or code units are compared.
    s.find(search).map_or(-1, |byte| js_length(&s[..byte]))
}

/// `String.prototype.lastIndexOf(search)`: the code unit where `search` last starts, or -1.
pub fn js_last_index_of(s: &str, search: &str) -> i64 {
    s.rfind(search).map_or(-1, |byte| js_length(&s[..byte]))
}

/// `String.prototype.split(separator)` with a string separator. An empty separator splits between
/// every code unit, which cuts a pair in two.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_split("a,b,", ","), ["a", "b", ""]);
/// assert_eq!(ferrovue::js_split("", ","), [""]);
/// assert!(ferrovue::js_split("", "").is_empty());
/// ```
pub fn js_split<'s>(s: &'s str, separator: &str) -> Vec<Cow<'s, str>> {
    if !separator.is_empty() {
        return s.split(separator).map(Cow::Borrowed).collect();
    }
    let mut out = Vec::with_capacity(s.len());
    for (byte, c) in s.char_indices() {
        if c.len_utf16() == 1 {
            out.push(Cow::Borrowed(&s[byte..byte + c.len_utf8()]));
        } else {
            out.push(Cow::Borrowed("\u{FFFD}"));
            out.push(Cow::Borrowed("\u{FFFD}"));
        }
    }
    out
}

/// `GetSubstitution` for a string pattern, which has no captures: `$$` is `$`, `$&` the match,
/// `` $` `` what precedes it and `$'` what follows. Any other `$` — `$1`, `$<name>` — is itself.
fn substitute(out: &mut String, replacement: &str, s: &str, start: usize, end: usize) {
    let mut rest = replacement;
    while let Some(i) = rest.find('$') {
        out.push_str(&rest[..i]);
        let (text, used) = match rest.as_bytes().get(i + 1) {
            Some(b'$') => ("$", 2),
            Some(b'&') => (&s[start..end], 2),
            Some(b'`') => (&s[..start], 2),
            Some(b'\'') => (&s[end..], 2),
            _ => ("$", 1),
        };
        out.push_str(text);
        rest = &rest[i + used..];
    }
    out.push_str(rest);
}

/// `String.prototype.replace(pattern, replacement)` with a string pattern: the first match
/// replaced, with the `$` patterns JavaScript reads in the replacement.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_replace("a-b-c", "-", "+"), "a+b-c");
/// assert_eq!(ferrovue::js_replace("abc", "b", "[$&$`$'$$$1]"), "a[bac$$1]c");
/// ```
pub fn js_replace<'s>(s: &'s str, pattern: &str, replacement: &str) -> Cow<'s, str> {
    let Some(start) = s.find(pattern) else {
        return Cow::Borrowed(s);
    };
    let end = start + pattern.len();
    let mut out = String::with_capacity(s.len() + replacement.len());
    out.push_str(&s[..start]);
    substitute(&mut out, replacement, s, start, end);
    out.push_str(&s[end..]);
    Cow::Owned(out)
}

/// `String.prototype.replaceAll(pattern, replacement)` with a string pattern. An empty pattern
/// matches between every code unit, which cuts a pair in two.
pub fn js_replace_all<'s>(s: &'s str, pattern: &str, replacement: &str) -> Cow<'s, str> {
    if pattern.is_empty() {
        return Cow::Owned(replace_between_units(s, replacement));
    }
    let mut matches = s.match_indices(pattern).peekable();
    if matches.peek().is_none() {
        return Cow::Borrowed(s);
    }
    let mut out = String::with_capacity(s.len() + replacement.len());
    let mut last = 0;
    for (start, _) in matches {
        out.push_str(&s[last..start]);
        substitute(&mut out, replacement, s, start, start + pattern.len());
        last = start + pattern.len();
    }
    out.push_str(&s[last..]);
    Cow::Owned(out)
}

/// `replaceAll("", replacement)`: the replacement before every code unit and after the last,
/// worked in UTF-16 — where a half pair split off may meet a half the replacement holds.
fn replace_between_units(s: &str, replacement: &str) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    let repl: Vec<u16> = replacement.encode_utf16().collect();
    let mut out: Vec<u16> = Vec::with_capacity(units.len() * (repl.len() + 1) + repl.len());
    for at in 0..=units.len() {
        // `GetSubstitution` again, on code units: the match is empty, at `at`.
        let mut i = 0;
        while i < repl.len() {
            let next = repl.get(i + 1).copied();
            if repl[i] == u16::from(b'$') {
                match next.and_then(|c| u8::try_from(c).ok()) {
                    Some(b'$') => out.push(u16::from(b'$')),
                    Some(b'&') => {}
                    Some(b'`') => out.extend_from_slice(&units[..at]),
                    Some(b'\'') => out.extend_from_slice(&units[at..]),
                    _ => {
                        out.push(repl[i]);
                        i += 1;
                        continue;
                    }
                }
                i += 2;
            } else {
                out.push(repl[i]);
                i += 1;
            }
        }
        if let Some(&u) = units.get(at) {
            out.push(u);
        }
    }
    String::from_utf16_lossy(&out)
}

/// The first `n` code units of `fill` repeated, a pair cut at the end written as U+FFFD.
fn filler(fill: &str, n: usize) -> String {
    if fill.is_ascii() {
        return fill.bytes().cycle().take(n).map(char::from).collect();
    }
    let units: Vec<u16> = fill.encode_utf16().cycle().take(n).collect();
    String::from_utf16_lossy(&units)
}

fn pad<'s>(s: &'s str, max_length: f64, fill: &str, at_start: bool) -> Cow<'s, str> {
    let len = length(s);
    // `ToLength`: an integer from 0 to 2⁵³ − 1.
    let target = to_integer(max_length).clamp(0.0, 9_007_199_254_740_991.0);
    if target <= len as f64 || fill.is_empty() {
        return Cow::Borrowed(s);
    }
    if target > MAX_STRING_LENGTH {
        panic!("RangeError: Invalid string length (padding to {target} code units)");
    }
    let pad = filler(fill, target as usize - len);
    Cow::Owned(if at_start {
        pad + s
    } else {
        format!("{s}{pad}")
    })
}

/// `String.prototype.padStart(maxLength, fill)`: `fill` (a space, unless given) repeated before `s`
/// up to `maxLength` code units, the last copy cut short.
///
/// # Panics
///
/// Where JavaScript throws a `RangeError`: a `maxLength` beyond the longest string V8 makes,
/// 2²⁹ − 24 code units.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_pad_start("7", 3.0, "0"), "007");
/// assert_eq!(ferrovue::js_pad_start("abc", 10.0, "123"), "1231231abc");
/// ```
pub fn js_pad_start<'s>(s: &'s str, max_length: f64, fill: &str) -> Cow<'s, str> {
    pad(s, max_length, fill, true)
}

/// `String.prototype.padEnd(maxLength, fill)`: [`js_pad_start`], after `s`.
///
/// # Panics
///
/// As [`js_pad_start`] does.
pub fn js_pad_end<'s>(s: &'s str, max_length: f64, fill: &str) -> Cow<'s, str> {
    pad(s, max_length, fill, false)
}

/// `String.prototype.repeat(count)`.
///
/// # Panics
///
/// Where JavaScript throws a `RangeError`: a negative or infinite count, or a result longer than
/// the longest string V8 makes, 2²⁹ − 24 code units.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_repeat("ab", 3.0), "ababab");
/// assert_eq!(ferrovue::js_repeat("ab", 2.9), "abab");
/// assert!(std::panic::catch_unwind(|| ferrovue::js_repeat("ab", -1.0)).is_err());
/// ```
pub fn js_repeat(s: &str, count: f64) -> String {
    let n = to_integer(count);
    if n < 0.0 || n == f64::INFINITY {
        let mut shown = String::new();
        push_number(&mut shown, count);
        panic!("RangeError: Invalid count value: {shown}");
    }
    if n == 0.0 || s.is_empty() {
        return String::new();
    }
    if length(s) as f64 * n > MAX_STRING_LENGTH {
        panic!("RangeError: Invalid string length (repeating {n} times)");
    }
    s.repeat(n as usize)
}

/// How JavaScript orders two strings with `<`: by UTF-16 code unit, which is not the order of the
/// characters — every character from U+E000 to U+FFFF sorts after one beyond U+FFFF, whose first
/// unit is a surrogate.
///
/// # Example
///
/// ```
/// use std::cmp::Ordering;
///
/// assert_eq!(ferrovue::js_cmp("B", "a"), Ordering::Less);
/// // U+FF5E is one unit, 0xFF5E; U+1F980 starts with 0xD83E.
/// assert_eq!(ferrovue::js_cmp("～", "🦀"), Ordering::Greater);
/// assert_eq!("～".cmp("🦀"), Ordering::Less);
/// ```
pub fn js_cmp(a: &str, b: &str) -> Ordering {
    if a.is_ascii() || b.is_ascii() {
        // Code units and bytes agree as far as one string is ASCII: wherever the two first differ,
        // one of them holds an ASCII character, which comes first in both orders.
        return a.as_bytes().cmp(b.as_bytes());
    }
    a.encode_utf16().cmp(b.encode_utf16())
}

/// The value of an ASCII digit in `radix`, if it is one.
fn digit(b: u8, radix: u32) -> Option<u32> {
    char::from(b).to_digit(radix)
}

/// Digits in a power-of-two radix as V8 reads them: exactly while they fit in 53 bits, then rounded
/// to the nearest double, a tie to even.
fn power_of_two_value(digits: &[u8], radix: u32) -> f64 {
    let bits = radix.trailing_zeros();
    let mut number: u64 = 0;
    let mut exponent: i32 = 0;
    for (i, &b) in digits.iter().enumerate() {
        number = number * u64::from(radix) + u64::from(digit(b, radix).expect("a digit"));
        let overflow = number >> 53;
        if overflow == 0 {
            continue;
        }
        let dropped_count = 64 - overflow.leading_zeros();
        let dropped = number & ((1 << dropped_count) - 1);
        number >>= dropped_count;
        exponent = dropped_count as i32;
        let rest = &digits[i + 1..];
        let zero_tail = rest.iter().all(|&d| d == b'0');
        exponent += (rest.len() as i32) * bits as i32;
        let middle = 1 << (dropped_count - 1);
        if dropped > middle || (dropped == middle && (number & 1 == 1 || !zero_tail)) {
            number += 1;
        }
        if number & (1 << 53) != 0 {
            exponent += 1;
            number >>= 1;
        }
        break;
    }
    (number as f64) * 2f64.powi(exponent)
}

/// The length of the longest prefix of `s` that is a `StrDecimalLiteral` — a sign, then
/// `Infinity` or digits with a point and an exponent — if there is one.
fn decimal_prefix(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let digits_from = |mut i: usize| {
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        i
    };
    let mut i = usize::from(matches!(b.first(), Some(b'+' | b'-')));
    if s[i..].starts_with("Infinity") {
        return Some(i + "Infinity".len());
    }
    let int_end = digits_from(i);
    let whole = int_end > i;
    i = int_end;
    if b.get(i) == Some(&b'.') {
        let frac_end = digits_from(i + 1);
        if whole || frac_end > i + 1 {
            i = frac_end;
        } else {
            return None;
        }
    } else if !whole {
        return None;
    }
    if matches!(b.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(b.get(j), Some(b'+' | b'-')) {
            j += 1;
        }
        let exp_end = digits_from(j);
        if exp_end > j {
            i = exp_end;
        }
    }
    Some(i)
}

/// A `StrDecimalLiteral`, already checked, as the nearest double.
fn decimal_value(literal: &str) -> f64 {
    match literal {
        "Infinity" | "+Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        // Rust's parse is correctly rounded, as ECMAScript's is, and reads the same grammar once
        // `Infinity` is out of the way.
        _ => literal.parse().expect("a decimal literal"),
    }
}

/// `Number(s)` of a string: JavaScript's whitespace trimmed, an empty string 0, a decimal literal
/// (`1e3`, `.5`, `-Infinity`) or a `0x`, `0o` or `0b` integer read exactly as JavaScript reads it,
/// and anything else `NaN`.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_number(" 0x1F "), 31.0);
/// assert_eq!(ferrovue::js_number(""), 0.0);
/// assert!(ferrovue::js_number("12px").is_nan());
/// ```
pub fn js_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    let b = t.as_bytes();
    if b.len() > 2 && b[0] == b'0' {
        let radix = match b[1] {
            b'x' | b'X' => 16,
            b'o' | b'O' => 8,
            b'b' | b'B' => 2,
            _ => 0,
        };
        if radix != 0 {
            let digits = &b[2..];
            return if digits.iter().all(|&d| digit(d, radix).is_some()) {
                power_of_two_value(digits, radix)
            } else {
                f64::NAN
            };
        }
    }
    match decimal_prefix(t) {
        Some(n) if n == t.len() => decimal_value(t),
        _ => f64::NAN,
    }
}

/// `parseInt(s)` (`radix` 0) or `parseInt(s, radix)`: leading whitespace and a sign skipped, a `0x`
/// read as hexadecimal unless another radix is given, then as many digits as there are — or `NaN`
/// when there are none.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_parse_int("  42px", 10), 42.0);
/// assert_eq!(ferrovue::js_parse_int("0x1F", 0), 31.0);
/// assert_eq!(ferrovue::js_parse_int("0x1F", 10), 0.0);
/// assert!(ferrovue::js_parse_int("px", 10).is_nan());
/// ```
pub fn js_parse_int(s: &str, radix: u32) -> f64 {
    let t = js_trim_start(s);
    let negative = t.starts_with('-');
    let t = t.strip_prefix(['-', '+']).unwrap_or(t);
    let (radix, t) = match radix {
        0 | 16 => match t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
            Some(rest) => (16, rest),
            None => (if radix == 0 { 10 } else { 16 }, t),
        },
        2..=36 => (radix, t),
        _ => return f64::NAN,
    };
    let n = t.bytes().take_while(|&b| digit(b, radix).is_some()).count();
    if n == 0 {
        return f64::NAN;
    }
    let digits = &t.as_bytes()[..n];
    let value = if radix == 10 {
        // Correctly rounded, as V8 reads them. (V8 keeps 310 digits after any leading zeros, which
        // is already beyond the largest double.)
        t[..n].parse().expect("decimal digits")
    } else if radix.is_power_of_two() {
        power_of_two_value(digits, radix)
    } else {
        // Not reached from generated code, which takes radix 10 or 16 alone: V8 rounds other radices
        // its own way, step by step.
        digits.iter().fold(0.0, |acc, &d| {
            acc * f64::from(radix) + f64::from(digit(d, radix).expect("a digit"))
        })
    };
    if negative { -value } else { value }
}

/// `parseFloat(s)`: leading whitespace skipped, then the longest decimal literal there is — or
/// `NaN` when there is none. Unlike `Number`, it reads no `0x`, and ignores what follows.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_parse_float(" 1.5e3px"), 1500.0);
/// assert_eq!(ferrovue::js_parse_float("0x10"), 0.0);
/// assert!(ferrovue::js_parse_float(".e1").is_nan());
/// ```
pub fn js_parse_float(s: &str) -> f64 {
    let t = js_trim_start(s);
    decimal_prefix(t).map_or(f64::NAN, |n| decimal_value(&t[..n]))
}

/// `JSON.stringify(s)` of a string: quoted, with `"`, `\` and the control characters escaped.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_json_string("a\"b\n\u{1}"), r#""a\"b\n\u0001""#);
/// ```
pub fn js_json_string(s: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `JSON.stringify(x)` of a number: as `String(x)` writes it, but `null` for `NaN` and the
/// infinities.
pub fn js_json_number(x: f64) -> String {
    if !x.is_finite() {
        return "null".to_owned();
    }
    let mut out = String::new();
    push_number(&mut out, x);
    out
}
