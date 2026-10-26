use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::HashSet;

use ferrovue_core::push_number;

use crate::render::Refused;

/// `String.prototype.length`: UTF-16 code units, which is what a template's `.length` counts.
/// `str::len` counts UTF-8 bytes and `chars().count()` scalar values, and either can differ from it.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_length("café"), 4);
/// assert_eq!(ferrovue::strings::js_length("🦀"), 2); // two UTF-16 code units, as JavaScript counts
/// ```
#[must_use]
pub fn js_length(s: &str) -> i64 {
    if s.is_ascii() {
        return s.len() as i64;
    }
    s.chars().map(char::len_utf16).sum::<usize>() as i64
}

/// `String.prototype.trim`: ECMAScript's WhiteSpace and LineTerminator sets, which are not Rust's
/// `char::is_whitespace`: JavaScript trims U+FEFF and keeps U+0085.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_trim("\u{feff} a \u{3000}"), "a");
/// assert_eq!(ferrovue::strings::js_trim("\u{85}a"), "\u{85}a"); // JavaScript keeps U+0085
/// ```
#[must_use]
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `String.prototype.trimStart`: [`js_trim`] at the start alone.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_trim_start("\u{a0} a "), "a ");
/// ```
#[must_use]
pub fn js_trim_start(s: &str) -> &str {
    s.trim_start_matches(is_js_space)
}

/// `String.prototype.trimEnd`: [`js_trim`] at the end alone.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_trim_end(" a \u{feff}"), " a");
/// ```
#[must_use]
pub fn js_trim_end(s: &str) -> &str {
    s.trim_end_matches(is_js_space)
}

pub(crate) fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{A}' | '\u{B}' | '\u{C}' | '\u{D}' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

const MAX_STRING_LENGTH: f64 = ((1 << 29) - 24) as f64;

fn to_integer(x: f64) -> f64 {
    if x.is_nan() { 0.0 } else { x.trunc() + 0.0 }
}

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
/// assert_eq!(ferrovue::strings::js_slice_range(5, -2.0, None), (3, 5));
/// assert_eq!(ferrovue::strings::js_slice_range(5, 4.0, Some(1.0)), (4, 4));
/// assert_eq!(ferrovue::strings::js_slice_range(5, f64::NAN, Some(2.9)), (0, 2));
/// ```
#[must_use]
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
/// let last_two: Vec<i64> = ferrovue::strings::js_slice_items([1, 2, 3].into_iter(), -2.0, None).collect();
/// assert_eq!(last_two, [2, 3]);
/// ```
#[must_use]
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

/// `Array.prototype.at(index)` of a list's items: the item there, counted from the end when
/// negative, or `None` (JavaScript's `undefined`) outside the list.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_item_at([1, 2, 3].into_iter(), -1.0), Some(3));
/// assert_eq!(ferrovue::strings::js_item_at([1, 2, 3].into_iter(), 3.0), None);
/// assert_eq!(ferrovue::strings::js_item_at([1, 2, 3].into_iter(), f64::NAN), Some(1));
/// ```
#[must_use]
pub fn js_item_at<T>(items: impl Iterator<Item = T>, index: f64) -> Option<T> {
    let mut all: Vec<T> = items.collect();
    let len = all.len() as f64;
    let n = to_integer(index);
    let k = if n < 0.0 { len + n } else { n };
    if 0.0 <= k && k < len {
        Some(all.swap_remove(k as usize))
    } else {
        None
    }
}

/// `Array.prototype.reduce(step, init)` of a list's items: `step` given the value so far and each
/// item in turn, starting from `init`.
///
/// # Example
///
/// ```
/// let joined = ferrovue::strings::js_reduce(["a", "b"].into_iter(), String::from(">"), |acc, x| acc + x);
/// assert_eq!(joined, ">ab");
/// assert_eq!(ferrovue::strings::js_reduce(std::iter::empty::<i64>(), 7, |acc, x| acc + x), 7);
/// ```
#[must_use]
pub fn js_reduce<T, A>(items: impl Iterator<Item = T>, init: A, step: impl FnMut(A, T) -> A) -> A {
    items.fold(init, step)
}

/// `Array.prototype.toSorted(compare)` of a list's items: sorted by `compare`, keeping the order
/// of items it finds equal, as JavaScript's engines do.
///
/// # Example
///
/// ```
/// let pairs = [(2, "a"), (1, "b"), (2, "c")];
/// let sorted: Vec<_> = ferrovue::strings::js_sorted(pairs.into_iter(), |a, b| a.0.cmp(&b.0)).collect();
/// assert_eq!(sorted, [(1, "b"), (2, "a"), (2, "c")]);
/// ```
#[must_use]
pub fn js_sorted<T>(
    items: impl Iterator<Item = T>,
    compare: impl FnMut(&T, &T) -> Ordering,
) -> std::vec::IntoIter<T> {
    let mut all: Vec<T> = items.collect();
    all.sort_by(compare);
    all.into_iter()
}

/// `Array.prototype.toSorted()` without a comparator: the items ordered by the strings `key` gives
/// them, `String(x)` in JavaScript, compared by UTF-16 code unit as [`js_cmp`] compares them, items
/// with equal strings in their order.
///
/// # Example
///
/// ```
/// let key = |v: &i64| ferrovue::core::Js(*v).to_string();
/// let sorted: Vec<i64> = ferrovue::strings::js_sorted_by_string([10, 9, 1].into_iter(), key).collect();
/// assert_eq!(sorted, [1, 10, 9]);
/// ```
#[must_use]
pub fn js_sorted_by_string<T>(
    items: impl Iterator<Item = T>,
    mut key: impl FnMut(&T) -> String,
) -> std::vec::IntoIter<T> {
    let mut keyed: Vec<(String, T)> = items.map(|v| (key(&v), v)).collect();
    keyed.sort_by(|a, b| js_cmp(&a.0, &b.0));
    keyed
        .into_iter()
        .map(|(_, v)| v)
        .collect::<Vec<T>>()
        .into_iter()
}

/// The order a sort takes from a comparator returning `a - b`: by the sign of the difference, and
/// equal where it is `NaN` or zero.
///
/// # Example
///
/// ```
/// use std::cmp::Ordering;
///
/// assert_eq!(ferrovue::strings::js_order(1.0, 2.0), Ordering::Less);
/// assert_eq!(ferrovue::strings::js_order(-0.0, 0.0), Ordering::Equal);
/// assert_eq!(ferrovue::strings::js_order(f64::INFINITY, f64::INFINITY), Ordering::Equal);
/// ```
#[must_use]
pub fn js_order(a: f64, b: f64) -> Ordering {
    let d = a - b;
    if d < 0.0 {
        Ordering::Less
    } else if d > 0.0 {
        Ordering::Greater
    } else {
        Ordering::Equal
    }
}

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

fn length(s: &str) -> usize {
    js_length(s) as usize
}

/// `String.prototype.slice(start, end)`, on UTF-16 code units.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_slice("café au lait", -4.0, None), "lait");
/// // Half of 🦀 is a lone surrogate in JavaScript, sent as U+FFFD.
/// assert_eq!(ferrovue::strings::js_slice("🦀x", 1.0, None), "\u{FFFD}x");
/// ```
#[must_use]
pub fn js_slice(s: &str, start: f64, end: Option<f64>) -> Cow<'_, str> {
    let (from, to) = js_slice_range(length(s), start, end);
    units(s, from, to)
}

/// `String.prototype.substring(start, end)`: negative indices are 0, and the two are swapped when
/// `start` is the larger.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_substring("ferrovue", 5.0, Some(1.0)), "erro");
/// assert_eq!(ferrovue::strings::js_substring("ferrovue", -3.0, Some(4.0)), "ferr");
/// assert_eq!(ferrovue::strings::js_substring("🦀 crab", 3.0, None), "crab");
/// ```
#[must_use]
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
/// assert_eq!(ferrovue::strings::js_at("abc", -1.0), Some("c"));
/// assert_eq!(ferrovue::strings::js_at("abc", 3.0), None);
/// ```
#[must_use]
pub fn js_at(s: &str, index: f64) -> Option<&str> {
    let len = length(s) as f64;
    let n = to_integer(index);
    let k = if n < 0.0 { len + n } else { n };
    (0.0 <= k && k < len).then(|| unit(s, k as usize))
}

/// `String.prototype.charAt(index)`: the code unit there, or `""` outside the string (a negative
/// index too.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_char_at("abc", 1.0), "b");
/// assert_eq!(ferrovue::strings::js_char_at("abc", -1.0), "");
/// // Half of 🦀, sent as U+FFFD.
/// assert_eq!(ferrovue::strings::js_char_at("🦀", 1.0), "\u{FFFD}");
/// ```
#[must_use]
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
/// assert_eq!(ferrovue::strings::js_index_of("🦀 crab", "crab"), 3);
/// assert_eq!(ferrovue::strings::js_index_of("abc", "z"), -1);
/// ```
#[must_use]
pub fn js_index_of(s: &str, search: &str) -> i64 {
    s.find(search).map_or(-1, |byte| js_length(&s[..byte]))
}

/// `String.prototype.lastIndexOf(search)`: the code unit where `search` last starts, or -1.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_last_index_of("🦀 a 🦀 a", "a"), 8);
/// assert_eq!(ferrovue::strings::js_last_index_of("abc", "z"), -1);
/// ```
#[must_use]
pub fn js_last_index_of(s: &str, search: &str) -> i64 {
    s.rfind(search).map_or(-1, |byte| js_length(&s[..byte]))
}

fn clamped_unit(s: &str, x: f64) -> usize {
    to_integer(x).clamp(0.0, length(s) as f64) as usize
}

fn char_start(s: &str, unit: usize) -> usize {
    match boundary(s, unit) {
        (byte, true) => byte - 4,
        (byte, false) => byte,
    }
}

/// `String.prototype.includes(search, position)`: whether `search` starts at or after the code unit
/// `position`.
///
/// # Example
///
/// ```
/// assert!(ferrovue::strings::js_includes_from("abcabc", "a", 1.0));
/// assert!(!ferrovue::strings::js_includes_from("abcabc", "a", 4.0));
/// assert!(ferrovue::strings::js_includes_from("abc", "", 99.0));
/// ```
#[must_use]
pub fn js_includes_from(s: &str, search: &str, position: f64) -> bool {
    let (byte, _) = boundary(s, clamped_unit(s, position));
    s[byte..].contains(search)
}

/// `String.prototype.startsWith(search, position)`: whether `search` starts at the code unit
/// `position`. Inside a surrogate pair only `""` does.
///
/// # Example
///
/// ```
/// assert!(ferrovue::strings::js_starts_with_at("abc", "bc", 1.0));
/// assert!(!ferrovue::strings::js_starts_with_at("🦀x", "x", 1.0));
/// assert!(ferrovue::strings::js_starts_with_at("abc", "", -5.0));
/// ```
#[must_use]
pub fn js_starts_with_at(s: &str, search: &str, position: f64) -> bool {
    match boundary(s, clamped_unit(s, position)) {
        (_, true) => search.is_empty(),
        (byte, false) => s[byte..].starts_with(search),
    }
}

/// `String.prototype.endsWith(search, endPosition)`: whether `search` ends at the code unit
/// `endPosition`. Inside a surrogate pair only `""` does.
///
/// # Example
///
/// ```
/// assert!(ferrovue::strings::js_ends_with_at("abc", "ab", 2.0));
/// assert!(!ferrovue::strings::js_ends_with_at("x🦀", "x", 2.0));
/// assert!(ferrovue::strings::js_ends_with_at("abc", "abc", f64::INFINITY));
/// ```
#[must_use]
pub fn js_ends_with_at(s: &str, search: &str, end_position: f64) -> bool {
    match boundary(s, clamped_unit(s, end_position)) {
        (_, true) => search.is_empty(),
        (byte, false) => s[..byte].ends_with(search),
    }
}

/// `String.prototype.indexOf(search, position)`: the first code unit at or after `position` where
/// `search` starts, or -1. `""` is found at `position` itself, inside a surrogate pair too.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_index_of_from("abcabc", "a", 1.0), 3);
/// assert_eq!(ferrovue::strings::js_index_of_from("abc", "", 10.0), 3);
/// assert_eq!(ferrovue::strings::js_index_of_from("🦀", "", 1.0), 1);
/// ```
#[must_use]
pub fn js_index_of_from(s: &str, search: &str, position: f64) -> i64 {
    let from = clamped_unit(s, position);
    if search.is_empty() {
        return from as i64;
    }
    let (byte, _) = boundary(s, from);
    s[byte..]
        .find(search)
        .map_or(-1, |at| js_length(&s[..byte + at]))
}

/// `String.prototype.lastIndexOf(search, position)`: the last code unit at or before `position`
/// where `search` starts, or -1. A `position` that is `NaN` is the end of the string.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_last_index_of_from("abcabc", "a", 2.0), 0);
/// assert_eq!(ferrovue::strings::js_last_index_of_from("abcabc", "a", f64::NAN), 3);
/// assert_eq!(ferrovue::strings::js_last_index_of_from("abc", "", 1.0), 1);
/// ```
#[must_use]
pub fn js_last_index_of_from(s: &str, search: &str, position: f64) -> i64 {
    let len = length(s);
    let searched = length(search);
    if searched > len {
        return -1;
    }
    let pos = if position.is_nan() {
        f64::INFINITY
    } else {
        to_integer(position)
    };
    let start = pos.clamp(0.0, (len - searched) as f64) as usize;
    if search.is_empty() {
        return start as i64;
    }
    let mut end = (char_start(s, start) + search.len()).min(s.len());
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].rfind(search).map_or(-1, |at| js_length(&s[..at]))
}

/// `String.prototype.substr(start, length)`: `length` code units from `start`, which counts from
/// the end when negative.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_substr("ferrovue", 5.0, Some(2.0)), "vu");
/// assert_eq!(ferrovue::strings::js_substr("ferrovue", -3.0, None), "vue");
/// assert_eq!(ferrovue::strings::js_substr("ferrovue", 1.0, Some(-1.0)), "");
/// ```
#[must_use]
pub fn js_substr(s: &str, start: f64, length: Option<f64>) -> Cow<'_, str> {
    let len = self::length(s);
    let from = relative(start, len);
    let count = length.map_or(len, |l| to_integer(l).clamp(0.0, len as f64) as usize);
    units(s, from, (from + count).min(len))
}

/// `String.prototype.charCodeAt(index)`: the code unit there, or `NaN` outside the string.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_char_code_at("abc", 1.0), 98.0);
/// assert_eq!(ferrovue::strings::js_char_code_at("🦀", 1.0), 56704.0);
/// assert!(ferrovue::strings::js_char_code_at("abc", 3.0).is_nan());
/// ```
#[must_use]
pub fn js_char_code_at(s: &str, index: f64) -> f64 {
    let n = to_integer(index);
    if n < 0.0 || n >= length(s) as f64 {
        return f64::NAN;
    }
    f64::from(
        s.encode_utf16()
            .nth(n as usize)
            .expect("a code unit in range"),
    )
}

/// `String.prototype.codePointAt(index)`: the code point that starts at the code unit there, the
/// second half of a pair alone when `index` is inside one, or `None` (JavaScript's `undefined`)
/// outside the string.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_code_point_at("🦀", 0.0), Some(0x1F980));
/// assert_eq!(ferrovue::strings::js_code_point_at("🦀", 1.0), Some(0xDD80));
/// assert_eq!(ferrovue::strings::js_code_point_at("abc", -1.0), None);
/// ```
#[must_use]
pub fn js_code_point_at(s: &str, index: f64) -> Option<i64> {
    let n = to_integer(index);
    if n < 0.0 || n >= length(s) as f64 {
        return None;
    }
    let mut rest = s.encode_utf16().skip(n as usize);
    let first = rest.next().expect("a code unit in range");
    let point = match (first, rest.next()) {
        (0xD800..=0xDBFF, Some(second @ 0xDC00..=0xDFFF)) => {
            0x10000 + ((u32::from(first) - 0xD800) << 10) + (u32::from(second) - 0xDC00)
        }
        _ => u32::from(first),
    };
    Some(i64::from(point))
}

/// `String.prototype.split(separator, limit)`: [`js_split`], its first `limit` pieces, the limit
/// taken as JavaScript's `ToUint32` takes it (`-1` is 4294967295, `NaN` and the infinities 0).
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_split_limit("a,b,c", ",", 2.0), ["a", "b"]);
/// assert_eq!(ferrovue::strings::js_split_limit("a,b,c", ",", -1.0), ["a", "b", "c"]);
/// assert!(ferrovue::strings::js_split_limit("a,b,c", ",", 4294967296.0).is_empty());
/// ```
#[must_use]
pub fn js_split_limit<'s>(s: &'s str, separator: &str, limit: f64) -> Vec<Cow<'s, str>> {
    let lim = if limit.is_finite() {
        limit.trunc().rem_euclid(4_294_967_296.0) as usize
    } else {
        0
    };
    if lim == 0 {
        return Vec::new();
    }
    let mut pieces = js_split(s, separator);
    pieces.truncate(lim);
    pieces
}

/// An optional value as JavaScript's `String()` and template literals write one: the value, or
/// `undefined` or `null` (`.1`) when it is absent.
///
/// # Example
///
/// ```
/// let n: Option<i64> = None;
/// assert_eq!(format!("{}", ferrovue::strings::JsOr(n.map(ferrovue::core::Js), "undefined")), "undefined");
/// assert_eq!(format!("{}", ferrovue::strings::JsOr(Some(ferrovue::core::Js(2.5)), "null")), "2.5");
/// ```
#[derive(Debug, Clone, Copy)]
pub struct JsOr<T>(pub Option<T>, pub &'static str);

impl<T: std::fmt::Display> std::fmt::Display for JsOr<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.0 {
            Some(v) => v.fmt(f),
            None => f.write_str(self.1),
        }
    }
}

/// `String.prototype.split(separator)` with a string separator. An empty separator splits between
/// every code unit, which cuts a pair in two.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_split("a,b,", ","), ["a", "b", ""]);
/// assert_eq!(ferrovue::strings::js_split("", ","), [""]);
/// assert!(ferrovue::strings::js_split("", "").is_empty());
/// ```
#[must_use]
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
/// assert_eq!(ferrovue::strings::js_replace("a-b-c", "-", "+"), "a+b-c");
/// assert_eq!(ferrovue::strings::js_replace("abc", "b", "[$&$`$'$$$1]"), "a[bac$$1]c");
/// ```
#[must_use]
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
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_replace_all("a-b-c", "-", "+"), "a+b+c");
/// assert_eq!(ferrovue::strings::js_replace_all("ab", "", "."), ".a.b.");
/// assert_eq!(ferrovue::strings::js_replace_all("abc", "z", "y"), "abc");
/// ```
#[must_use]
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

fn replace_between_units(s: &str, replacement: &str) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    let repl: Vec<u16> = replacement.encode_utf16().collect();
    let mut out: Vec<u16> = Vec::with_capacity(units.len() * (repl.len() + 1) + repl.len());
    for at in 0..=units.len() {
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

fn filler(fill: &str, n: usize) -> String {
    if fill.is_ascii() {
        return fill.bytes().cycle().take(n).map(char::from).collect();
    }
    let units: Vec<u16> = fill.encode_utf16().cycle().take(n).collect();
    String::from_utf16_lossy(&units)
}

fn pad<'s>(
    s: &'s str,
    max_length: f64,
    fill: &str,
    at_start: bool,
) -> Result<Cow<'s, str>, Refused> {
    let len = length(s);
    let target = to_integer(max_length).clamp(0.0, 9_007_199_254_740_991.0);
    if target <= len as f64 || fill.is_empty() {
        return Ok(Cow::Borrowed(s));
    }
    if target > MAX_STRING_LENGTH {
        return Err(too_long(target, "padding"));
    }
    let pad = filler(fill, target as usize - len);
    Ok(Cow::Owned(if at_start {
        pad + s
    } else {
        format!("{s}{pad}")
    }))
}

#[cold]
fn too_long(units: f64, how: &str) -> Refused {
    let mut shown = String::new();
    push_number(&mut shown, units);
    Refused::new(
        "FV0725",
        format!(
            "{how} makes a string of {shown} code units, beyond the longest string V8 makes \
             (2²⁹ − 24), where JavaScript throws a RangeError (Invalid string length) and Vue's \
             render fails too: limit the length or the count, or check the props before rendering"
        ),
    )
}

/// `String.prototype.padStart(maxLength, fill)`: `fill` (a space, unless given) repeated before `s`
/// up to `maxLength` code units, the last copy cut short.
///
/// # Panics
///
/// Where JavaScript throws a `RangeError`: a `maxLength` beyond the longest string V8 makes,
/// 2²⁹ − 24 code units. [`try_pad_start`] returns the refusal.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_pad_start("7", 3.0, "0"), "007");
/// assert_eq!(ferrovue::strings::js_pad_start("abc", 10.0, "123"), "1231231abc");
/// ```
#[must_use]
pub fn js_pad_start<'s>(s: &'s str, max_length: f64, fill: &str) -> Cow<'s, str> {
    pad(s, max_length, fill, true).unwrap_or_else(|refused| panic!("{refused}"))
}

/// [`js_pad_start`], returning the refusal where it panics.
///
/// # Errors
///
/// FV0725 where [`js_pad_start`] panics.
#[doc(hidden)]
pub fn try_pad_start<'s>(s: &'s str, max_length: f64, fill: &str) -> Result<Cow<'s, str>, Refused> {
    pad(s, max_length, fill, true)
}

/// `String.prototype.padEnd(maxLength, fill)`: [`js_pad_start`], after `s`.
///
/// # Panics
///
/// As [`js_pad_start`] does.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_pad_end("7", 3.0, "."), "7..");
/// // 🦀 is two code units: padding by one keeps its first half, sent as U+FFFD.
/// assert_eq!(ferrovue::strings::js_pad_end("a", 2.0, "🦀"), "a\u{FFFD}");
/// ```
#[must_use]
pub fn js_pad_end<'s>(s: &'s str, max_length: f64, fill: &str) -> Cow<'s, str> {
    pad(s, max_length, fill, false).unwrap_or_else(|refused| panic!("{refused}"))
}

/// [`js_pad_end`], returning the refusal where it panics.
///
/// # Errors
///
/// FV0725 where [`js_pad_end`] panics.
#[doc(hidden)]
pub fn try_pad_end<'s>(s: &'s str, max_length: f64, fill: &str) -> Result<Cow<'s, str>, Refused> {
    pad(s, max_length, fill, false)
}

/// `String.prototype.repeat(count)`.
///
/// # Panics
///
/// Where JavaScript throws a `RangeError`: a negative or infinite count, or a result longer than
/// the longest string V8 makes, 2²⁹ − 24 code units. [`try_repeat`] returns the refusal.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_repeat("ab", 3.0), "ababab");
/// assert_eq!(ferrovue::strings::js_repeat("ab", 2.9), "abab");
/// assert!(std::panic::catch_unwind(|| ferrovue::strings::js_repeat("ab", -1.0)).is_err());
/// ```
#[must_use]
pub fn js_repeat(s: &str, count: f64) -> String {
    try_repeat(s, count).unwrap_or_else(|refused| panic!("{refused}"))
}

/// [`js_repeat`], returning the refusal where it panics.
///
/// # Errors
///
/// FV0714 for a negative or infinite count, FV0725 for a result longer than V8's longest string.
#[doc(hidden)]
pub fn try_repeat(s: &str, count: f64) -> Result<String, Refused> {
    let n = to_integer(count);
    if n < 0.0 || n == f64::INFINITY {
        let mut shown = String::new();
        push_number(&mut shown, count);
        return Err(Refused::new(
            "FV0714",
            format!(
                "`.repeat()` by a count of {shown}, where JavaScript throws a RangeError (Invalid \
                 count value) and Vue's render fails too: clamp the count (`Math.max(0, n)`), or \
                 check the props before rendering"
            ),
        ));
    }
    if n == 0.0 || s.is_empty() {
        return Ok(String::new());
    }
    let units = length(s) as f64 * n;
    if units > MAX_STRING_LENGTH {
        return Err(too_long(units, "`.repeat()`"));
    }
    Ok(s.repeat(n as usize))
}

/// How JavaScript orders two strings with `<`: by UTF-16 code unit, which is not the order of the
/// characters: every character from U+E000 to U+FFFF sorts after one beyond U+FFFF, whose first
/// unit is a surrogate.
///
/// # Example
///
/// ```
/// use std::cmp::Ordering;
///
/// assert_eq!(ferrovue::strings::js_cmp("B", "a"), Ordering::Less);
/// // U+FF5E is one unit, 0xFF5E; U+1F980 starts with 0xD83E.
/// assert_eq!(ferrovue::strings::js_cmp("～", "🦀"), Ordering::Greater);
/// assert_eq!("～".cmp("🦀"), Ordering::Less);
/// ```
#[must_use]
pub fn js_cmp(a: &str, b: &str) -> Ordering {
    if a.is_ascii() || b.is_ascii() {
        return a.as_bytes().cmp(b.as_bytes());
    }
    a.encode_utf16().cmp(b.encode_utf16())
}

fn digit(b: u8, radix: u32) -> Option<u32> {
    char::from(b).to_digit(radix)
}

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

fn decimal_value(literal: &str) -> f64 {
    match literal {
        "Infinity" | "+Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
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
/// assert_eq!(ferrovue::strings::js_number(" 0x1F "), 31.0);
/// assert_eq!(ferrovue::strings::js_number(""), 0.0);
/// assert!(ferrovue::strings::js_number("12px").is_nan());
/// ```
#[must_use]
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
/// read as hexadecimal unless another radix is given, then as many digits as there are, or `NaN`
/// when there are none.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_parse_int("  42px", 10), 42.0);
/// assert_eq!(ferrovue::strings::js_parse_int("0x1F", 0), 31.0);
/// assert_eq!(ferrovue::strings::js_parse_int("0x1F", 10), 0.0);
/// assert!(ferrovue::strings::js_parse_int("px", 10).is_nan());
/// ```
#[must_use]
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
        t[..n].parse().expect("decimal digits")
    } else if radix.is_power_of_two() {
        power_of_two_value(digits, radix)
    } else {
        digits.iter().fold(0.0, |acc, &d| {
            acc * f64::from(radix) + f64::from(digit(d, radix).expect("a digit"))
        })
    };
    if negative { -value } else { value }
}

/// `parseFloat(s)`: leading whitespace skipped, then the longest decimal literal there is, or
/// `NaN` when there is none. Unlike `Number`, it reads no `0x`, and ignores what follows.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_parse_float(" 1.5e3px"), 1500.0);
/// assert_eq!(ferrovue::strings::js_parse_float("0x10"), 0.0);
/// assert!(ferrovue::strings::js_parse_float(".e1").is_nan());
/// ```
#[must_use]
pub fn js_parse_float(s: &str) -> f64 {
    let t = js_trim_start(s);
    decimal_prefix(t).map_or(f64::NAN, |n| decimal_value(&t[..n]))
}

/// `JSON.stringify(s)` of a string: quoted, with `"`, `\` and the control characters escaped.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_json_string("a\"b\n\u{1}"), r#""a\"b\n\u0001""#);
/// ```
#[must_use]
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
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::strings::js_json_number(0.1 + 0.2), "0.30000000000000004");
/// assert_eq!(ferrovue::strings::js_json_number(-0.0), "0");
/// assert_eq!(ferrovue::strings::js_json_number(f64::INFINITY), "null");
/// ```
#[must_use]
pub fn js_json_number(x: f64) -> String {
    if !x.is_finite() {
        return "null".to_owned();
    }
    let mut out = String::new();
    push_number(&mut out, x);
    out
}

/// A regular expression literal of a template, in the subset the compiler translates: characters,
/// `.`, classes with ranges and `\d`, `\w`, `\s` and their negations, `^`, `$`, `\b` and `\B`,
/// the quantifiers `*`, `+`, `?` and `{n,m}`, greedy or lazy, and the flags `g` and `i`. It matches
/// over UTF-16 code units, as JavaScript's does without the `u` flag.
#[derive(Debug, Clone)]
pub struct JsRegex {
    pieces: Vec<Piece>,
    global: bool,
    ignore_case: bool,
}

#[derive(Debug, Clone)]
enum Atom {
    Unit(u16),
    Any,
    Class(Vec<(u16, u16)>, bool, Option<HashSet<u16>>),
    Start,
    End,
    Boundary(bool),
}

#[derive(Debug, Clone)]
struct Piece {
    atom: Atom,
    min: usize,
    max: usize,
    greedy: bool,
}

const SPACES: [(u16, u16); 10] = [
    (0x09, 0x0D),
    (0x20, 0x20),
    (0xA0, 0xA0),
    (0x1680, 0x1680),
    (0x2000, 0x200A),
    (0x2028, 0x2029),
    (0x202F, 0x202F),
    (0x205F, 0x205F),
    (0x3000, 0x3000),
    (0xFEFF, 0xFEFF),
];
const DIGITS: [(u16, u16); 1] = [(0x30, 0x39)];
const WORD: [(u16, u16); 4] = [(0x30, 0x39), (0x41, 0x5A), (0x5F, 0x5F), (0x61, 0x7A)];

fn negated(ranges: &[(u16, u16)]) -> Vec<(u16, u16)> {
    let mut out = Vec::new();
    let mut next = 0_u32;
    for &(lo, hi) in ranges {
        if u32::from(lo) > next {
            out.push((next as u16, lo - 1));
        }
        next = u32::from(hi) + 1;
    }
    if next <= 0xFFFF {
        out.push((next as u16, 0xFFFF));
    }
    out
}

fn escape_class(c: char) -> Option<Vec<(u16, u16)>> {
    match c {
        'd' => Some(DIGITS.to_vec()),
        'D' => Some(negated(&DIGITS)),
        'w' => Some(WORD.to_vec()),
        'W' => Some(negated(&WORD)),
        's' => Some(SPACES.to_vec()),
        'S' => Some(negated(&SPACES)),
        _ => None,
    }
}

struct Parser<'p> {
    units: Vec<u16>,
    at: usize,
    pattern: &'p str,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u16> {
        self.units.get(self.at).copied()
    }

    fn next(&mut self) -> Result<u16, String> {
        let unit = self
            .peek()
            .ok_or_else(|| format!("`/{}/` ends too early", self.pattern))?;
        self.at += 1;
        Ok(unit)
    }

    fn hex(&mut self, digits: usize) -> Result<u16, String> {
        let mut value = 0_u16;
        for _ in 0..digits {
            let unit = self.next()?;
            let digit = char::from_u32(u32::from(unit))
                .and_then(|c| c.to_digit(16))
                .ok_or_else(|| {
                    format!(
                        "`/{}/` has an escape with a digit that is not hexadecimal",
                        self.pattern
                    )
                })?;
            value = value * 16 + digit as u16;
        }
        Ok(value)
    }

    fn escape(&mut self, in_class: bool) -> Result<Result<u16, Vec<(u16, u16)>>, String> {
        let unit = self.next()?;
        let c = char::from_u32(u32::from(unit)).unwrap_or('\u{FFFD}');
        if let Some(ranges) = escape_class(c) {
            return Ok(Err(ranges));
        }
        Ok(Ok(match c {
            't' => 0x09,
            'n' => 0x0A,
            'v' => 0x0B,
            'f' => 0x0C,
            'r' => 0x0D,
            '0' if !self.peek().is_some_and(|u| (0x30..=0x39).contains(&u)) => 0,
            'x' => self.hex(2)?,
            'u' => self.hex(4)?,
            'b' if in_class => 0x08,
            '-' if in_class => unit,
            '^' | '$' | '\\' | '.' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '|'
            | '/' => unit,
            _ => {
                return Err(format!(
                    "`/{}/` has the escape `\\{c}`, which the server does not translate",
                    self.pattern
                ));
            }
        }))
    }

    fn class(&mut self) -> Result<Atom, String> {
        let negate = self.peek() == Some(u16::from(b'^'));
        if negate {
            self.at += 1;
        }
        let mut ranges = Vec::new();
        loop {
            let unit = self.next()?;
            if unit == u16::from(b']') {
                break;
            }
            let low = if unit == u16::from(b'\\') {
                match self.escape(true)? {
                    Ok(u) => u,
                    Err(set) => {
                        ranges.extend(set);
                        continue;
                    }
                }
            } else {
                unit
            };
            if self.peek() == Some(u16::from(b'-'))
                && self.units.get(self.at + 1) != Some(&u16::from(b']'))
            {
                self.at += 1;
                let unit = self.next()?;
                let high = if unit == u16::from(b'\\') {
                    match self.escape(true)? {
                        Ok(u) => u,
                        Err(_) => {
                            return Err(format!(
                                "`/{}/` has a range that ends at a class escape",
                                self.pattern
                            ));
                        }
                    }
                } else {
                    unit
                };
                if high < low {
                    return Err(format!("`/{}/` has a range out of order", self.pattern));
                }
                ranges.push((low, high));
            } else {
                ranges.push((low, low));
            }
        }
        Ok(Atom::Class(ranges, negate, None))
    }

    fn number(&mut self) -> Option<usize> {
        let start = self.at;
        while self.peek().is_some_and(|u| (0x30..=0x39).contains(&u)) {
            self.at += 1;
        }
        String::from_utf16(&self.units[start..self.at])
            .ok()?
            .parse()
            .ok()
    }

    fn quantifier(&mut self) -> Result<Option<(usize, usize)>, String> {
        let Some(unit) = self.peek() else {
            return Ok(None);
        };
        let bounds = match unit {
            0x2A => (0, usize::MAX),
            0x2B => (1, usize::MAX),
            0x3F => (0, 1),
            0x7B => {
                let start = self.at;
                self.at += 1;
                let Some(min) = self.number() else {
                    self.at = start;
                    return Ok(None);
                };
                let max = if self.peek() == Some(u16::from(b',')) {
                    self.at += 1;
                    if self.peek() == Some(u16::from(b'}')) {
                        usize::MAX
                    } else {
                        self.number().unwrap_or(usize::MAX - 1)
                    }
                } else {
                    min
                };
                if self.peek() != Some(u16::from(b'}')) || max == usize::MAX - 1 {
                    self.at = start;
                    return Ok(None);
                }
                if max < min {
                    return Err(format!(
                        "`/{}/` has a quantifier out of order",
                        self.pattern
                    ));
                }
                (min, max)
            }
            _ => return Ok(None),
        };
        self.at += 1;
        Ok(Some(bounds))
    }

    fn parse(mut self) -> Result<Vec<Piece>, String> {
        let mut pieces: Vec<Piece> = Vec::new();
        while let Some(unit) = self.peek() {
            self.at += 1;
            let atom = match unit {
                0x5E => Atom::Start,
                0x24 => Atom::End,
                0x2E => Atom::Any,
                0x5B => self.class()?,
                0x5C => {
                    if self.peek() == Some(u16::from(b'b')) || self.peek() == Some(u16::from(b'B'))
                    {
                        let word = self.next()? == u16::from(b'b');
                        Atom::Boundary(word)
                    } else {
                        match self.escape(false)? {
                            Ok(u) => Atom::Unit(u),
                            Err(set) => Atom::Class(set, false, None),
                        }
                    }
                }
                0x28 | 0x29 | 0x7C | 0x5D | 0x7D | 0x2A | 0x2B | 0x3F | 0x7B => {
                    let c = char::from_u32(u32::from(unit)).unwrap_or('?');
                    return Err(format!(
                        "`/{}/` holds `{c}` where the server's subset has none",
                        self.pattern
                    ));
                }
                _ => Atom::Unit(unit),
            };
            let zero_width = matches!(atom, Atom::Start | Atom::End | Atom::Boundary(_));
            let (min, max, greedy) = match self.quantifier()? {
                Some(_) if zero_width => {
                    return Err(format!("`/{}/` quantifies an assertion", self.pattern));
                }
                Some((min, max)) => {
                    let lazy = self.peek() == Some(u16::from(b'?'));
                    if lazy {
                        self.at += 1;
                    }
                    (min, max, !lazy)
                }
                None => (1, 1, true),
            };
            pieces.push(Piece {
                atom,
                min,
                max,
                greedy,
            });
        }
        Ok(pieces)
    }
}

fn canonical(unit: u16) -> u16 {
    let Some(c) = char::from_u32(u32::from(unit)) else {
        return unit;
    };
    let mut upper = c.to_uppercase();
    match (upper.next(), upper.next()) {
        (Some(u), None) if u.len_utf16() == 1 && !(unit >= 128 && (u as u32) < 128) => u as u16,
        _ => unit,
    }
}

fn is_word(unit: u16) -> bool {
    WORD.iter().any(|&(lo, hi)| (lo..=hi).contains(&unit))
}

impl JsRegex {
    /// The literal `/pattern/flags`.
    ///
    /// # Errors
    ///
    /// When `pattern` or `flags` leave the subset, with what is outside it.
    pub fn parse(pattern: &str, flags: &str) -> Result<JsRegex, String> {
        let mut global = false;
        let mut ignore_case = false;
        for f in flags.chars() {
            match f {
                'g' if !global => global = true,
                'i' if !ignore_case => ignore_case = true,
                _ => {
                    return Err(format!(
                        "`/{pattern}/{flags}` has the flag `{f}`, which the server does not translate"
                    ));
                }
            }
        }
        let mut pieces = Parser {
            units: pattern.encode_utf16().collect(),
            at: 0,
            pattern,
        }
        .parse()?;
        if ignore_case {
            for p in &mut pieces {
                if let Atom::Class(ranges, _, folded) = &mut p.atom {
                    *folded = Some(
                        ranges
                            .iter()
                            .flat_map(|&(lo, hi)| lo..=hi)
                            .map(canonical)
                            .collect(),
                    );
                }
            }
        }
        Ok(JsRegex {
            pieces,
            global,
            ignore_case,
        })
    }

    /// The literal `/pattern/flags`, which the compiler checked.
    ///
    /// # Panics
    ///
    /// When it leaves the subset, which the compiler refuses.
    #[must_use]
    pub fn new(pattern: &str, flags: &str) -> JsRegex {
        match JsRegex::parse(pattern, flags) {
            Ok(re) => re,
            Err(e) => panic!("{e}"),
        }
    }

    fn matches_unit(&self, atom: &Atom, unit: u16) -> bool {
        match atom {
            Atom::Unit(u) => *u == unit || (self.ignore_case && canonical(*u) == canonical(unit)),
            Atom::Any => !matches!(unit, 0x0A | 0x0D | 0x2028 | 0x2029),
            Atom::Class(ranges, negate, folded) => {
                let found = ranges.iter().any(|&(lo, hi)| (lo..=hi).contains(&unit))
                    || folded
                        .as_ref()
                        .is_some_and(|set| set.contains(&canonical(unit)));
                found != *negate
            }
            Atom::Start | Atom::End | Atom::Boundary(_) => false,
        }
    }

    fn assertion(atom: &Atom, text: &[u16], at: usize) -> Option<bool> {
        match atom {
            Atom::Start => Some(at == 0),
            Atom::End => Some(at == text.len()),
            Atom::Boundary(word) => {
                let before = at > 0 && is_word(text[at - 1]);
                let after = at < text.len() && is_word(text[at]);
                Some((before != after) == *word)
            }
            _ => None,
        }
    }

    fn match_from(&self, piece: usize, text: &[u16], at: usize) -> Option<usize> {
        let Some(p) = self.pieces.get(piece) else {
            return Some(at);
        };
        if let Some(holds) = JsRegex::assertion(&p.atom, text, at) {
            return if holds {
                self.match_from(piece + 1, text, at)
            } else {
                None
            };
        }
        let mut count = 0;
        while count < p.max
            && at + count < text.len()
            && self.matches_unit(&p.atom, text[at + count])
        {
            count += 1;
        }
        if count < p.min {
            return None;
        }
        if p.greedy {
            (p.min..=count)
                .rev()
                .find_map(|n| self.match_from(piece + 1, text, at + n))
        } else {
            (p.min..=count).find_map(|n| self.match_from(piece + 1, text, at + n))
        }
    }

    fn find(&self, text: &[u16], from: usize) -> Option<(usize, usize)> {
        (from..=text.len())
            .find_map(|start| self.match_from(0, text, start).map(|end| (start, end)))
    }

    /// `regex.test(s)` of the literal.
    #[must_use]
    pub fn test(&self, s: &str) -> bool {
        let text: Vec<u16> = s.encode_utf16().collect();
        self.find(&text, 0).is_some()
    }

    /// `s.replace(regex, replacement)`, every match with the `g` flag, as `replaceAll` does.
    #[must_use]
    pub fn replace(&self, s: &str, replacement: &str) -> String {
        let text: Vec<u16> = s.encode_utf16().collect();
        let with: Vec<u16> = replacement.encode_utf16().collect();
        let mut out: Vec<u16> = Vec::with_capacity(text.len());
        let mut copied = 0;
        let mut from = 0;
        while let Some((start, end)) = self.find(&text, from) {
            out.extend_from_slice(&text[copied..start]);
            substitute_units(&mut out, &with, &text, start, end);
            copied = end;
            if !self.global {
                break;
            }
            from = if end == start { end + 1 } else { end };
            if from > text.len() {
                break;
            }
        }
        out.extend_from_slice(&text[copied..]);
        String::from_utf16_lossy(&out)
    }

    /// `s.split(regex, limit)`.
    #[must_use]
    pub fn split(&self, s: &str, limit: Option<f64>) -> Vec<String> {
        let lim = match limit {
            None => u32::MAX as usize,
            Some(l) if l.is_finite() => l.trunc().rem_euclid(4_294_967_296.0) as usize,
            Some(_) => 0,
        };
        let text: Vec<u16> = s.encode_utf16().collect();
        let mut out = Vec::new();
        if lim == 0 {
            return out;
        }
        if text.is_empty() {
            if self.match_from(0, &text, 0).is_none() {
                out.push(String::new());
            }
            return out;
        }
        let mut p = 0;
        let mut q = 0;
        while q < text.len() {
            match self.match_from(0, &text, q) {
                Some(e) if e != p => {
                    out.push(String::from_utf16_lossy(&text[p..q]));
                    if out.len() == lim {
                        return out;
                    }
                    p = e;
                    q = p;
                }
                _ => q += 1,
            }
        }
        out.push(String::from_utf16_lossy(&text[p..]));
        out
    }
}

fn substitute_units(out: &mut Vec<u16>, with: &[u16], text: &[u16], start: usize, end: usize) {
    let mut i = 0;
    while i < with.len() {
        if with[i] == u16::from(b'$') && i + 1 < with.len() {
            match with[i + 1] {
                0x24 => {
                    out.push(0x24);
                    i += 2;
                    continue;
                }
                0x26 => {
                    out.extend_from_slice(&text[start..end]);
                    i += 2;
                    continue;
                }
                0x60 => {
                    out.extend_from_slice(&text[..start]);
                    i += 2;
                    continue;
                }
                0x27 => {
                    out.extend_from_slice(&text[end..]);
                    i += 2;
                    continue;
                }
                _ => {}
            }
        }
        out.push(with[i]);
        i += 1;
    }
}

#[cfg(test)]
mod tests;
