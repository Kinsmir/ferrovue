//! Fallthrough attributes: what a parent passes a component beyond its props, merged as
//! `mergeProps` merges them and written as `ssrRenderAttrs` writes them.
//!
//! A parent's compiled template knows every attribute it passes, but the child is compiled once for
//! every parent, so the two meet here, at run time: the parent builds an [`Attrs`], and the child's
//! root (or the element its template binds `$attrs` to) merges it with its own attributes through
//! [`attrs_into`]. A component no parent passes attributes to never sees any of this.

use std::borrow::Cow;

use crate::{escape_into, js_trim, push_int, push_number, record};

/// One attribute's value, as Vue holds it once the parent's virtual node is made: `createVNode`
/// has already normalised a class given as an array or an object, and a style given as an array.
#[derive(Debug, Clone, PartialEq)]
pub enum Attr<'a> {
    /// `undefined`, an absent optional value. It writes nothing, and in a merge it replaces the
    /// attribute an element sets itself.
    Undefined,
    /// A string.
    Str(Cow<'a, str>),
    /// A boolean.
    Bool(bool),
    /// An integer: a JavaScript number, written as JavaScript writes it.
    Int(i64),
    /// A fraction: a JavaScript number, written as JavaScript writes it.
    Float(f64),
    /// An element's own class bound to an array or an object, by the names it normalises to. Being
    /// an object, it equals no other value, which decides how `mergeProps` joins it.
    Names(Cow<'a, str>),
    /// A style object: each property as written (camelCase, kebab-case or `--custom`) with its value,
    /// in JavaScript's order of keys.
    Style(Vec<(Cow<'a, str>, Attr<'a>)>),
}

impl<'a> Attr<'a> {
    /// A borrowed string.
    pub const fn str(s: &'a str) -> Self {
        Attr::Str(Cow::Borrowed(s))
    }

    /// A style object of literal property names, in the order given.
    pub fn style(entries: impl IntoIterator<Item = (&'a str, Attr<'a>)>) -> Self {
        Attr::Style(normal_order(
            entries
                .into_iter()
                .map(|(k, v)| (Cow::Borrowed(k), v))
                .collect(),
        ))
    }

    /// `normalizeStyle` of an array: the objects merged in order, each property where it first
    /// appears with the last value given, and a string parsed as CSS text.
    pub fn styles(items: impl IntoIterator<Item = Attr<'a>>) -> Self {
        let mut res = Vec::new();
        for item in items {
            merge_style_into(&mut res, item);
        }
        Attr::Style(normal_order(res))
    }

    /// JavaScript's truthiness.
    fn truthy(&self) -> bool {
        match self {
            Attr::Undefined => false,
            Attr::Str(s) => !s.is_empty(),
            Attr::Bool(b) => *b,
            Attr::Int(n) => *n != 0,
            Attr::Float(x) => *x != 0.0 && !x.is_nan(),
            Attr::Names(_) | Attr::Style(_) => true,
        }
    }

    /// `===` of the class merged so far, which is `undefined` or a string, with a value.
    fn strict_eq(&self, other: &Attr<'_>) -> bool {
        match (self, other) {
            (Attr::Undefined, Attr::Undefined) => true,
            (Attr::Str(a), Attr::Str(b)) => a == b,
            _ => false,
        }
    }

    /// `normalizeClass` of the value alone: a string trimmed, an object's names, anything else
    /// nothing.
    fn class_text(&self) -> &str {
        match self {
            Attr::Str(s) => js_trim(s),
            Attr::Names(s) => s,
            _ => "",
        }
    }

    /// `String(value)`, for a string, a boolean or a number.
    fn write_string(&self, out: &mut String) {
        match self {
            Attr::Str(s) => escape_into(out, s),
            Attr::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Attr::Int(n) => push_int(out, *n),
            Attr::Float(x) => push_number(out, *x),
            Attr::Undefined | Attr::Names(_) | Attr::Style(_) => {}
        }
    }
}

impl<'a> From<&'a str> for Attr<'a> {
    fn from(s: &'a str) -> Self {
        Attr::str(s)
    }
}

impl From<String> for Attr<'_> {
    fn from(s: String) -> Self {
        Attr::Str(Cow::Owned(s))
    }
}

impl From<bool> for Attr<'_> {
    fn from(b: bool) -> Self {
        Attr::Bool(b)
    }
}

impl From<i64> for Attr<'_> {
    fn from(n: i64) -> Self {
        Attr::Int(n)
    }
}

impl From<f64> for Attr<'_> {
    fn from(x: f64) -> Self {
        Attr::Float(x)
    }
}

impl<'a, T: Into<Attr<'a>>> From<Option<T>> for Attr<'a> {
    fn from(v: Option<T>) -> Self {
        v.map_or(Attr::Undefined, Into::into)
    }
}

/// A list of attributes, borrowed from a parent's call or merged into one of its own.
#[derive(Debug, Clone)]
enum List<'a> {
    Borrowed(&'a [(&'a str, Attr<'a>)]),
    Owned(Vec<(&'a str, Attr<'a>)>),
}

/// What a parent passes a component beyond its props — `$attrs`, in the order given — and the scope
/// ids its root inherits, ` data-v-…` each, which Vue keeps after them.
///
/// Generated parents build one for each child that may be passed attributes, and the child's
/// `render_scoped` takes it; `render` passes [`Attrs::NONE`]. A child with nothing passed renders
/// exactly as it would have without, and a component no parent passes attributes to takes the scope
/// ids alone, as a `&str`.
///
/// # Example
///
/// ```
/// use ferrovue::{Attr, Attrs};
///
/// let passed = [("class", Attr::str("wide")), ("title", Attr::str("Hi")), ("data-n", Attr::Int(2))];
/// let attrs = Attrs::new(&passed, " data-v-1");
/// // The root of the child: `<div class="card" title="own">`.
/// let mut out = String::from("<div");
/// ferrovue::attrs_into(&mut out, &[&[("class", Attr::str("card")), ("title", Attr::str("own"))], attrs.list()], 1, attrs.ids());
/// out.push('>');
/// assert_eq!(out, r#"<div class="card wide" title="Hi" data-n="2" data-v-1>"#);
/// ```
#[derive(Debug, Clone)]
pub struct Attrs<'a> {
    list: List<'a>,
    ids: Cow<'a, str>,
}

impl<'a> Attrs<'a> {
    /// Nothing passed, and no scope ids.
    pub const NONE: Attrs<'static> = Attrs::scoped("");

    /// The attributes a parent passes, and the scope ids.
    pub const fn new(list: &'a [(&'a str, Attr<'a>)], ids: &'a str) -> Self {
        Attrs {
            list: List::Borrowed(list),
            ids: Cow::Borrowed(ids),
        }
    }

    /// No attributes, only scope ids.
    pub const fn scoped(ids: &'a str) -> Self {
        Attrs::new(&[], ids)
    }

    /// `mergeProps` of several lists, in order, with the scope ids: what a component whose root is
    /// another component passes that one, its own attributes for it and those it was passed.
    pub fn merged(sources: &[&[(&'a str, Attr<'a>)]], ids: &'a str) -> Self {
        Attrs {
            list: List::Owned(merge_props(sources)),
            ids: Cow::Borrowed(ids),
        }
    }

    /// The attributes, in order.
    pub fn list(&self) -> &[(&'a str, Attr<'a>)] {
        match &self.list {
            List::Borrowed(l) => l,
            List::Owned(l) => l,
        }
    }

    /// The scope ids: ` data-v-…` each.
    pub fn ids(&self) -> &str {
        &self.ids
    }

    /// Whether no attribute was passed, though there may be scope ids.
    pub fn is_empty(&self) -> bool {
        self.list().is_empty()
    }
}

impl Default for Attrs<'_> {
    fn default() -> Self {
        Attrs::NONE
    }
}

/// An attribute merged from several lists, with the index of the list that first gave its name.
type Merged<'a> = (&'a str, Attr<'a>, usize);

/// `mergeProps`: each name where it first appears with the last value given, except that classes
/// are joined (once, when a value equals the class so far) and styles merged. Listeners are not
/// rendered and never reach here.
fn merge<'a>(sources: &[&[(&'a str, Attr<'a>)]]) -> Vec<Merged<'a>> {
    let mut ret: Vec<Merged<'a>> = Vec::new();
    for (i, source) in sources.iter().enumerate() {
        for (key, value) in source.iter() {
            let at = ret.iter().position(|(k, _, _)| k == key);
            // An empty key (which `mergeProps` skips) is never written either.
            match *key {
                "class" => {
                    let so_far = at.map_or(&Attr::Undefined, |j| &ret[j].1);
                    if !so_far.strict_eq(value) {
                        let joined = join_classes(so_far.class_text(), value.class_text());
                        set(&mut ret, at, key, Attr::Str(Cow::Owned(joined)), i);
                    }
                }
                "style" => {
                    let mut res = Vec::new();
                    if let Some(j) = at {
                        merge_style_into(&mut res, ret[j].1.clone());
                    }
                    merge_style_into(&mut res, value.clone());
                    set(&mut ret, at, key, Attr::Style(normal_order(res)), i);
                }
                _ => set(&mut ret, at, key, value.clone(), i),
            }
        }
    }
    ret
}

fn set<'a>(ret: &mut Vec<Merged<'a>>, at: Option<usize>, key: &'a str, value: Attr<'a>, i: usize) {
    match at {
        Some(j) => ret[j].1 = value,
        None => ret.push((key, value, i)),
    }
}

/// `normalizeClass([a, b])` of two normalised classes.
fn join_classes(a: &str, b: &str) -> String {
    match (a.is_empty(), b.is_empty()) {
        (true, _) => b.to_owned(),
        (_, true) => a.to_owned(),
        _ => format!("{a} {b}"),
    }
}

/// `mergeProps` of attribute lists, in order: what a component's `$attrs` merged with others
/// holds.
///
/// # Example
///
/// ```
/// use ferrovue::Attr;
///
/// let merged = ferrovue::merge_props(&[
///     &[("class", Attr::str("a")), ("id", Attr::str("x"))],
///     &[("id", Attr::Undefined), ("class", Attr::str("b"))],
/// ]);
/// assert_eq!(merged, [("class", Attr::str("a b")), ("id", Attr::Undefined)]);
/// ```
pub fn merge_props<'a>(sources: &[&[(&'a str, Attr<'a>)]]) -> Vec<(&'a str, Attr<'a>)> {
    merge(sources).into_iter().map(|(k, v, _)| (k, v)).collect()
}

/// `ssrRenderAttrs(mergeProps(...sources))` for an element given fallthrough attributes, with the
/// scope ids written after the attributes the first `ids_at + 1` sources give — where Vue's
/// `_attrs`, which holds them as keys after the attributes, sits among the sources.
///
/// Called by generated code for the root of a component that was passed attributes, and for an
/// element that binds `$attrs`.
///
/// # Example
///
/// ```
/// use ferrovue::Attr;
///
/// let mut out = String::new();
/// // `<p :id="undefined">` given `title` and `id`, then `v-show`'s style.
/// ferrovue::attrs_into(
///     &mut out,
///     &[
///         &[("id", Attr::str("own"))],
///         &[("title", Attr::str("<t>")), ("id", Attr::Undefined)],
///         &[("style", Attr::style([("display", Attr::str("none"))]))],
///     ],
///     1,
///     " data-v-1",
/// );
/// assert_eq!(out, r#" title="&lt;t&gt;" data-v-1 style="display:none;""#);
/// ```
pub fn attrs_into(out: &mut String, sources: &[&[(&str, Attr<'_>)]], ids_at: usize, ids: &str) {
    let merged = merge(sources);
    for (key, value, _) in merged.iter().filter(|m| m.2 <= ids_at) {
        attr_into(out, key, value);
    }
    out.push_str(ids);
    for (key, value, _) in merged.iter().filter(|m| m.2 > ids_at) {
        attr_into(out, key, value);
    }
}

/// `ssrRenderAttrs(attrs)` of one list, not merged with anything: each value as the parent gave it
/// (a class not trimmed for `mergeProps`, a style given as text written as it is), then the scope
/// ids.
///
/// Called by generated code for an element whose only attributes are those passed: a root with none
/// of its own, an element binding `$attrs` alone.
///
/// # Example
///
/// ```
/// use ferrovue::Attr;
///
/// let mut out = String::new();
/// ferrovue::passed_attrs_into(&mut out, &[("class", Attr::Undefined), ("style", Attr::str("color: red"))], " data-v-1");
/// assert_eq!(out, r#" class="" style="color: red" data-v-1"#);
/// ```
pub fn passed_attrs_into(out: &mut String, list: &[(&str, Attr<'_>)], ids: &str) {
    for (key, value) in list {
        attr_into(out, key, value);
    }
    out.push_str(ids);
}

/// One key of `ssrRenderAttrs`, without a tag: a class or a style normalised, any other value by
/// `ssrRenderDynamicAttr`.
fn attr_into(out: &mut String, key: &str, value: &Attr<'_>) {
    const IGNORED: [&str; 6] = [
        "key",
        "ref",
        "innerHTML",
        "textContent",
        "ref_key",
        "ref_for",
    ];
    if key.is_empty() || IGNORED.contains(&key) || is_on(key) || key.starts_with('.') {
        return;
    }
    let key = key.strip_prefix('^').unwrap_or(key);
    match key {
        "class" => {
            out.push_str(" class=\"");
            escape_into(out, value.class_text());
            out.push('"');
        }
        "style" => {
            out.push_str(" style=\"");
            style_into(out, value);
            out.push('"');
        }
        "className" => {
            if !matches!(value, Attr::Undefined) {
                out.push_str(" class=\"");
                value.write_string(out);
                out.push('"');
            }
        }
        _ => dynamic_attr_into(out, key, value),
    }
}

/// `isOn`: `on` followed by anything but a lowercase ASCII letter.
fn is_on(key: &str) -> bool {
    let b = key.as_bytes();
    b.len() > 2 && b[0] == b'o' && b[1] == b'n' && !b[2].is_ascii_lowercase()
}

/// `isBooleanAttr` in `@vue/shared`.
const BOOLEAN_ATTRS: [&str; 25] = [
    "itemscope",
    "allowfullscreen",
    "formnovalidate",
    "ismap",
    "nomodule",
    "novalidate",
    "readonly",
    "async",
    "autofocus",
    "autoplay",
    "controls",
    "default",
    "defer",
    "disabled",
    "inert",
    "loop",
    "open",
    "required",
    "reversed",
    "scoped",
    "seamless",
    "checked",
    "muted",
    "multiple",
    "selected",
];

/// `ssrRenderDynamicAttr(key, value)` with no tag.
fn dynamic_attr_into(out: &mut String, key: &str, value: &Attr<'_>) {
    if !matches!(
        value,
        Attr::Str(_) | Attr::Bool(_) | Attr::Int(_) | Attr::Float(_)
    ) {
        return;
    }
    let name: Cow<'_, str> = match key {
        "acceptCharset" => "accept-charset".into(),
        "htmlFor" => "for".into(),
        "httpEquiv" => "http-equiv".into(),
        _ => key.to_lowercase().into(),
    };
    // `hidden` is boolean only for a boolean or a number: `hidden="until-found"` is a string.
    let boolean = if name == "hidden" {
        !matches!(value, Attr::Str(_))
    } else {
        BOOLEAN_ATTRS.contains(&&*name)
    };
    if boolean {
        if value.truthy() || matches!(value, Attr::Str(s) if s.is_empty()) {
            out.push(' ');
            out.push_str(&name);
        }
        return;
    }
    // An unsafe name is one Vue refuses to write.
    if name.contains(['>', '/', '=', '"', '\'', '\t', '\n', '\x0c', '\r', ' ']) {
        return;
    }
    out.push(' ');
    out.push_str(&name);
    if matches!(value, Attr::Str(s) if s.is_empty()) {
        return;
    }
    out.push_str("=\"");
    value.write_string(out);
    out.push('"');
}

/// `ssrRenderStyle(value)`: nothing for a falsy value, a string as it is, an object as
/// `name:value;` pairs — all escaped.
fn style_into(out: &mut String, value: &Attr<'_>) {
    match value {
        Attr::Str(s) => escape_into(out, s),
        Attr::Style(entries) => {
            for (key, v) in entries {
                if !matches!(v, Attr::Str(_) | Attr::Int(_) | Attr::Float(_)) {
                    continue;
                }
                if key.starts_with("--") {
                    escape_into(out, key);
                } else {
                    escape_into(out, &hyphenate(key));
                }
                out.push(':');
                v.write_string(out);
                out.push(';');
            }
        }
        _ => {}
    }
}

/// `ssrRenderStyle(normalizeStyle([css]))`: a style given as CSS text where Vue merges it, which
/// parses it into properties and writes them back as `name:value;`, escaped.
///
/// Called by generated code for a root bound to `:style="text"`, which Vue merges with whatever the
/// component's parent passes on.
///
/// # Example
///
/// ```
/// let mut out = String::new();
/// ferrovue::style_text_into(&mut out, "color: red; background: url(a;b) /* note */");
/// assert_eq!(out, "color:red;background:url(a;b);");
/// ```
pub fn style_text_into(out: &mut String, css: &str) {
    style_into(out, &Attr::styles([Attr::str(css)]));
}

/// `hyphenate`: an ASCII capital after a letter, digit or `_` gets a `-` before it, then the whole
/// is lowercased.
fn hyphenate(key: &str) -> String {
    let mut s = String::with_capacity(key.len() + 2);
    let mut prev_word = false;
    for c in key.chars() {
        if c.is_ascii_uppercase() && prev_word {
            s.push('-');
        }
        prev_word = c.is_ascii_alphanumeric() || c == '_';
        s.push(c);
    }
    s.to_lowercase()
}

/// One item of `normalizeStyle`'s array merged into `res`: an object's properties, a string's
/// once parsed; anything else adds nothing.
fn merge_style_into<'a>(res: &mut Vec<(Cow<'a, str>, Attr<'a>)>, item: Attr<'a>) {
    let entries = match item {
        Attr::Style(entries) => entries,
        Attr::Str(css) => parse_style(&css),
        _ => return,
    };
    for (key, value) in entries {
        match res.iter_mut().find(|(k, _)| *k == key) {
            Some(entry) => entry.1 = value,
            None => res.push((key, value)),
        }
    }
}

/// An object's keys in JavaScript's order: array indices first, in numeric order, then the rest as
/// they were added.
fn normal_order<'a>(mut entries: Vec<(Cow<'a, str>, Attr<'a>)>) -> Vec<(Cow<'a, str>, Attr<'a>)> {
    if entries
        .iter()
        .any(|(k, _)| record::array_index(k).is_some())
    {
        entries.sort_by_key(|(k, _)| record::array_index(k).map_or((1, 0), |i| (0, i)));
    }
    entries
}

/// `parseStringStyle`: comments removed (but not inside quotes), split at each `;` outside
/// parentheses, each part split at its first `:`, both halves trimmed.
fn parse_style<'a>(css: &str) -> Vec<(Cow<'a, str>, Attr<'a>)> {
    let text = strip_comments(css);
    let mut res: Vec<(Cow<'a, str>, Attr<'a>)> = Vec::new();
    for item in split_declarations(&text) {
        if item.is_empty() {
            continue;
        }
        // `/:([^]+)/`: the first `:` with something after it.
        let Some((key, value)) = item.split_once(':').filter(|(_, v)| !v.is_empty()) else {
            continue;
        };
        let key = js_trim(key).to_owned();
        let value = Attr::Str(Cow::Owned(js_trim(value).to_owned()));
        match res.iter_mut().find(|(k, _)| *k == key) {
            Some(entry) => entry.1 = value,
            None => res.push((Cow::Owned(key), value)),
        }
    }
    normal_order(res)
}

/// `/"(?:[^"\\]|\\[^])*"|'(?:[^'\\]|\\[^])*'|\\[^]|\/\*[^]*?\*\//g`, each match kept unless it is a
/// comment. A quote that is never closed matches nothing and is copied as it is.
fn strip_comments(css: &str) -> Cow<'_, str> {
    if !css.contains("/*") {
        return Cow::Borrowed(css);
    }
    let chars: Vec<char> = css.chars().collect();
    let mut out = String::with_capacity(css.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' {
            // A quoted string, with escapes, up to its closing quote.
            let mut j = i + 1;
            let mut closed = false;
            // A `\` takes the character after it, if there is one; when there is not, the quote is
            // never closed.
            while j < chars.len() {
                if chars[j] == '\\' {
                    j += 2;
                    continue;
                }
                if chars[j] == c {
                    closed = true;
                    break;
                }
                j += 1;
            }
            if closed {
                out.extend(&chars[i..=j]);
                i = j + 1;
                continue;
            }
        } else if c == '\\' && i + 1 < chars.len() {
            out.push(c);
            out.push(chars[i + 1]);
            i += 2;
            continue;
        } else if c == '/' && chars.get(i + 1) == Some(&'*') {
            let rest: String = chars[i + 2..].iter().collect();
            if let Some(end) = rest.find("*/") {
                i += 2 + rest[..end].chars().count() + 2;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    Cow::Owned(out)
}

/// The parts between the `;`s of `/;(?![^(]*\)/g`: a `;` followed by a `)` before any `(` is
/// inside parentheses, and does not split.
fn split_declarations(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    for (i, c) in text.char_indices() {
        if c != ';' {
            continue;
        }
        // The `;` itself is neither bracket.
        let rest = &text[i..];
        let inside = rest
            .find(['(', ')'])
            .is_some_and(|at| rest[at..].starts_with(')'));
        if !inside {
            parts.push(&text[start..i]);
            start = i + 1;
        }
    }
    parts.push(&text[start..]);
    parts
}

/// `normalizeClass` of a list of names, each one trimmed, the empty ones dropped, the rest joined
/// with one space: a class bound to an array or an object, as a value among fallthrough attributes.
/// Unlike [`class_into`](crate::class_into), it is not escaped: it is written later.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::class_names(&[" a ", "", "b"]), "a b");
/// ```
pub fn class_names(items: &[&str]) -> String {
    let mut s = String::new();
    for item in items {
        let item = js_trim(item);
        if item.is_empty() {
            continue;
        }
        if !s.is_empty() {
            s.push(' ');
        }
        s.push_str(item);
    }
    s
}
