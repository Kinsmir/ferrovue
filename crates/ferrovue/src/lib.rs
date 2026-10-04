//! Vue templates as Rust render functions.
//!
//! The ferrovue compiler reads a `.vue` component, takes what Vue's own SSR compiler makes of its
//! template, and writes a Rust function that produces the same bytes. A server can then render the
//! component with no JavaScript at run time, and the browser hydrates the markup it was sent. This
//! crate is what those generated functions call: the Rust twins of the `@vue/server-renderer` and
//! `@vue/shared` routines a compiled template uses, which reproduce Vue's output byte for byte —
//! a single differing byte is a hydration mismatch in the browser.
//!
//! [`Html`] is the one type here that writes raw bytes. Generated code is what builds it, and it
//! writes by calling a generated renderer, whose every interpolation goes through [`escape_into`].

use serde::Serialize;

/// A generated renderer applied to its props, written straight into the caller's buffer: no buffer
/// of its own, and no copy. `F` is the renderer: a plain function for a component that needs only
/// its props, a closure holding the slots and the route for one that takes those as well.
pub struct Html<'p, P, F = fn(&mut String, &P)> {
    props: &'p P,
    render: F,
    /// `Some(name)` wraps the markup as a hydratable island; `None` is the markup alone.
    island: Option<&'static str>,
}

impl<'p, P: Serialize, F: Fn(&mut String, &P)> Html<'p, P, F> {
    /// The component's markup, which the client never hydrates.
    ///
    /// For generated code. Anything else that builds one can write any bytes it likes.
    #[doc(hidden)]
    pub fn markup(props: &'p P, render: F) -> Self {
        Html {
            props,
            render,
            island: None,
        }
    }

    /// The component as an island the client hydrates. For generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    pub fn island(name: &'static str, props: &'p P, render: F) -> Self {
        Html {
            props,
            render,
            island: Some(name),
        }
    }

    /// Write the markup onto the end of `buf`.
    pub fn render_to(&self, buf: &mut String) {
        match self.island {
            None => (self.render)(buf, self.props),
            Some(name) => island_into(buf, name, self.props, &self.render),
        }
    }

    /// The markup as a string of its own.
    pub fn into_string(self) -> String {
        let mut out = String::new();
        self.render_to(&mut out);
        out
    }
}

#[cfg(feature = "maud")]
impl<P: Serialize, F: Fn(&mut String, &P)> maud::Render for Html<'_, P, F> {
    fn render_to(&self, buf: &mut String) {
        Html::render_to(self, buf);
    }
}

/// What a parent puts in one of a component's slots.
#[derive(Clone, Copy)]
pub struct Slot<'s> {
    body: Body<'s>,
}

#[derive(Clone, Copy)]
enum Body<'s> {
    /// Always content, whatever it writes — as a component in a slot always is to Vue.
    Content(&'s dyn Fn(&mut String)),
    /// A generated parent's markup, which reports whether it wrote anything but comments.
    Markup(&'s dyn Fn(&mut String) -> bool),
    /// As `Markup`, for a component whose outlets pass a slot scope id (`:slotted` styles): the
    /// content is given the id, ` data-v-…-s`, to write onto its elements.
    Slotted(&'s dyn Fn(&mut String, &str) -> bool),
}

impl<'s> Slot<'s> {
    /// Content for a slot: another component's render, or markup the caller already holds. The
    /// slot's fallback never replaces it.
    pub fn new(render: &'s dyn Fn(&mut String)) -> Self {
        Slot {
            body: Body::Content(render),
        }
    }

    /// A generated parent's slot content, returning whether it pushed anything but a comment.
    #[doc(hidden)]
    pub fn markup(render: &'s dyn Fn(&mut String) -> bool) -> Self {
        Slot {
            body: Body::Markup(render),
        }
    }

    /// A generated parent's slot content for a component whose outlets pass a slot scope id: given
    /// the id, returning whether it pushed anything but a comment.
    #[doc(hidden)]
    pub fn slotted(render: &'s dyn Fn(&mut String, &str) -> bool) -> Self {
        Slot {
            body: Body::Slotted(render),
        }
    }

    /// Write the content alone, as `<RouterView>` does with the page it shows.
    pub fn render_to(&self, out: &mut String) {
        match self.body {
            Body::Content(f) => f(out),
            Body::Markup(f) => {
                f(out);
            }
            Body::Slotted(f) => {
                f(out, "");
            }
        }
    }
}

/// What a [`hole`] writes. Every interpolated value has its `<` escaped, so only a template's own
/// markup could spell this, and no template writes an element called `fv-hole`.
const HOLE: &str = "<fv-hole>";

fn write_hole(out: &mut String) {
    out.push_str(HOLE);
}

/// A slot whose content the caller writes itself, later: render with holes, [`split_holes`] the
/// output, and write the pieces with each hole's content between them — which is how a page streams
/// its parts in the order they are ready. A hole is content to the slot, so its fallback never
/// shows.
///
/// # Example
///
/// ```
/// use ferrovue::{hole, slot_into, split_holes};
///
/// // A layout rendered with a hole where the page goes, then sent in two pieces.
/// let mut layout = String::from("<main>");
/// slot_into(&mut layout, Some(hole()), None);
/// layout.push_str("</main>");
///
/// let pieces = split_holes(&layout);
/// assert_eq!(pieces, ["<main><!--[-->", "<!--]--></main>"]);
/// // Write pieces[0], then the page when it is ready, then pieces[1].
/// ```
pub fn hole() -> Slot<'static> {
    Slot::new(&write_hole)
}

/// The pieces of a render between its holes, in order: one more than there were holes.
pub fn split_holes(rendered: &str) -> Vec<&str> {
    rendered.split(HOLE).collect()
}

/// `ssrRenderSlot`: the slot's content between fragment markers, or its fallback when it was given
/// none — or only comments, which is what Vue reads as nothing.
///
/// Returns whether the slot's own content wrote anything but comments, which is what decides
/// whether slot content that forwards this slot is itself empty. The fallback reports for itself.
///
/// # Example
///
/// ```
/// use ferrovue::{slot_into, Slot};
///
/// let content = |out: &mut String| out.push_str("<p>given</p>");
/// let mut out = String::new();
/// slot_into(&mut out, Some(Slot::new(&content)), None);
/// assert_eq!(out, "<!--[--><p>given</p><!--]-->");
///
/// out.clear();
/// slot_into(&mut out, None, Some(&mut |out: &mut String| out.push_str("fallback")));
/// assert_eq!(out, "<!--[-->fallback<!--]-->");
/// ```
pub fn slot_into(
    out: &mut String,
    slot: Option<Slot<'_>>,
    fallback: Option<&mut dyn FnMut(&mut String)>,
) -> bool {
    slot_into_slotted(out, slot, "", fallback)
}

/// [`slot_into`] for an outlet that passes a slot scope id, as Vue's `ssrRenderSlot` takes it:
/// `data-v-…-s` from a component with `:slotted` styles, followed by the id its own slot content
/// was given when the outlet forwards a slot; `""` for none. Generated content is given the id after
/// a space; other content ignores it, as static markup does in Vue.
pub fn slot_into_slotted(
    out: &mut String,
    slot: Option<Slot<'_>>,
    slot_scope_id: &str,
    fallback: Option<&mut dyn FnMut(&mut String)>,
) -> bool {
    out.push_str("<!--[-->");
    let start = out.len();
    let filled = match slot.map(|s| s.body) {
        Some(Body::Content(f)) => {
            f(out);
            true
        }
        Some(Body::Markup(f)) => f(out),
        Some(Body::Slotted(f)) => f(out, &content_scope_id(slot_scope_id)),
        None => false,
    };
    // Vue drops content of comments alone whether or not there is a fallback to show instead.
    if !filled {
        out.truncate(start);
        if let Some(fallback) = fallback {
            fallback(out);
        }
    }
    out.push_str("<!--]-->");
    filled
}

/// What `ssrRenderSlotInner` hands slot content for an outlet's slot scope id: the id after a
/// space, or nothing.
fn content_scope_id(slot_scope_id: &str) -> std::borrow::Cow<'_, str> {
    if slot_scope_id.is_empty() {
        std::borrow::Cow::Borrowed("")
    } else {
        std::borrow::Cow::Owned(format!(" {slot_scope_id}"))
    }
}

/// `ssrRenderSlot` for a scoped slot: the content, given the props the outlet passes it, between
/// fragment markers — or the fallback when there is no content, or the content wrote only comments.
///
/// `slot` is a component's `Slots` field for a scoped slot, a closure taking the slot's props and
/// returning whether it wrote anything but comments; one written by hand returns `true`. Returns
/// whether the content was filled, as [`slot_into`] does.
///
/// # Example
///
/// ```
/// use ferrovue::scoped_slot_into;
///
/// /// What a component's outlet passes; generated code writes one such struct per scoped slot.
/// struct RowProps<'v> {
///     label: &'v str,
/// }
///
/// let row = |out: &mut String, p: &RowProps<'_>| {
///     ferrovue::escape_into(out, p.label);
///     true
/// };
/// let slot: &dyn for<'v> Fn(&mut String, &RowProps<'v>) -> bool = &row;
/// let mut out = String::new();
/// scoped_slot_into(&mut out, Some(slot), &RowProps { label: "a<b" }, None);
/// assert_eq!(out, "<!--[-->a&lt;b<!--]-->");
/// ```
pub fn scoped_slot_into<P: ?Sized, F: Fn(&mut String, &P) -> bool + ?Sized>(
    out: &mut String,
    slot: Option<&F>,
    props: &P,
    fallback: Option<&mut dyn FnMut(&mut String)>,
) -> bool {
    out.push_str("<!--[-->");
    let start = out.len();
    let filled = slot.is_some_and(|f| f(out, props));
    if !filled {
        // Vue drops content of comments alone, and shows the fallback in its place.
        out.truncate(start);
        if let Some(fallback) = fallback {
            fallback(out);
        }
    }
    out.push_str("<!--]-->");
    filled
}

/// [`scoped_slot_into`] for an outlet that passes a slot scope id, as [`slot_into_slotted`] does:
/// the content is given the props and the id.
pub fn scoped_slot_into_slotted<P: ?Sized, F: Fn(&mut String, &P, &str) -> bool + ?Sized>(
    out: &mut String,
    slot: Option<&F>,
    props: &P,
    slot_scope_id: &str,
    fallback: Option<&mut dyn FnMut(&mut String)>,
) -> bool {
    let id = content_scope_id(slot_scope_id);
    let content = slot.map(|f| move |out: &mut String, p: &P| f(out, p, &id));
    scoped_slot_into(out, content.as_ref(), props, fallback)
}

/// The scope ids a component's root carries, written as `ssrRenderAttrs` writes them: ` data-v-…`
/// each. Vue builds them as the keys of the component's `attrs` object, so an id already there keeps
/// its place: first those the parent passes on when this component is its root, then the parent's
/// own id (`own`, `""` when it has no scoped styles), then the slot scope ids it is rendered inside
/// (`slotted`, as the slot content was given them).
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::scope_attrs(" data-v-a", "data-v-b", ""), " data-v-a data-v-b");
/// assert_eq!(ferrovue::scope_attrs("", "data-v-a", " data-v-a data-v-c-s"), " data-v-a data-v-c-s");
/// ```
pub fn scope_attrs(inherited: &str, own: &str, slotted: &str) -> String {
    // `inherited` is itself written this way: each key after one space.
    let mut keys: Vec<&str> = inherited.split(' ').filter(|k| !k.is_empty()).collect();
    // Two spaces in a row in a slot scope id make an empty key, which `ssrRenderAttrs` skips.
    for key in std::iter::once(own).chain(js_trim(slotted).split(' ')) {
        if !key.is_empty() && !keys.contains(&key) {
            keys.push(key);
        }
    }
    let mut out = String::with_capacity(keys.iter().map(|k| k.len() + 1).sum());
    for key in keys {
        out.push(' ');
        out.push_str(key);
    }
    out
}

/// HTML that is safe to write into a page as it is: what `v-html` may render.
///
/// The compiler accepts `v-html` only on a prop declared as `TrustedHtml` (from
/// `ferrovue/types`), and the project's configuration maps that to one Rust type implementing this
/// trait. Implement it only for a type whose every value has already been made safe — the output
/// of a sanitiser, never a string that merely looks fine — because that is the whole of what stands
/// between the value and the page.
///
/// # Example
///
/// ```
/// use ferrovue::{trusted_into, TrustedHtml};
///
/// /// HTML a sanitiser produced: the only way to make one is through it.
/// struct Sanitised(String);
///
/// impl Sanitised {
///     fn new(untrusted: &str) -> Self {
///         // A real project calls its sanitiser (ammonia, for example) here.
///         Sanitised(untrusted.replace('<', "&lt;"))
///     }
/// }
///
/// impl TrustedHtml for Sanitised {
///     fn trusted_html(&self) -> &str {
///         &self.0
///     }
/// }
///
/// let mut out = String::new();
/// trusted_into(&mut out, &Sanitised::new("<script>"));
/// assert_eq!(out, "&lt;script>");
/// ```
pub trait TrustedHtml {
    /// The HTML, which is written into the page exactly as it is.
    fn trusted_html(&self) -> &str;
}

/// `v-html`: the value, unescaped. Only a [`TrustedHtml`] can reach it.
pub fn trusted_into(out: &mut String, html: &impl TrustedHtml) {
    out.push_str(html.trusted_html());
}

/// `escapeHtml`: `"`, `&`, `'`, `<` and `>`, and nothing else.
///
/// # Example
///
/// ```
/// let mut out = String::from("<p>");
/// ferrovue::escape_into(&mut out, r#"<a href="x">Tom & 'Jerry'</a>"#);
/// assert_eq!(out, "<p>&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
/// ```
pub fn escape_into(out: &mut String, s: &str) {
    // Most strings need nothing escaped. A `fold` rather than `any` because it does not stop early,
    // which is what lets the compiler check the bytes in vector-width blocks; the string is then
    // written in one copy.
    let special = s.bytes().fold(false, |found, b| {
        found | matches!(b, b'"' | b'&' | b'\'' | b'<' | b'>')
    });
    if !special {
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

/// The largest integer a JavaScript number holds exactly: 2⁵³ − 1.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// `String(n)` for an integer, which is what `toDisplayString` and `escapeHtml` make of a number.
///
/// Exact within ±(2⁵³ − 1). Beyond that a JavaScript number has already lost precision — the
/// browser rounds the value it reads from the island's props — so it is written as JavaScript
/// writes the rounded number, or the page would not hydrate.
///
/// # Example
///
/// ```
/// let mut out = String::new();
/// ferrovue::push_int(&mut out, 42);
/// out.push(' ');
/// // Beyond 2⁵³ the browser has the rounded number, so that is what is written.
/// ferrovue::push_int(&mut out, 9_007_199_254_740_993);
/// assert_eq!(out, "42 9007199254740992");
/// ```
pub fn push_int(out: &mut String, n: i64) {
    use std::fmt::Write;
    if n.unsigned_abs() <= MAX_SAFE_INTEGER {
        let _ = write!(out, "{n}");
    } else {
        push_number(out, n as f64);
    }
}

/// `Number.prototype.toString()`: JavaScript's shortest round-trip digits, laid out as ECMAScript
/// lays them out — `0.30000000000000004`, `1e+21`, `1.5e-7`, `NaN`, `-Infinity`.
///
/// # Example
///
/// ```
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
        // Negative zero too: `String(-0)` is `"0"`.
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
    // `{:e}` writes the shortest digits that round-trip, as JavaScript chooses them: `d.ddde±N`.
    let mut sci = String::new();
    let _ = write!(sci, "{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').expect("`{:e}` writes an exponent");
    let mut digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    // ECMAScript breaks a tie between two shortest spellings — the number exactly halfway between
    // them — toward the even digit, where Rust's shortest formatting may round the other way.
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
    // The position of the decimal point relative to the digits, as the specification's `n`.
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

/// `Math.round`: the nearest integer, a half rounding up toward +∞ — `-2.5` to `-2`, where Rust's
/// `f64::round` gives `-3`.
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

/// `Math.max` of two numbers: `NaN` if either is, where Rust's `f64::max` ignores a `NaN`.
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b || (a == b && b.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `Math.min` of two numbers: `NaN` if either is.
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
    // Rust rounds from the exact value too, and differs only on an exact tie: a value whose exact
    // decimal expansion ends with a 5 one place past the last digit kept.
    let mut exact = String::new();
    let _ = write!(exact, "{:.1100}", x.abs());
    let exact = exact.trim_end_matches('0');
    let fraction = exact.split_once('.').map_or("", |(_, f)| f);
    if fraction.len() == d + 1 && fraction.ends_with('5') {
        out = round_up_magnitude(&exact[..exact.len() - 1]);
    }
    // `-0.toFixed(1)` is "0.0", and a negative that rounds to zero keeps its sign: "-0.0".
    if x < 0.0 {
        out.insert(0, '-');
    }
    out
}

/// A decimal string's last digit plus one, carrying: `"2."` to `"3"`, `"1.99"` to `"2.00"`.
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

/// A string of decimal digits plus one in its last place, carrying: `"129"` to `"130"`.
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
/// # Example
///
/// ```
/// use ferrovue::Js;
///
/// assert_eq!(format!("{} items", Js(3_i64)), "3 items");
/// assert_eq!(format!("{}", Js(1.5e-7_f64)), "1.5e-7");
/// ```
pub struct Js<T>(pub T);

impl std::fmt::Display for Js<i64> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut s = String::new();
        push_int(&mut s, self.0);
        f.write_str(&s)
    }
}

impl std::fmt::Display for Js<f64> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut s = String::new();
        push_number(&mut s, self.0);
        f.write_str(&s)
    }
}

/// `String.prototype.length`: UTF-16 code units, which is what a template's `.length` counts — not
/// the UTF-8 bytes of `str::len`, nor the scalar values of `chars().count()`.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_length("café"), 4);
/// assert_eq!(ferrovue::js_length("🦀"), 2); // two UTF-16 code units, as JavaScript counts
/// ```
pub fn js_length(s: &str) -> i64 {
    // Each scalar value is one code unit, or two when it is outside the Basic Multilingual Plane —
    // exactly the four-byte UTF-8 sequences. Most strings are ASCII, where it is the length.
    if s.is_ascii() {
        return s.len() as i64;
    }
    s.chars().map(char::len_utf16).sum::<usize>() as i64
}

/// `String.prototype.trim`: ECMAScript's WhiteSpace and LineTerminator sets, which are not Rust's
/// `char::is_whitespace` — JavaScript trims U+FEFF and keeps U+0085.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_trim("\u{feff} a \u{3000}"), "a");
/// assert_eq!(ferrovue::js_trim("\u{85}a"), "\u{85}a"); // JavaScript keeps U+0085
/// ```
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `String.prototype.trimStart`: [`js_trim`] at the start alone.
pub fn js_trim_start(s: &str) -> &str {
    s.trim_start_matches(is_js_space)
}

/// `String.prototype.trimEnd`: [`js_trim`] at the end alone.
pub fn js_trim_end(s: &str) -> &str {
    s.trim_end_matches(is_js_space)
}

fn is_js_space(c: char) -> bool {
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

/// `escapeHtml(normalizeClass([...]))` for a list of strings: each one trimmed, the empty ones
/// dropped, the rest joined with one space. `after` says a class has already been written, so the
/// first item written here needs a separator too.
///
/// # Example
///
/// ```
/// let mut out = String::from("card");
/// ferrovue::class_into(&mut out, true, &[" big ", "", "x<y"]);
/// assert_eq!(out, "card big x&lt;y");
/// ```
pub fn class_into(out: &mut String, after: bool, items: &[&str]) {
    let mut sep = after;
    for item in items {
        let item = js_trim(item);
        if item.is_empty() {
            continue;
        }
        if sep {
            out.push(' ');
        }
        escape_into(out, item);
        sep = true;
    }
}

/// `normalizeClass` of an object: the names whose condition holds, each followed by a space, the
/// whole trimmed once — so a name's own surrounding spaces survive between its neighbours, as in
/// Vue. Generated code uses it for an object with computed names, which may hold any text.
///
/// # Example
///
/// ```
/// // `{ active: true, [" wide "]: true, hidden: false }`
/// assert_eq!(ferrovue::class_object(&[(true, "active"), (true, " wide "), (false, "hidden")]), "active  wide");
/// ```
pub fn class_object(entries: &[(bool, &str)]) -> String {
    // A JavaScript object: a name given twice is one name, where it first appeared, with the last
    // condition given; and names that are array indices — `"0"`, `"12"` — come first, in numeric
    // order, before the others in the order they were added.
    let mut names: Vec<(&str, bool)> = Vec::new();
    for (on, name) in entries {
        match names.iter_mut().find(|(n, _)| n == name) {
            Some(entry) => entry.1 = *on,
            None => names.push((name, *on)),
        }
    }
    let index = |name: &str| -> Option<u32> {
        let n: u32 = name.parse().ok()?;
        (n < u32::MAX && n.to_string() == name).then_some(n)
    };
    let mut ordered: Vec<(Option<u32>, &str, bool)> =
        names.into_iter().map(|(n, on)| (index(n), n, on)).collect();
    // Stable: the indices sorted among themselves, the other names kept as they came.
    ordered.sort_by_key(|(i, _, _)| i.map_or((1, 0), |i| (0, i)));
    let mut s = String::new();
    for (_, name, on) in ordered {
        if on {
            s.push_str(name);
            s.push(' ');
        }
    }
    js_trim(&s).to_owned()
}

/// The stores' state as the client reads it back before it hydrates: a `<script type="application/json">`,
/// which a `script-src 'self'` policy does not run, so the page needs no nonce for it. `<`, `>`, `&`
/// and the two line separators are written as JSON escapes, so no value can end the element or be
/// read as markup inside it.
///
/// # Example
///
/// ```
/// let state = serde_json::json!({ "prefs": { "theme": "</script>" } });
/// let mut page = String::new();
/// ferrovue::state_script_into(&mut page, "__pinia", &state);
/// assert_eq!(
///     page,
///     r#"<script type="application/json" id="__pinia">{"prefs":{"theme":"\u003c/script\u003e"}}</script>"#
/// );
/// ```
pub fn state_script_into(out: &mut String, id: &str, state: &impl Serialize) {
    out.push_str("<script type=\"application/json\" id=\"");
    escape_into(out, id);
    out.push_str("\">");
    // As in `island_into`: a struct of strings, numbers and lists cannot fail to serialise, and if it
    // somehow did the client would find no state and render from its own.
    let json = serde_json::to_string(state).unwrap_or_default();
    json_escaped_into(out, &json);
    out.push_str("</script>");
}

/// JSON with `<`, `>`, `&`, U+2028 and U+2029 written as escapes. The runs between them are copied
/// whole: every byte matched is the first of its character, so each cut is at a char boundary.
fn json_escaped_into(out: &mut String, json: &str) {
    out.reserve(json.len());
    let bytes = json.as_bytes();
    let (mut last, mut i) = (0, 0);
    while i < bytes.len() {
        let (rep, width) = match bytes[i] {
            b'<' => ("\\u003c", 1),
            b'>' => ("\\u003e", 1),
            b'&' => ("\\u0026", 1),
            // U+2028 and U+2029 are E2 80 A8 and E2 80 A9.
            0xE2 if bytes.get(i + 1) == Some(&0x80) && bytes.get(i + 2) == Some(&0xA8) => {
                ("\\u2028", 3)
            }
            0xE2 if bytes.get(i + 1) == Some(&0x80) && bytes.get(i + 2) == Some(&0xA9) => {
                ("\\u2029", 3)
            }
            _ => {
                i += 1;
                continue;
            }
        };
        out.push_str(&json[last..i]);
        out.push_str(rep);
        i += width;
        last = i;
    }
    out.push_str(&json[last..]);
}

/// The island wrapper: the component's own markup inside the element the client mounts on, with
/// the props it was rendered from as JSON in an attribute — never a `<script>`, so a page with a
/// `script-src 'self'` policy needs no nonce for it.
fn island_into<P: Serialize>(
    out: &mut String,
    name: &str,
    props: &P,
    render: &impl Fn(&mut String, &P),
) {
    out.push_str("<div data-island=\"");
    escape_into(out, name);
    out.push_str("\" data-props=\"");
    // A struct of strings, integers and booleans cannot fail to serialise; if it somehow did, the
    // client finds malformed props and leaves the server's markup as it is. Serialised whole and
    // then escaped: `serde_json` writes in many small pieces, and escaping each one costs more
    // than the one extra buffer.
    let json = serde_json::to_string(props).unwrap_or_default();
    escape_into(out, &json);
    out.push_str("\">");
    render(out, props);
    out.push_str("</div>");
}

pub mod i18n;
mod router;
mod teleport;
pub use i18n::I18n;
pub use router::{Link, Query, Route, RouteDef, Router, query_into};
pub use teleport::{Teleports, teleport_into};

#[cfg(test)]
mod tests;
