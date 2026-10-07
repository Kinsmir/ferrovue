use std::borrow::Cow;

use crate::{escape_into, js_trim, push_int, push_number, record};

/// One attribute's value, as Vue holds it once the parent's virtual node is made: `createVNode`
/// has already normalised a class given as an array or an object, and a style given as an array.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
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
    #[must_use]
    pub const fn str(s: &'a str) -> Self {
        Attr::Str(Cow::Borrowed(s))
    }

    /// A style object of literal property names, in the order given.
    #[must_use]
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
    #[must_use]
    pub fn styles(items: impl IntoIterator<Item = Attr<'a>>) -> Self {
        let mut res = Vec::new();
        for item in items {
            merge_style_into(&mut res, item);
        }
        Attr::Style(normal_order(res))
    }

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

    fn strict_eq(&self, other: &Attr<'_>) -> bool {
        match (self, other) {
            (Attr::Undefined, Attr::Undefined) => true,
            (Attr::Str(a), Attr::Str(b)) => a == b,
            _ => false,
        }
    }

    fn class_text(&self) -> &str {
        match self {
            Attr::Str(s) => js_trim(s),
            Attr::Names(s) => s,
            _ => "",
        }
    }

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

#[derive(Debug, Clone)]
enum List<'a> {
    Borrowed(&'a [(&'a str, Attr<'a>)]),
    Owned(Vec<(&'a str, Attr<'a>)>),
}

/// What a parent passes a component beyond its props (`$attrs`, in the order given) and the scope
/// ids its root inherits, ` data-v-…` each, which Vue keeps after them.
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
    #[must_use]
    pub const fn new(list: &'a [(&'a str, Attr<'a>)], ids: &'a str) -> Self {
        Attrs {
            list: List::Borrowed(list),
            ids: Cow::Borrowed(ids),
        }
    }

    /// No attributes, only scope ids.
    #[must_use]
    pub const fn scoped(ids: &'a str) -> Self {
        Attrs::new(&[], ids)
    }

    /// `mergeProps` of several lists, in order, with the scope ids: what a component whose root is
    /// another component passes that one, its own attributes for it and those it was passed.
    #[must_use]
    pub fn merged(sources: &[&[(&'a str, Attr<'a>)]], ids: &'a str) -> Self {
        Attrs {
            list: List::Owned(merge_props(sources)),
            ids: Cow::Borrowed(ids),
        }
    }

    /// The attributes, in order.
    #[must_use]
    pub fn list(&self) -> &[(&'a str, Attr<'a>)] {
        match &self.list {
            List::Borrowed(l) => l,
            List::Owned(l) => l,
        }
    }

    /// The scope ids: ` data-v-…` each.
    #[must_use]
    pub fn ids(&self) -> &str {
        &self.ids
    }

    /// Whether no attribute was passed, though there may be scope ids.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.list().is_empty()
    }
}

impl Default for Attrs<'_> {
    fn default() -> Self {
        Attrs::NONE
    }
}

/// A merged attribute: its name, its value (borrowed from its source unless merging made it) and
/// the position of the last source that gave it.
type Merged<'s, 'a> = (&'a str, Cow<'s, Attr<'a>>, usize);

fn merge<'s, 'a>(sources: &'s [&'s [(&'a str, Attr<'a>)]]) -> Vec<Merged<'s, 'a>> {
    let mut ret: Vec<Merged<'s, 'a>> = Vec::with_capacity(sources.iter().map(|s| s.len()).sum());
    for (i, source) in sources.iter().enumerate() {
        for (key, value) in source.iter() {
            let at = ret.iter().position(|(k, _, _)| k == key);
            match *key {
                "class" => {
                    let so_far = at.map_or(&Attr::Undefined, |j| &*ret[j].1);
                    if !so_far.strict_eq(value) {
                        let joined = join_classes(so_far.class_text(), value.class_text());
                        let joined = Cow::Owned(Attr::Str(Cow::Owned(joined)));
                        set(&mut ret, at, key, joined, i);
                    }
                }
                "style" => {
                    let mut res = Vec::new();
                    if let Some(j) = at {
                        merge_style_into(&mut res, ret[j].1.clone().into_owned());
                    }
                    merge_style_into(&mut res, value.clone());
                    let style = Cow::Owned(Attr::Style(normal_order(res)));
                    set(&mut ret, at, key, style, i);
                }
                _ => set(&mut ret, at, key, Cow::Borrowed(value), i),
            }
        }
    }
    ret
}

fn set<'s, 'a>(
    ret: &mut Vec<Merged<'s, 'a>>,
    at: Option<usize>,
    key: &'a str,
    value: Cow<'s, Attr<'a>>,
    i: usize,
) {
    match at {
        Some(j) => ret[j].1 = value,
        None => ret.push((key, value, i)),
    }
}

fn join_classes(a: &str, b: &str) -> String {
    match (a.is_empty(), b.is_empty()) {
        (true, _) => b.to_owned(),
        (_, true) => a.to_owned(),
        _ => {
            let mut joined = String::with_capacity(a.len() + 1 + b.len());
            joined.push_str(a);
            joined.push(' ');
            joined.push_str(b);
            joined
        }
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
#[must_use]
pub fn merge_props<'a>(sources: &[&[(&'a str, Attr<'a>)]]) -> Vec<(&'a str, Attr<'a>)> {
    merge(sources)
        .into_iter()
        .map(|(k, v, _)| (k, v.into_owned()))
        .collect()
}

/// `ssrRenderAttrs(mergeProps(...sources))` for an element given fallthrough attributes, with the
/// scope ids written after the attributes the first `ids_at + 1` sources give, where Vue's
/// `_attrs`, which holds them as keys after the attributes, sits among the sources.
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

/// `ssrRenderAttrs(attrs)` of a single list, merged with nothing: each value as the parent gave it
/// (a class not trimmed for `mergeProps`, a style given as text written as it is), then the scope
/// ids.
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

fn is_on(key: &str) -> bool {
    let b = key.as_bytes();
    b.len() > 2 && b[0] == b'o' && b[1] == b'n' && !b[2].is_ascii_lowercase()
}

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
        _ if is_lowercase_ascii(key) => key.into(),
        _ => key.to_lowercase().into(),
    };
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

fn style_into(out: &mut String, value: &Attr<'_>) {
    match value {
        Attr::Str(s) => escape_into(out, s),
        Attr::Style(entries) => {
            for (key, v) in entries {
                if !matches!(v, Attr::Str(_) | Attr::Int(_) | Attr::Float(_)) {
                    continue;
                }
                if key.starts_with("--") || is_lowercase_ascii(key) {
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
    if s.is_ascii() {
        s.make_ascii_lowercase();
        s
    } else {
        s.to_lowercase()
    }
}

/// Whether `toLowerCase` and `hyphenate` would leave `key` as it is, without asking Unicode.
fn is_lowercase_ascii(key: &str) -> bool {
    key.bytes().all(|b| b.is_ascii() && !b.is_ascii_uppercase())
}

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

fn normal_order<'a>(mut entries: Vec<(Cow<'a, str>, Attr<'a>)>) -> Vec<(Cow<'a, str>, Attr<'a>)> {
    if entries
        .iter()
        .any(|(k, _)| record::array_index(k).is_some())
    {
        entries.sort_by_key(|(k, _)| record::array_index(k).map_or((1, 0), |i| (0, i)));
    }
    entries
}

fn parse_style<'a>(css: &str) -> Vec<(Cow<'a, str>, Attr<'a>)> {
    let text = strip_comments(css);
    let mut res: Vec<(Cow<'a, str>, Attr<'a>)> = Vec::new();
    for item in split_declarations(&text) {
        if item.is_empty() {
            continue;
        }
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
            let mut j = i + 1;
            let mut closed = false;
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

fn split_declarations(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    for (i, c) in text.char_indices() {
        if c != ';' {
            continue;
        }
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
#[must_use]
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
#[must_use]
pub fn scope_attrs(inherited: &str, own: &str, slotted: &str) -> String {
    let mut keys: Vec<&str> = inherited.split(' ').filter(|k| !k.is_empty()).collect();
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

#[cfg(test)]
mod tests;
