use std::borrow::{Borrow, Cow};
use std::cell::{Cell, RefCell};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

use ferrovue_core::push_number;

use crate::props::array_index;
use crate::strings::{is_js_space, js_cmp, js_json_number, js_json_string, js_replace, js_trim};

/// A value given to `useHead`, as JavaScript holds it: what the generated code builds from a
/// component's `useHead({ … })`, and what a page pushes with [`Head::push`].
///
/// An object keeps its keys in the order JavaScript gives them: array indices first, then the
/// others in the order they were added.
///
/// # Example
///
/// ```
/// use ferrovue::head::HeadValue;
///
/// let input = HeadValue::object([
///     ("title", HeadValue::str("Dune")),
///     ("meta", HeadValue::array([HeadValue::object([
///         ("name", HeadValue::str("description")),
///         ("content", HeadValue::str("A desert planet")),
///     ])])),
/// ]);
/// assert!(matches!(input, HeadValue::Object(_)));
/// ```
#[derive(Debug, Clone, PartialEq, Default)]
#[non_exhaustive]
pub enum HeadValue {
    /// `undefined`: a key given it is left out.
    #[default]
    Undefined,
    /// `null`.
    Null,
    /// A boolean.
    Bool(bool),
    /// A number.
    Number(f64),
    /// A string.
    Str(String),
    /// An array.
    Array(Vec<HeadValue>),
    /// An object, its keys in JavaScript's order.
    Object(Vec<(Cow<'static, str>, HeadValue)>),
}

impl HeadValue {
    /// A string.
    #[must_use]
    pub fn str(s: &str) -> HeadValue {
        HeadValue::Str(s.to_owned())
    }

    /// An integer, as the JavaScript number it is.
    #[must_use]
    pub fn int(n: impl Borrow<i64>) -> HeadValue {
        HeadValue::Number(*n.borrow() as f64)
    }

    /// A number.
    #[must_use]
    pub fn float(x: impl Borrow<f64>) -> HeadValue {
        HeadValue::Number(*x.borrow())
    }

    /// A boolean.
    #[must_use]
    pub fn bool(b: impl Borrow<bool>) -> HeadValue {
        HeadValue::Bool(*b.borrow())
    }

    /// An array.
    #[must_use]
    pub fn array(items: impl IntoIterator<Item = HeadValue>) -> HeadValue {
        HeadValue::Array(items.into_iter().collect())
    }

    /// An object of these keys and values: a key given twice keeps its first place and its last
    /// value, as in a JavaScript object literal.
    #[must_use]
    pub fn object<K: Into<Cow<'static, str>>>(
        entries: impl IntoIterator<Item = (K, HeadValue)>,
    ) -> HeadValue {
        let mut ordered: Vec<(Cow<'static, str>, HeadValue)> = Vec::new();
        for (key, value) in entries {
            let key = key.into();
            if let Some(slot) = ordered.iter_mut().find(|(k, _)| *k == key) {
                slot.1 = value;
                continue;
            }
            let at = js_key_place(ordered.iter().map(|(k, _)| k.as_ref()), &key);
            ordered.insert(at, (key, value));
        }
        HeadValue::Object(ordered)
    }

    fn truthy(&self) -> bool {
        match self {
            HeadValue::Undefined | HeadValue::Null => false,
            HeadValue::Bool(b) => *b,
            HeadValue::Number(x) => *x != 0.0 && !x.is_nan(),
            HeadValue::Str(s) => !s.is_empty(),
            HeadValue::Array(_) | HeadValue::Object(_) => true,
        }
    }

    fn is_object_type(&self) -> bool {
        matches!(
            self,
            HeadValue::Null | HeadValue::Array(_) | HeadValue::Object(_)
        )
    }

    fn get(&self, key: &str) -> &HeadValue {
        match self {
            HeadValue::Object(entries) => entries
                .iter()
                .find(|(k, _)| k == key)
                .map_or(&HeadValue::Undefined, |(_, v)| v),
            _ => &HeadValue::Undefined,
        }
    }

    fn js_string(&self) -> String {
        let mut out = String::new();
        self.push_js_string(&mut out);
        out
    }

    fn js_str(&self) -> Cow<'_, str> {
        match self {
            HeadValue::Undefined => Cow::Borrowed("undefined"),
            HeadValue::Null => Cow::Borrowed("null"),
            HeadValue::Bool(true) => Cow::Borrowed("true"),
            HeadValue::Bool(false) => Cow::Borrowed("false"),
            HeadValue::Str(s) => Cow::Borrowed(s),
            HeadValue::Object(_) => Cow::Borrowed("[object Object]"),
            HeadValue::Number(_) | HeadValue::Array(_) => Cow::Owned(self.js_string()),
        }
    }

    fn push_js_string(&self, out: &mut String) {
        match self {
            HeadValue::Undefined => out.push_str("undefined"),
            HeadValue::Null => out.push_str("null"),
            HeadValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            HeadValue::Number(x) => push_number(out, *x),
            HeadValue::Str(s) => out.push_str(s),
            HeadValue::Array(items) => {
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    if !matches!(item, HeadValue::Undefined | HeadValue::Null) {
                        item.push_js_string(out);
                    }
                }
            }
            HeadValue::Object(_) => out.push_str("[object Object]"),
        }
    }

    fn json(&self) -> Option<String> {
        match self {
            HeadValue::Undefined => None,
            HeadValue::Null => Some("null".to_owned()),
            HeadValue::Bool(b) => Some(b.to_string()),
            HeadValue::Number(x) => Some(js_json_number(*x)),
            HeadValue::Str(s) => Some(js_json_string(s)),
            HeadValue::Array(items) => {
                let parts: Vec<String> = items
                    .iter()
                    .map(|v| v.json().unwrap_or_else(|| "null".to_owned()))
                    .collect();
                Some(format!("[{}]", parts.join(",")))
            }
            HeadValue::Object(entries) => {
                let parts: Vec<String> = entries
                    .iter()
                    .filter_map(|(k, v)| Some(format!("{}:{}", js_json_string(k), v.json()?)))
                    .collect();
                Some(format!("{{{}}}", parts.join(",")))
            }
        }
    }
}

impl From<&str> for HeadValue {
    fn from(s: &str) -> HeadValue {
        HeadValue::Str(s.to_owned())
    }
}

impl From<String> for HeadValue {
    fn from(s: String) -> HeadValue {
        HeadValue::Str(s)
    }
}

impl From<Cow<'_, str>> for HeadValue {
    fn from(s: Cow<'_, str>) -> HeadValue {
        HeadValue::Str(s.into_owned())
    }
}

impl From<bool> for HeadValue {
    fn from(b: bool) -> HeadValue {
        HeadValue::Bool(b)
    }
}

impl From<i64> for HeadValue {
    fn from(n: i64) -> HeadValue {
        HeadValue::int(n)
    }
}

impl From<f64> for HeadValue {
    fn from(x: f64) -> HeadValue {
        HeadValue::Number(x)
    }
}

impl<T: Into<HeadValue>> From<Option<T>> for HeadValue {
    fn from(value: Option<T>) -> HeadValue {
        value.map_or(HeadValue::Undefined, Into::into)
    }
}

fn js_key_place<'k>(keys: impl ExactSizeIterator<Item = &'k str>, key: &str) -> usize {
    let len = keys.len();
    let Some(index) = array_index(key) else {
        return len;
    };
    let mut at = 0;
    for k in keys {
        match array_index(k) {
            Some(other) if other < index => at += 1,
            _ => break,
        }
    }
    at
}

/// What unhead's server renderer writes for a page's head: `renderSSRHead`'s five strings.
///
/// The tags go inside the elements their names say, and the attributes into the opening tags:
///
/// ```text
/// <html{html_attrs}><head>…{head_tags}</head><body{body_attrs}>{body_tags_open}…{body_tags}</body></html>
/// ```
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct HeadHtml {
    /// The tags inside `<head>`, one per line.
    pub head_tags: String,
    /// The tags at the end of `<body>` (`tagPosition: "bodyClose"`).
    pub body_tags: String,
    /// The tags at the start of `<body>` (`tagPosition: "bodyOpen"`).
    pub body_tags_open: String,
    /// The attributes of `<html>`, each after a space.
    pub html_attrs: String,
    /// The attributes of `<body>`, each after a space.
    pub body_attrs: String,
}

type SeoMeta = (&'static str, &'static str, HeadValue);

#[derive(Debug)]
enum Entry {
    Defaults,
    Input(HeadValue),
    SeoMeta(HeadValue, Vec<SeoMeta>),
}

static DEFAULTS: LazyLock<HeadValue> = LazyLock::new(|| {
    HeadValue::object([
        (
            "htmlAttrs",
            HeadValue::object([("lang", HeadValue::str("en"))]),
        ),
        (
            "meta",
            HeadValue::array([
                HeadValue::object([("charset", HeadValue::str("utf-8"))]),
                HeadValue::object([
                    ("name", HeadValue::str("viewport")),
                    (
                        "content",
                        HeadValue::str("width=device-width, initial-scale=1"),
                    ),
                ]),
            ]),
        ),
    ])
});

/// The head of one render: what every `useHead` and `useSeoMeta` in the component tree asked for,
/// in the order they ran. A page renders its components first, then writes [`render`](Self::render)
/// into the document. It reproduces `@unhead/vue`'s server head: its tag order, deduplication,
/// title template and escaping.
///
/// It is not `Sync`: give each render its own.
///
/// # Example
///
/// ```
/// use ferrovue::head::{Head, HeadValue};
///
/// let head = Head::new();
/// // What a generated component pushes for `useHead({ title: props.title })`.
/// head.push(HeadValue::object([("title", HeadValue::str("Dune & co"))]));
///
/// let html = head.render();
/// assert_eq!(
///     html.head_tags,
///     "<meta charset=\"utf-8\">\n\
///      <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
///      <title>Dune &amp; co</title>"
/// );
/// assert_eq!(html.html_attrs, " lang=\"en\"");
/// ```
#[derive(Debug)]
pub struct Head {
    entries: RefCell<Vec<(usize, Entry)>>,
    deferral: Cell<usize>,
}

/// While it lives, what is pushed to the [`Head`] it came from runs after everything pushed
/// outside it, as the setup of a component `defineAsyncComponent` loads runs on Vue's server once
/// the rest of the render has. Made by [`Head::deferred`].
#[doc(hidden)]
#[derive(Debug)]
pub struct HeadDeferral<'h>(&'h Head);

impl Drop for HeadDeferral<'_> {
    fn drop(&mut self) {
        self.0.deferral.set(self.0.deferral.get() - 1);
    }
}

impl Default for Head {
    fn default() -> Head {
        Head::new()
    }
}

impl Head {
    /// The head `createHead()` from `@unhead/vue/server` makes: holding unhead's defaults,
    /// `lang="en"` on `<html>`, `<meta charset="utf-8">` and the viewport.
    #[must_use]
    pub fn new() -> Head {
        let head = Head::without_defaults();
        head.entries.borrow_mut().push((0, Entry::Defaults));
        head
    }

    /// The head `createHead({ disableDefaults: true })` makes: empty.
    ///
    /// # Example
    ///
    /// ```
    /// assert_eq!(ferrovue::head::Head::without_defaults().render(), ferrovue::head::HeadHtml::default());
    /// ```
    #[must_use]
    pub fn without_defaults() -> Head {
        Head {
            entries: RefCell::new(Vec::new()),
            deferral: Cell::new(0),
        }
    }

    /// What the generated code renders a component loaded by `defineAsyncComponent` within: Vue's
    /// server runs its setup, and the setup of everything it renders, after the components rendered
    /// without waiting, so its entries come after theirs. Each level of such components nested in
    /// one another comes after the level outside it.
    #[doc(hidden)]
    #[must_use]
    pub fn deferred(&self) -> HeadDeferral<'_> {
        self.deferral.set(self.deferral.get() + 1);
        HeadDeferral(self)
    }

    /// `useHead(input)`: an entry after those already pushed. `input` is an object
    /// (`{ title, meta, link, … }`); anything else adds nothing.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::head::{Head, HeadValue};
    ///
    /// let head = Head::without_defaults();
    /// head.push(HeadValue::object([("titleTemplate", HeadValue::str("%s · Books"))]));
    /// head.push(HeadValue::object([("title", HeadValue::str("Dune"))]));
    /// assert_eq!(head.render().head_tags, "<title>Dune · Books</title>");
    /// ```
    pub fn push(&self, input: HeadValue) {
        self.entries
            .borrow_mut()
            .push((self.deferral.get(), Entry::Input(input)));
    }

    /// `useSeoMeta`: `input` holds its `title` and `titleTemplate`, and `meta` each other key as
    /// the attribute it sets (`"name"`, `"property"`, `"http-equiv"` or `"charset"`), the name it
    /// gives, and its value.
    #[doc(hidden)]
    pub fn push_seo_meta(
        &self,
        input: HeadValue,
        meta: Vec<(&'static str, &'static str, HeadValue)>,
    ) {
        self.entries
            .borrow_mut()
            .push((self.deferral.get(), Entry::SeoMeta(input, meta)));
    }
    /// The head as unhead's `renderSSRHead` writes it.
    #[must_use]
    pub fn render(&self) -> HeadHtml {
        let entries = self.entries.borrow();
        let mut ordered: Vec<&(usize, Entry)> = entries.iter().collect();
        ordered.sort_by_key(|(deferral, _)| *deferral);
        let inputs: Vec<(Cow<'_, HeadValue>, &[SeoMeta])> = ordered
            .into_iter()
            .map(|(_, entry)| match entry {
                Entry::Defaults => (Cow::Borrowed(&*DEFAULTS), &[][..]),
                Entry::Input(input) => (strip_unsafe(input), &[][..]),
                Entry::SeoMeta(input, meta) => (strip_unsafe(input), meta.as_slice()),
            })
            .collect();
        let tags = resolve(&inputs);
        let mut html = HeadHtml::default();
        let mut html_attrs = Props::default();
        let mut body_attrs = Props::default();
        for tag in tags {
            match tag.tag {
                "htmlAttrs" => html_attrs.assign(tag.props),
                "bodyAttrs" => body_attrs.assign(tag.props),
                _ => {
                    let target = match tag.tag_position.truthy() {
                        false => &mut html.head_tags,
                        true => match &*tag.tag_position {
                            HeadValue::Str(s) if s == "head" => &mut html.head_tags,
                            HeadValue::Str(s) if s == "bodyClose" => &mut html.body_tags,
                            HeadValue::Str(s) if s == "bodyOpen" => &mut html.body_tags_open,
                            _ => continue,
                        },
                    };
                    if !target.is_empty() {
                        target.push('\n');
                    }
                    tag_into(target, &tag);
                }
            }
        }
        props_into(&mut html.html_attrs, &html_attrs);
        props_into(&mut html.body_attrs, &body_attrs);
        html
    }
}

fn resolve<'a>(inputs: &'a [(Cow<'a, HeadValue>, &'a [SeoMeta])]) -> Vec<Tag<'a>> {
    let mut all = Vec::new();
    for (i, (input, meta)) in inputs.iter().enumerate() {
        let start = all.len();
        entry_tags(input, &mut all);
        seo_meta_tags(meta, &mut all);
        for (j, tag) in all[start..].iter_mut().enumerate() {
            tag.weight = capo_weight(tag);
            tag.position = (((i + 1) as i64) << 10) + j as i64;
            tag.dedupe = dedupe_key(tag);
            if tag.dedupe.is_none() {
                tag.hash = Some(hash_tag(tag));
            }
        }
    }
    let (mut map, flat) = dedupe(all);
    title_template(&mut map);
    let mut tags: Vec<Tag<'a>> = map.slots.into_iter().flatten().collect();
    if flat {
        tags.sort_by(order);
    }
    sanitize(&mut tags);
    tags
}

#[derive(Debug, Clone)]
enum Prop<'a> {
    Value(Cow<'a, HeadValue>),
    Class(Vec<&'a str>),
    Style(Vec<(&'a str, Cow<'a, str>)>),
}

impl Prop<'_> {
    fn truthy(&self) -> bool {
        match self {
            Prop::Value(v) => v.truthy(),
            Prop::Class(_) | Prop::Style(_) => true,
        }
    }

    fn js_str(&self) -> Cow<'_, str> {
        match self {
            Prop::Value(v) => v.js_str(),
            Prop::Class(_) => Cow::Borrowed("[object Set]"),
            Prop::Style(_) => Cow::Borrowed("[object Map]"),
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Prop::Value(v) => match &**v {
                HeadValue::Str(s) => Some(s),
                _ => None,
            },
            _ => None,
        }
    }

    fn is_str(&self, s: &str) -> bool {
        self.as_str() == Some(s)
    }

    fn is_value(&self, f: impl Fn(&HeadValue) -> bool) -> bool {
        matches!(self, Prop::Value(v) if f(v))
    }

    fn has_content(&self) -> bool {
        match self {
            Prop::Value(v) => has_content(v),
            other => other.truthy(),
        }
    }
}

#[derive(Debug, Clone, Default)]
struct Props<'a>(Vec<(Cow<'a, str>, Prop<'a>)>);

impl<'a> Props<'a> {
    fn get(&self, key: &str) -> Option<&Prop<'a>> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    fn truthy(&self, key: &str) -> bool {
        self.get(key).is_some_and(Prop::truthy)
    }

    fn defined(&self, key: &str) -> Option<&Prop<'a>> {
        self.get(key)
            .filter(|p| !p.is_value(|v| matches!(v, HeadValue::Undefined)))
    }

    fn set(&mut self, key: Cow<'a, str>, value: Prop<'a>) {
        if let Some(slot) = self.0.iter_mut().find(|(k, _)| *k == key) {
            slot.1 = value;
            return;
        }
        let at = js_key_place(self.0.iter().map(|(k, _)| &**k), &key);
        self.0.insert(at, (key, value));
    }

    fn assign(&mut self, other: Props<'a>) {
        for (k, v) in other.0 {
            self.set(k, v);
        }
    }
}

#[derive(Debug, Clone, Default)]
struct Tag<'a> {
    tag: &'a str,
    props: Props<'a>,
    text_content: Cow<'a, HeadValue>,
    inner_html: Cow<'a, HeadValue>,
    key: Cow<'a, HeadValue>,
    tag_position: Cow<'a, HeadValue>,
    tag_priority: Cow<'a, HeadValue>,
    tag_duplicate_strategy: Cow<'a, HeadValue>,
    weight: f64,
    position: i64,
    dedupe: Option<Cow<'a, str>>,
    hash: Option<Key<'a>>,
}

impl<'a> Tag<'a> {
    fn named(tag: &'a str) -> Tag<'a> {
        Tag {
            tag,
            ..Tag::default()
        }
    }
}

const SELF_CLOSING: [&str; 3] = ["meta", "link", "base"];
const DUPEABLE: [&str; 4] = ["link", "style", "script", "noscript"];
const INNER_CONTENT: [&str; 5] = ["title", "titleTemplate", "script", "style", "noscript"];
const HAS_ELEMENT: [&str; 6] = ["base", "meta", "link", "style", "script", "noscript"];
const VALID: [&str; 9] = [
    "title",
    "base",
    "htmlAttrs",
    "bodyAttrs",
    "meta",
    "link",
    "style",
    "script",
    "noscript",
];
const UNIQUE: [&str; 6] = [
    "base",
    "title",
    "titleTemplate",
    "bodyAttrs",
    "htmlAttrs",
    "templateParams",
];
const CONFIG_KEYS: [&str; 7] = [
    "key",
    "tagPosition",
    "tagPriority",
    "tagDuplicateStrategy",
    "innerHTML",
    "textContent",
    "processTemplateParams",
];
const MERGED: [&str; 3] = ["templateParams", "htmlAttrs", "bodyAttrs"];
const META_ARRAYABLE: [&str; 12] = [
    "theme-color",
    "google-site-verification",
    "author",
    "og:locale:alternate",
    "og:image",
    "og:video",
    "og:audio",
    "article:author",
    "article:tag",
    "book:author",
    "book:tag",
    "twitter:image",
];

fn unsafe_key(key: &str) -> bool {
    matches!(key, "__proto__" | "constructor" | "prototype")
}

fn invalid_attr_name(name: &str) -> bool {
    name.chars().any(|c| {
        is_js_space(c)
            || matches!(
                c,
                '"' | '\'' | '<' | '>' | '/' | '=' | '\u{0}'..='\u{1f}' | '\u{7f}'
            )
    })
}

fn has_unsafe(value: &HeadValue) -> bool {
    match value {
        HeadValue::Array(items) => items.iter().any(has_unsafe),
        HeadValue::Object(entries) => entries.iter().any(|(k, v)| unsafe_key(k) || has_unsafe(v)),
        _ => false,
    }
}

fn strip_unsafe(value: &HeadValue) -> Cow<'_, HeadValue> {
    if has_unsafe(value) {
        Cow::Owned(stripped(value))
    } else {
        Cow::Borrowed(value)
    }
}

fn stripped(value: &HeadValue) -> HeadValue {
    match value {
        HeadValue::Array(items) => HeadValue::Array(items.iter().map(stripped).collect()),
        HeadValue::Object(entries) => HeadValue::Object(
            entries
                .iter()
                .filter(|(k, _)| !unsafe_key(k))
                .map(|(k, v)| (k.clone(), stripped(v)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn value_str<'a>(value: &Cow<'a, HeadValue>) -> Cow<'a, str> {
    match value {
        Cow::Borrowed(v) => v.js_str(),
        Cow::Owned(v) => Cow::Owned(v.js_str().into_owned()),
    }
}

fn items_of<'a>(value: &Cow<'a, HeadValue>) -> Option<Vec<Cow<'a, HeadValue>>> {
    match value {
        Cow::Borrowed(v) => match *v {
            HeadValue::Array(items) => Some(items.iter().map(Cow::Borrowed).collect()),
            _ => None,
        },
        Cow::Owned(HeadValue::Array(items)) => {
            Some(items.iter().cloned().map(Cow::Owned).collect())
        }
        Cow::Owned(_) => None,
    }
}

fn joined(parts: &[&str]) -> String {
    let mut out = String::with_capacity(parts.iter().map(|p| p.len()).sum());
    for part in parts {
        out.push_str(part);
    }
    out
}

fn entry_tags<'a>(input: &'a HeadValue, out: &mut Vec<Tag<'a>>) {
    let HeadValue::Object(entries) = input else {
        return;
    };
    for (key, value) in entries {
        match value {
            HeadValue::Undefined => {}
            HeadValue::Array(items) => {
                for item in items {
                    normalize_tag(key, item, out);
                }
            }
            other => normalize_tag(key, other, out),
        }
    }
}

fn normalize_tag<'a>(name: &'a str, input: &'a HeadValue, out: &mut Vec<Tag<'a>>) {
    let mut tag = Tag::named(name);
    if input.is_object_type() {
        normalize_props(&mut tag, input);
    } else {
        let field = if matches!(name, "script" | "noscript" | "style") {
            "innerHTML"
        } else {
            "textContent"
        };
        if name == "templateParams" {
            tag.props
                .set(Cow::Borrowed(field), Prop::Value(Cow::Borrowed(input)));
        } else {
            config_field(&mut tag, field, Cow::Borrowed(input));
        }
    }
    if tag.key.truthy() && DUPEABLE.contains(&name) {
        tag.props
            .set(Cow::Borrowed("data-hid"), Prop::Value(tag.key.clone()));
        tag.hash = Some(Key::of(&tag.key));
    }
    if let Some(Prop::Value(content)) = tag.props.get("content")
        && let Some(contents) = items_of(content)
    {
        for content in contents {
            let mut each = tag.clone();
            each.props
                .set(Cow::Borrowed("content"), Prop::Value(content));
            out.push(each);
        }
        return;
    }
    out.push(tag);
}

fn lowercase(name: Cow<'_, str>) -> Cow<'_, str> {
    if name.is_ascii() && !name.bytes().any(|b| b.is_ascii_uppercase()) {
        name
    } else {
        Cow::Owned(name.to_lowercase())
    }
}

fn normalize_props<'a>(tag: &mut Tag<'a>, input: &'a HeadValue) {
    let (entries, items): (&'a [(Cow<'static, str>, HeadValue)], &'a [HeadValue]) = match input {
        HeadValue::Object(entries) => (entries.as_slice(), &[]),
        HeadValue::Array(items) => (&[], items.as_slice()),
        _ => return,
    };
    let entries = entries.iter().map(|(k, v)| (Cow::Borrowed(&**k), v)).chain(
        items
            .iter()
            .enumerate()
            .map(|(i, v)| (Cow::Owned(i.to_string()), v)),
    );
    if tag.tag == "templateParams" {
        for (k, v) in entries {
            tag.props.set(k, Prop::Value(Cow::Borrowed(v)));
        }
        return;
    }
    let html_tag =
        HAS_ELEMENT.contains(&tag.tag) || tag.tag == "htmlAttrs" || tag.tag == "bodyAttrs";
    for (prop, value) in entries {
        if unsafe_key(&prop) {
            continue;
        }
        let data = prop.starts_with("data-");
        let config = CONFIG_KEYS.contains(&&*prop);
        let attr = html_tag && !config;
        let key = if attr && !data {
            lowercase(prop.clone())
        } else {
            prop.clone()
        };
        if attr && (key.is_empty() || invalid_attr_name(&key)) {
            continue;
        }
        if *value == HeadValue::Null {
            tag.props.set(key, Prop::Value(Cow::Borrowed(value)));
        } else if prop == "class" || prop == "style" {
            tag.props
                .set(prop.clone(), class_or_style(prop == "style", value));
        } else if config {
            if matches!(&*prop, "textContent" | "innerHTML") && value.is_object_type() {
                let given = input.get("type");
                let ty = if given.truthy() {
                    Cow::Borrowed(given)
                } else {
                    Cow::Owned(HeadValue::str("application/json"))
                };
                if let HeadValue::Str(t) = &*ty
                    && (t.ends_with("json") || t == "speculationrules" || t == "importmap")
                {
                    tag.props
                        .set(Cow::Borrowed("type"), Prop::Value(ty.clone()));
                    let json = HeadValue::Str(value.json().unwrap_or_default());
                    config_field(tag, &prop, Cow::Owned(json));
                }
            } else {
                config_field(tag, &prop, Cow::Borrowed(value));
            }
        } else if *value != HeadValue::Undefined {
            let s = value.js_str();
            let meta_content = tag.tag == "meta" && key == "content";
            let normalized = if s == "true" || s.is_empty() {
                if !(data || meta_content) {
                    Cow::Owned(HeadValue::Bool(true))
                } else if matches!(value, HeadValue::Str(_)) {
                    Cow::Borrowed(value)
                } else {
                    Cow::Owned(HeadValue::Str(s.into_owned()))
                }
            } else if !value.truthy() && data && s == "false" {
                Cow::Owned(HeadValue::str("false"))
            } else {
                Cow::Borrowed(value)
            };
            tag.props.set(key, Prop::Value(normalized));
        }
    }
}

fn config_field<'a>(tag: &mut Tag<'a>, prop: &str, value: Cow<'a, HeadValue>) {
    match prop {
        "key" => tag.key = value,
        "tagPosition" => tag.tag_position = value,
        "tagPriority" => tag.tag_priority = value,
        "tagDuplicateStrategy" => tag.tag_duplicate_strategy = value,
        "innerHTML" => tag.inner_html = value,
        "textContent" => tag.text_content = value,
        _ => {}
    }
}

fn add_style<'a>(styles: &mut Vec<(&'a str, Cow<'a, str>)>, k: &'a str, v: Cow<'a, str>) {
    if let Some(slot) = styles.iter_mut().find(|(sk, _)| *sk == k) {
        slot.1 = v;
    } else {
        styles.push((k, v));
    }
}

fn add_part<'a>(
    style: bool,
    v: &'a str,
    classes: &mut Vec<&'a str>,
    styles: &mut Vec<(&'a str, Cow<'a, str>)>,
) {
    if v.is_empty() {
        return;
    }
    if style {
        if let Some(i) = v.find(':').filter(|i| *i > 0) {
            add_style(
                styles,
                js_trim(&v[..i]),
                Cow::Borrowed(js_trim(&v[i + 1..])),
            );
        }
    } else {
        for c in v.split(' ').filter(|c| !c.is_empty()) {
            if !classes.contains(&c) {
                classes.push(c);
            }
        }
    }
}

fn class_or_style(style: bool, value: &HeadValue) -> Prop<'_> {
    let mut classes = Vec::new();
    let mut styles = Vec::new();
    match value {
        HeadValue::Str(s) if style => {
            for part in s.split(';') {
                add_part(style, part, &mut classes, &mut styles);
            }
        }
        HeadValue::Str(s) => add_part(style, s, &mut classes, &mut styles),
        HeadValue::Array(items) => {
            for item in items {
                if let HeadValue::Str(s) = item {
                    add_part(style, s, &mut classes, &mut styles);
                }
            }
        }
        HeadValue::Object(entries) => {
            for (k, v) in entries {
                if v.truthy() && !matches!(v, HeadValue::Str(s) if s == "false") {
                    if style {
                        add_style(&mut styles, js_trim(k), v.js_str());
                    } else {
                        add_part(style, k, &mut classes, &mut styles);
                    }
                }
            }
        }
        _ => {}
    }
    if style {
        Prop::Style(styles)
    } else {
        Prop::Class(classes)
    }
}

fn seo_meta_tags<'a>(meta: &'a [SeoMeta], out: &mut Vec<Tag<'a>>) {
    for (attr, name, value) in meta {
        let value = match value {
            HeadValue::Undefined => continue,
            HeadValue::Null => Cow::Owned(HeadValue::Null),
            other => {
                let s = other.js_str();
                if s == "true" || s.is_empty() {
                    Cow::Owned(HeadValue::Bool(true))
                } else {
                    Cow::Borrowed(other)
                }
            }
        };
        let mut tag = Tag::named("meta");
        if *attr == "charset" {
            let charset = if matches!(*value, HeadValue::Null) {
                Cow::Owned(HeadValue::str("_null"))
            } else {
                value
            };
            tag.props
                .set(Cow::Borrowed("charset"), Prop::Value(charset));
        } else {
            let content = match &*value {
                HeadValue::Null => Cow::Owned(HeadValue::Null),
                HeadValue::Str(s) if s == "_null" => Cow::Owned(HeadValue::Null),
                HeadValue::Number(_) => Cow::Owned(HeadValue::Str(value.js_string())),
                _ => value,
            };
            tag.props.set(
                Cow::Borrowed(attr),
                Prop::Value(Cow::Owned(HeadValue::str(name))),
            );
            tag.props
                .set(Cow::Borrowed("content"), Prop::Value(content));
        }
        out.push(tag);
    }
}

fn capo_weight(tag: &Tag<'_>) -> f64 {
    if let HeadValue::Number(x) = *tag.tag_priority {
        return x;
    }
    let offset = match &*tag.tag_priority {
        HeadValue::Str(s) if s == "critical" => -8.0,
        HeadValue::Str(s) if s == "high" => -1.0,
        HeadValue::Str(s) if s == "low" => 2.0,
        _ => 0.0,
    };
    let props = &tag.props;
    let set = |key: &str| {
        props
            .get(key)
            .is_some_and(|p| p.is_value(|v| matches!(v, HeadValue::Bool(true))) || p.is_str(""))
    };
    let weight = match tag.tag {
        "base" => -10.0,
        "title" => 10.0,
        "meta" => {
            if props
                .get("http-equiv")
                .is_some_and(|p| p.is_str("content-security-policy"))
            {
                -30.0
            } else if props.truthy("charset") {
                -20.0
            } else if props.get("name").is_some_and(|p| p.is_str("viewport")) {
                -15.0
            } else {
                100.0
            }
        }
        "link" if props.truthy("rel") => match props.get("rel").and_then(Prop::as_str) {
            Some("preconnect") => 20.0,
            Some("stylesheet") => 60.0,
            Some("preload" | "modulepreload") => 70.0,
            Some("prefetch" | "dns-prefetch" | "prerender") => 90.0,
            _ => 100.0,
        },
        "script" => {
            let ty = props.get("type").and_then(Prop::as_str).unwrap_or("");
            let json = ty.ends_with("json");
            let content = tag.inner_html.truthy() || tag.text_content.truthy();
            if ty == "importmap" {
                25.0
            } else if ty == "speculationrules" {
                90.0
            } else if set("async") {
                30.0
            } else if (props.truthy("src") && !set("defer") && ty != "module" && !json)
                || (content && !json)
            {
                50.0
            } else if (set("defer") && props.truthy("src")) || ty == "module" {
                80.0
            } else {
                100.0
            }
        }
        "style" => {
            if tag.inner_html.truthy() && tag.inner_html.js_str().contains("@import") {
                40.0
            } else {
                60.0
            }
        }
        _ => 100.0,
    };
    weight + offset
}

fn dedupe_key<'a>(tag: &Tag<'a>) -> Option<Cow<'a, str>> {
    let t = tag.tag;
    let props = &tag.props;
    if UNIQUE.contains(&t) {
        return Some(Cow::Borrowed(t));
    }
    if t == "link" {
        if props.get("rel").is_some_and(|p| p.is_str("canonical")) {
            return Some(Cow::Borrowed("canonical"));
        }
        if props.get("rel").is_some_and(|p| p.is_str("alternate")) && props.truthy("hreflang") {
            return Some(Cow::Owned(joined(&[
                "alternate:",
                &props.get("hreflang")?.js_str(),
            ])));
        }
    }
    if props.truthy("charset") {
        return Some(Cow::Borrowed("charset"));
    }
    if t == "meta" {
        for n in ["name", "property", "http-equiv"] {
            if let Some(v) = props.defined(n) {
                let s = v.js_str();
                let colon = v.as_str().is_some() && s.contains(':');
                let norewrite = matches!(&*s, "viewport" | "description" | "keywords" | "robots");
                let keyed = !colon && !norewrite && tag.key.truthy();
                return Some(Cow::Owned(if keyed {
                    joined(&["meta:", &s, ":key:", &tag.key.js_str()])
                } else {
                    joined(&["meta:", &s])
                }));
            }
        }
    }
    if tag.key.truthy() {
        return Some(Cow::Owned(joined(&[t, ":key:", &tag.key.js_str()])));
    }
    if props.truthy("id") {
        return Some(Cow::Owned(joined(&[t, ":id:", &props.get("id")?.js_str()])));
    }
    if t == "link" && props.truthy("rel") && props.truthy("href") {
        return Some(Cow::Owned(joined(&[
            "link:",
            &props.get("rel")?.js_str(),
            ":",
            &props.get("href")?.js_str(),
        ])));
    }
    if INNER_CONTENT.contains(&t) {
        let content = if tag.text_content.truthy() {
            &tag.text_content
        } else {
            &tag.inner_html
        };
        if content.truthy() {
            return Some(Cow::Owned(joined(&[t, ":content:", &content.js_str()])));
        }
    }
    None
}

static UNIQUE_KEYS: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Key<'a> {
    Str(Cow<'a, str>),
    Num(u64),
    Bool(bool),
    Unique(usize),
}

impl<'a> Key<'a> {
    fn of(value: &Cow<'a, HeadValue>) -> Key<'a> {
        match **value {
            HeadValue::Str(_) => Key::Str(value_str(value)),
            HeadValue::Number(x) if x.is_nan() => Key::Num(f64::NAN.to_bits()),
            HeadValue::Number(x) => Key::Num((x + 0.0).to_bits()),
            HeadValue::Bool(b) => Key::Bool(b),
            _ => Key::Unique(UNIQUE_KEYS.fetch_add(1, AtomicOrdering::Relaxed)),
        }
    }
}

fn hash_tag<'a>(tag: &Tag<'a>) -> Key<'a> {
    if let Some(h) = &tag.hash {
        return h.clone();
    }
    if let Some(d) = &tag.dedupe {
        return Key::Str(d.clone());
    }
    if tag.text_content.truthy() {
        return Key::of(&tag.text_content);
    }
    if tag.inner_html.truthy() {
        return Key::of(&tag.inner_html);
    }
    let mut props: Vec<&(Cow<'a, str>, Prop<'a>)> = tag.props.0.iter().collect();
    props.sort_by(|(a, _), (b, _)| js_cmp(a, b));
    let mut hash = String::new();
    hash.push_str(tag.tag);
    hash.push(':');
    for (i, (k, v)) in props.into_iter().enumerate() {
        if i > 0 {
            hash.push(',');
        }
        hash.push_str(k);
        hash.push(':');
        hash.push_str(&v.js_str());
    }
    Key::Str(Cow::Owned(hash))
}

fn order(a: &Tag<'_>, b: &Tag<'_>) -> Ordering {
    if a.weight == b.weight {
        a.position.cmp(&b.position)
    } else {
        a.weight.partial_cmp(&b.weight).unwrap_or(Ordering::Equal)
    }
}

#[derive(Default)]
struct TagMap<'a> {
    slots: Vec<Vec<Tag<'a>>>,
    index: HashMap<Key<'a>, usize>,
}

fn last<'s, 'a>(slot: &'s [Tag<'a>]) -> &'s Tag<'a> {
    slot.last().expect("a slot holds a tag")
}

fn keep_last(slot: &mut Vec<Tag<'_>>) {
    let before = slot.len() - 1;
    slot.drain(..before);
}

fn is_meta_array_key(key: &Key<'_>) -> bool {
    let Key::Str(k) = key else {
        return false;
    };
    let Some(i) = k.find(':') else {
        return false;
    };
    let rest = &k[i + 1..];
    META_ARRAYABLE.contains(&rest)
        || ["og:image:", "og:video:", "og:audio:", "twitter:image:"]
            .iter()
            .any(|p| rest.starts_with(p))
}

fn merged<'a>(prev: Tag<'a>, mut next: Tag<'a>) -> Tag<'a> {
    let mut props = prev.props;
    for (p, value) in std::mem::take(&mut next.props.0) {
        let value = match (&*p, props.get(&p), value) {
            ("style", before, Prop::Style(after)) => {
                let mut all = match before {
                    Some(Prop::Style(s)) => s.clone(),
                    _ => Vec::new(),
                };
                for (k, v) in after {
                    match all.iter_mut().find(|(sk, _)| *sk == k) {
                        Some(slot) => slot.1 = v,
                        None => all.push((k, v)),
                    }
                }
                Prop::Style(all)
            }
            ("class", before, Prop::Class(after)) => {
                let mut all = match before {
                    Some(Prop::Class(c)) => c.clone(),
                    _ => Vec::new(),
                };
                for c in after {
                    if !all.contains(&c) {
                        all.push(c);
                    }
                }
                Prop::Class(all)
            }
            (_, _, value) => value,
        };
        props.set(p, value);
    }
    Tag { props, ..next }
}

fn same_key(a: &HeadValue, b: &HeadValue) -> bool {
    match (a, b) {
        (HeadValue::Number(x), HeadValue::Number(y)) => x == y,
        (HeadValue::Array(_) | HeadValue::Object(_), _) => false,
        _ => a == b,
    }
}

fn outranks(next: &Tag<'_>, prev: &Tag<'_>) -> bool {
    if next.weight == prev.weight {
        next.position > prev.position
    } else {
        next.weight < prev.weight
    }
}

fn dedupe(mut tags: Vec<Tag<'_>>) -> (TagMap<'_>, bool) {
    tags.sort_by(order);
    let mut map = TagMap::default();
    let mut flat = false;
    for next in tags {
        let key = match &next.dedupe {
            Some(d) => Key::Str(d.clone()),
            None => hash_tag(&next),
        };
        let Some(&i) = map.index.get(&key) else {
            map.index.insert(key, map.slots.len());
            map.slots.push(vec![next]);
            continue;
        };
        let slot = &mut map.slots[i];
        let prev = last(slot);
        let strategy_merge = if next.tag_duplicate_strategy.truthy() {
            matches!(&*next.tag_duplicate_strategy, HeadValue::Str(s) if s == "merge")
        } else {
            MERGED.contains(&next.tag) || (next.key.truthy() && same_key(&next.key, &prev.key))
        };
        if strategy_merge {
            keep_last(slot);
            if let Some(prev) = slot.pop() {
                slot.push(merged(prev, next));
            }
        } else if next.position >> 10 == prev.position >> 10
            && next.tag == "meta"
            && is_meta_array_key(&key)
        {
            slot.push(next);
            flat = true;
        } else if outranks(&next, prev) {
            slot.clear();
            slot.push(next);
        }
    }
    (map, flat)
}

fn title_template(map: &mut TagMap<'_>) {
    let Some(&template_at) = map.index.get(&Key::Str(Cow::Borrowed("titleTemplate"))) else {
        return;
    };
    let template = last(&map.slots[template_at]);
    if !template.text_content.truthy() {
        return;
    }
    let title_at = map.index.get(&Key::Str(Cow::Borrowed("title"))).copied();
    let value = match &*template.text_content {
        HeadValue::Str(t) => {
            let with = match title_at.map(|i| last(&map.slots[i])) {
                Some(title) if title.text_content.truthy() => title.text_content.js_str(),
                _ => Cow::Borrowed(""),
            };
            Cow::Owned(HeadValue::Str(js_replace(t, "%s", &with).into_owned()))
        }
        _ => template.text_content.clone(),
    };
    let slot = &mut map.slots[title_at.unwrap_or(template_at)];
    keep_last(slot);
    if title_at.is_none() {
        slot[0].tag = "title";
    }
    slot[0].text_content = value;
}

fn has_content(value: &HeadValue) -> bool {
    match value {
        HeadValue::Number(x) => x.is_finite(),
        other => other.truthy(),
    }
}

fn script_escaped<'a>(json_like: bool, content: &Cow<'a, HeadValue>) -> Cow<'a, HeadValue> {
    if json_like {
        let text = match &**content {
            HeadValue::Str(s) => Cow::Borrowed(s.as_str()),
            other => Cow::Owned(other.json().unwrap_or_default()),
        };
        if text.contains('<') {
            Cow::Owned(HeadValue::Str(text.replace('<', "\\u003C")))
        } else if let Cow::Owned(text) = text {
            Cow::Owned(HeadValue::Str(text))
        } else {
            content.clone()
        }
    } else {
        match &**content {
            HeadValue::Str(s) if s.contains("</script") => {
                Cow::Owned(HeadValue::Str(s.replace("</script", "<\\/script")))
            }
            _ => content.clone(),
        }
    }
}

fn sanitize(tags: &mut Vec<Tag<'_>>) {
    tags.retain_mut(|t| {
        if !VALID.contains(&t.tag)
            || (t.props.0.is_empty()
                && !has_content(&t.inner_html)
                && !has_content(&t.text_content))
        {
            return false;
        }
        if t.tag == "meta"
            && !t.props.get("content").is_some_and(Prop::has_content)
            && !t.props.truthy("http-equiv")
            && !t.props.truthy("charset")
        {
            return false;
        }
        if t.tag == "script" && (t.inner_html.truthy() || t.text_content.truthy()) {
            let json_like = {
                let ty = t
                    .props
                    .get("type")
                    .map_or(Cow::Borrowed("undefined"), Prop::js_str);
                ty.ends_with("json") || ty == "importmap" || ty == "speculationrules"
            };
            if t.inner_html.truthy() {
                t.inner_html = script_escaped(json_like, &t.inner_html);
            }
            if t.text_content.truthy() {
                t.text_content = script_escaped(json_like, &t.text_content);
            }
        }
        true
    });
}

fn escape_html_into(out: &mut String, s: &str) {
    let mut at = 0;
    for (i, b) in s.bytes().enumerate() {
        let escaped = match b {
            b'&' => "&amp;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            b'"' => "&quot;",
            b'\'' => "&#x27;",
            b'/' => "&#x2F;",
            _ => continue,
        };
        out.push_str(&s[at..i]);
        out.push_str(escaped);
        at = i + 1;
    }
    out.push_str(&s[at..]);
}

fn props_into(out: &mut String, props: &Props<'_>) {
    for (key, value) in &props.0 {
        if key.is_empty() || invalid_attr_name(key) {
            continue;
        }
        if value.is_value(|v| matches!(v, HeadValue::Bool(false) | HeadValue::Null)) {
            continue;
        }
        out.push(' ');
        out.push_str(key);
        match value {
            Prop::Value(v) if matches!(**v, HeadValue::Bool(true)) => continue,
            Prop::Value(v) => quoted_into(out, &v.js_str()),
            Prop::Class(classes) if key == "class" => {
                out.push_str("=\"");
                for (i, class) in classes.iter().enumerate() {
                    if i > 0 {
                        out.push(' ');
                    }
                    quotes_escaped_into(out, class);
                }
                out.push('"');
            }
            Prop::Style(styles) if key == "style" => {
                out.push_str("=\"");
                for (i, (k, v)) in styles.iter().enumerate() {
                    if i > 0 {
                        out.push(';');
                    }
                    quotes_escaped_into(out, k);
                    out.push(':');
                    quotes_escaped_into(out, v);
                }
                out.push('"');
            }
            other => quoted_into(out, &other.js_str()),
        }
    }
}

/// `="text"`, with each `"` in it written `&quot;`.
fn quoted_into(out: &mut String, text: &str) {
    out.push_str("=\"");
    quotes_escaped_into(out, text);
    out.push('"');
}

fn quotes_escaped_into(out: &mut String, text: &str) {
    let mut parts = text.split('"');
    if let Some(first) = parts.next() {
        out.push_str(first);
    }
    for part in parts {
        out.push_str("&quot;");
        out.push_str(part);
    }
}

/// `content` with every `</tag`, in any case, written `<\/tag`.
fn replace_close_tag_into(out: &mut String, content: &str, tag: &str) {
    let mut at = 0;
    for (i, _) in content.match_indices("</") {
        let name = content.as_bytes()[i + 2..].get(..tag.len());
        let closes = name.is_some_and(|name| {
            name.iter()
                .zip(tag.as_bytes())
                .all(|(c, t)| c.to_ascii_lowercase() == *t)
        });
        if i >= at && closes {
            out.push_str(&content[at..i]);
            out.push_str("<\\/");
            out.push_str(tag);
            at = i + 2 + tag.len();
        }
    }
    out.push_str(&content[at..]);
}

fn tag_into(out: &mut String, tag: &Tag<'_>) {
    out.push('<');
    out.push_str(tag.tag);
    props_into(out, &tag.props);
    out.push('>');
    if SELF_CLOSING.contains(&tag.tag) {
        return;
    }
    if INNER_CONTENT.contains(&tag.tag) {
        let content = match (&*tag.text_content, &*tag.inner_html) {
            (HeadValue::Undefined | HeadValue::Null, HeadValue::Undefined | HeadValue::Null) => {
                Cow::Borrowed("")
            }
            (HeadValue::Undefined | HeadValue::Null, html) => html.js_str(),
            (text, _) => text.js_str(),
        };
        if tag.tag == "title" {
            escape_html_into(out, &content);
        } else {
            replace_close_tag_into(out, &content, tag.tag);
        }
    }
    out.push_str("</");
    out.push_str(tag.tag);
    out.push('>');
}

#[cfg(test)]
mod tests;
