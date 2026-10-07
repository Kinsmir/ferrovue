use std::borrow::{Borrow, Cow};
use std::cell::{Cell, RefCell};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

use ferrovue_core::push_number;

use crate::record::array_index;
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
/// use ferrovue::HeadValue;
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

#[derive(Debug)]
enum Entry {
    Input(HeadValue),
    SeoMeta(HeadValue, Vec<(&'static str, &'static str, HeadValue)>),
}

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
/// use ferrovue::{Head, HeadValue};
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
        head.push(HeadValue::object([
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
        ]));
        head
    }

    /// The head `createHead({ disableDefaults: true })` makes: empty.
    ///
    /// # Example
    ///
    /// ```
    /// assert_eq!(ferrovue::Head::without_defaults().render(), ferrovue::HeadHtml::default());
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
    /// use ferrovue::{Head, HeadValue};
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
        let tags = self.resolve();
        let mut html = HeadHtml::default();
        let mut html_attrs = Props::default();
        let mut body_attrs = Props::default();
        for tag in &tags {
            match tag.tag.as_str() {
                "htmlAttrs" => html_attrs.assign(&tag.props),
                "bodyAttrs" => body_attrs.assign(&tag.props),
                _ => {
                    let target = match tag.tag_position.truthy() {
                        false => &mut html.head_tags,
                        true => match &tag.tag_position {
                            HeadValue::Str(s) if s == "head" => &mut html.head_tags,
                            HeadValue::Str(s) if s == "bodyClose" => &mut html.body_tags,
                            HeadValue::Str(s) if s == "bodyOpen" => &mut html.body_tags_open,
                            _ => continue,
                        },
                    };
                    if !target.is_empty() {
                        target.push('\n');
                    }
                    tag_into(target, tag);
                }
            }
        }
        props_into(&mut html.html_attrs, &html_attrs);
        props_into(&mut html.body_attrs, &body_attrs);
        html
    }

    fn resolve(&self) -> Vec<Tag> {
        let mut all = Vec::new();
        let entries = self.entries.borrow();
        let mut ordered: Vec<&(usize, Entry)> = entries.iter().collect();
        ordered.sort_by_key(|(deferral, _)| *deferral);
        for (i, (_, entry)) in ordered.into_iter().enumerate() {
            let mut tags = match entry {
                Entry::Input(input) => entry_tags(input),
                Entry::SeoMeta(input, meta) => {
                    let mut tags = entry_tags(input);
                    tags.extend(seo_meta_tags(meta));
                    tags
                }
            };
            for (j, tag) in tags.iter_mut().enumerate() {
                tag.weight = capo_weight(tag);
                tag.position = (((i + 1) as i64) << 10) + j as i64;
                tag.dedupe = dedupe_key(tag);
                if tag.dedupe.is_none() {
                    tag.hash = Some(hash_tag(tag));
                }
            }
            all.extend(tags);
        }
        let (mut map, flat) = dedupe(all);
        title_template(&mut map);
        let mut tags: Vec<Tag> = map
            .slots
            .into_iter()
            .flat_map(|(_, slot)| slot.tags)
            .collect();
        if flat {
            tags.sort_by(order);
        }
        sanitize(tags)
    }
}

#[derive(Debug, Clone)]
enum Prop {
    Value(HeadValue),
    Class(Vec<String>),
    Style(Vec<(String, String)>),
}

impl Prop {
    fn truthy(&self) -> bool {
        match self {
            Prop::Value(v) => v.truthy(),
            Prop::Class(_) | Prop::Style(_) => true,
        }
    }

    fn js_string(&self) -> String {
        match self {
            Prop::Value(v) => v.js_string(),
            Prop::Class(_) => "[object Set]".to_owned(),
            Prop::Style(_) => "[object Map]".to_owned(),
        }
    }

    fn is_str(&self, s: &str) -> bool {
        matches!(self, Prop::Value(HeadValue::Str(v)) if v == s)
    }

    fn has_content(&self) -> bool {
        match self {
            Prop::Value(HeadValue::Number(x)) => x.is_finite(),
            other => other.truthy(),
        }
    }
}

#[derive(Debug, Clone, Default)]
struct Props(Vec<(String, Prop)>);

impl Props {
    fn get(&self, key: &str) -> Option<&Prop> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    fn truthy(&self, key: &str) -> bool {
        self.get(key).is_some_and(Prop::truthy)
    }

    fn defined(&self, key: &str) -> Option<&Prop> {
        self.get(key)
            .filter(|p| !matches!(p, Prop::Value(HeadValue::Undefined)))
    }

    fn set(&mut self, key: String, value: Prop) {
        if let Some(slot) = self.0.iter_mut().find(|(k, _)| *k == key) {
            slot.1 = value;
            return;
        }
        let at = js_key_place(self.0.iter().map(|(k, _)| k.as_str()), &key);
        self.0.insert(at, (key, value));
    }

    fn assign(&mut self, other: &Props) {
        for (k, v) in &other.0 {
            self.set(k.clone(), v.clone());
        }
    }
}

#[derive(Debug, Clone, Default)]
struct Tag {
    tag: String,
    props: Props,
    text_content: HeadValue,
    inner_html: HeadValue,
    key: HeadValue,
    tag_position: HeadValue,
    tag_priority: HeadValue,
    tag_duplicate_strategy: HeadValue,
    weight: f64,
    position: i64,
    dedupe: Option<String>,
    hash: Option<Key>,
}

impl Tag {
    fn named(tag: &str) -> Tag {
        Tag {
            tag: tag.to_owned(),
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

fn strip_unsafe(value: &HeadValue) -> HeadValue {
    match value {
        HeadValue::Array(items) => HeadValue::Array(items.iter().map(strip_unsafe).collect()),
        HeadValue::Object(entries) => HeadValue::Object(
            entries
                .iter()
                .filter(|(k, _)| !unsafe_key(k))
                .map(|(k, v)| (k.clone(), strip_unsafe(v)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn entry_tags(input: &HeadValue) -> Vec<Tag> {
    let HeadValue::Object(entries) = strip_unsafe(input) else {
        return Vec::new();
    };
    let mut tags = Vec::new();
    for (key, value) in &entries {
        match value {
            HeadValue::Undefined => {}
            HeadValue::Array(items) => {
                for item in items {
                    tags.extend(normalize_tag(key, item));
                }
            }
            other => tags.extend(normalize_tag(key, other)),
        }
    }
    tags
}

fn normalize_tag(name: &str, input: &HeadValue) -> Vec<Tag> {
    let wrapped;
    let input = if input.is_object_type() {
        input
    } else {
        let field = if matches!(name, "script" | "noscript" | "style") {
            "innerHTML"
        } else {
            "textContent"
        };
        wrapped = HeadValue::Object(vec![(Cow::Borrowed(field), input.clone())]);
        &wrapped
    };
    let mut tag = Tag::named(name);
    normalize_props(&mut tag, input);
    if tag.key.truthy() && DUPEABLE.contains(&name) {
        tag.props
            .set("data-hid".to_owned(), Prop::Value(tag.key.clone()));
        tag.hash = Some(Key::of(&tag.key));
    }
    if let Some(Prop::Value(HeadValue::Array(contents))) = tag.props.get("content").cloned() {
        return contents
            .into_iter()
            .map(|content| {
                let mut each = tag.clone();
                each.props.set("content".to_owned(), Prop::Value(content));
                each
            })
            .collect();
    }
    vec![tag]
}

fn normalize_props(tag: &mut Tag, input: &HeadValue) {
    let entries: Vec<(Cow<'static, str>, HeadValue)> = match input {
        HeadValue::Object(entries) => entries.clone(),
        HeadValue::Array(items) => items
            .iter()
            .enumerate()
            .map(|(i, v)| (Cow::Owned(i.to_string()), v.clone()))
            .collect(),
        _ => return,
    };
    if tag.tag == "templateParams" {
        for (k, v) in entries {
            tag.props.set(k.into_owned(), Prop::Value(v));
        }
        return;
    }
    let html_tag =
        HAS_ELEMENT.contains(&tag.tag.as_str()) || tag.tag == "htmlAttrs" || tag.tag == "bodyAttrs";
    for (prop, value) in &entries {
        let prop: &str = prop;
        if unsafe_key(prop) {
            continue;
        }
        let data = prop.starts_with("data-");
        let attr = html_tag && !CONFIG_KEYS.contains(&prop);
        let key = if attr && !data {
            prop.to_lowercase()
        } else {
            prop.to_owned()
        };
        if attr && (key.is_empty() || invalid_attr_name(&key)) {
            continue;
        }
        if *value == HeadValue::Null {
            tag.props.set(key, Prop::Value(HeadValue::Null));
        } else if prop == "class" || prop == "style" {
            tag.props
                .set(prop.to_owned(), class_or_style(prop == "style", value));
        } else if CONFIG_KEYS.contains(&prop) {
            if matches!(prop, "textContent" | "innerHTML") && value.is_object_type() {
                let given = input.get("type");
                let ty = if given.truthy() {
                    given.clone()
                } else {
                    HeadValue::str("application/json")
                };
                if let HeadValue::Str(t) = &ty
                    && (t.ends_with("json") || t == "speculationrules" || t == "importmap")
                {
                    tag.props.set("type".to_owned(), Prop::Value(ty.clone()));
                    let json = HeadValue::Str(value.json().unwrap_or_default());
                    config_field(tag, prop, json);
                }
            } else {
                config_field(tag, prop, value.clone());
            }
        } else if *value != HeadValue::Undefined {
            let s = value.js_string();
            let meta_content = tag.tag == "meta" && key == "content";
            let normalized = if s == "true" || s.is_empty() {
                if data || meta_content {
                    HeadValue::Str(s)
                } else {
                    HeadValue::Bool(true)
                }
            } else if !value.truthy() && data && s == "false" {
                HeadValue::str("false")
            } else {
                value.clone()
            };
            tag.props.set(key, Prop::Value(normalized));
        }
    }
}

fn config_field(tag: &mut Tag, prop: &str, value: HeadValue) {
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

fn class_or_style(style: bool, value: &HeadValue) -> Prop {
    let mut classes: Vec<String> = Vec::new();
    let mut styles: Vec<(String, String)> = Vec::new();
    let mut add_style = |k: String, v: String| {
        if let Some(slot) = styles.iter_mut().find(|(sk, _)| *sk == k) {
            slot.1 = v;
        } else {
            styles.push((k, v));
        }
    };
    let mut add = |v: &str, add_style: &mut dyn FnMut(String, String)| {
        if v.is_empty() {
            return;
        }
        if style {
            if let Some(i) = v.find(':').filter(|i| *i > 0) {
                add_style(js_trim(&v[..i]).to_owned(), js_trim(&v[i + 1..]).to_owned());
            }
        } else {
            for c in v.split(' ').filter(|c| !c.is_empty()) {
                if !classes.iter().any(|x| x == c) {
                    classes.push(c.to_owned());
                }
            }
        }
    };
    match value {
        HeadValue::Str(s) if style => {
            for part in s.split(';') {
                add(part, &mut add_style);
            }
        }
        HeadValue::Str(s) => add(s, &mut add_style),
        HeadValue::Array(items) => {
            for item in items {
                if let HeadValue::Str(s) = item {
                    add(s, &mut add_style);
                }
            }
        }
        HeadValue::Object(entries) => {
            for (k, v) in entries {
                if v.truthy() && *v != HeadValue::str("false") {
                    if style {
                        add_style(js_trim(k).to_owned(), v.js_string());
                    } else {
                        add(k, &mut add_style);
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

fn seo_meta_tags(meta: &[(&'static str, &'static str, HeadValue)]) -> Vec<Tag> {
    let mut tags = Vec::new();
    for (attr, name, value) in meta {
        let value = match value {
            HeadValue::Undefined => continue,
            HeadValue::Null => HeadValue::Null,
            other => {
                let s = other.js_string();
                if s == "true" || s.is_empty() {
                    HeadValue::Bool(true)
                } else {
                    other.clone()
                }
            }
        };
        let mut tag = Tag::named("meta");
        if *attr == "charset" {
            let charset = match value {
                HeadValue::Null => HeadValue::str("_null"),
                other => other,
            };
            tag.props.set("charset".to_owned(), Prop::Value(charset));
        } else {
            let content = match value {
                HeadValue::Null => HeadValue::Null,
                HeadValue::Str(s) if s == "_null" => HeadValue::Null,
                HeadValue::Number(x) => HeadValue::Str(HeadValue::Number(x).js_string()),
                other => other,
            };
            tag.props
                .set((*attr).to_owned(), Prop::Value(HeadValue::str(name)));
            tag.props.set("content".to_owned(), Prop::Value(content));
        }
        tags.push(tag);
    }
    tags
}

fn capo_weight(tag: &Tag) -> f64 {
    if let HeadValue::Number(x) = tag.tag_priority {
        return x;
    }
    let offset = match &tag.tag_priority {
        HeadValue::Str(s) if s == "critical" => -8.0,
        HeadValue::Str(s) if s == "high" => -1.0,
        HeadValue::Str(s) if s == "low" => 2.0,
        _ => 0.0,
    };
    let props = &tag.props;
    let set = |key: &str| {
        props
            .get(key)
            .is_some_and(|p| matches!(p, Prop::Value(HeadValue::Bool(true))) || p.is_str(""))
    };
    let weight = match tag.tag.as_str() {
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
        "link" if props.truthy("rel") => match props.get("rel") {
            Some(Prop::Value(HeadValue::Str(rel))) => match rel.as_str() {
                "preconnect" => 20.0,
                "stylesheet" => 60.0,
                "preload" | "modulepreload" => 70.0,
                "prefetch" | "dns-prefetch" | "prerender" => 90.0,
                _ => 100.0,
            },
            _ => 100.0,
        },
        "script" => {
            let ty = match props.get("type") {
                Some(Prop::Value(HeadValue::Str(t))) => t.as_str(),
                _ => "",
            };
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
            if tag.inner_html.truthy() && tag.inner_html.js_string().contains("@import") {
                40.0
            } else {
                60.0
            }
        }
        _ => 100.0,
    };
    weight + offset
}

fn dedupe_key(tag: &Tag) -> Option<String> {
    let t = tag.tag.as_str();
    let props = &tag.props;
    if UNIQUE.contains(&t) {
        return Some(t.to_owned());
    }
    if t == "link" {
        if props.get("rel").is_some_and(|p| p.is_str("canonical")) {
            return Some("canonical".to_owned());
        }
        if props.get("rel").is_some_and(|p| p.is_str("alternate")) && props.truthy("hreflang") {
            return Some(format!("alternate:{}", props.get("hreflang")?.js_string()));
        }
    }
    if props.truthy("charset") {
        return Some("charset".to_owned());
    }
    if t == "meta" {
        for n in ["name", "property", "http-equiv"] {
            if let Some(v) = props.defined(n) {
                let s = v.js_string();
                let colon = matches!(v, Prop::Value(HeadValue::Str(_))) && s.contains(':');
                let norewrite = matches!(
                    s.as_str(),
                    "viewport" | "description" | "keywords" | "robots"
                );
                let keyed = !colon && !norewrite && tag.key.truthy();
                return Some(if keyed {
                    format!("meta:{s}:key:{}", tag.key.js_string())
                } else {
                    format!("meta:{s}")
                });
            }
        }
    }
    if tag.key.truthy() {
        return Some(format!("{t}:key:{}", tag.key.js_string()));
    }
    if props.truthy("id") {
        return Some(format!("{t}:id:{}", props.get("id")?.js_string()));
    }
    if t == "link" && props.truthy("rel") && props.truthy("href") {
        return Some(format!(
            "link:{}:{}",
            props.get("rel")?.js_string(),
            props.get("href")?.js_string()
        ));
    }
    if INNER_CONTENT.contains(&t) {
        let content = if tag.text_content.truthy() {
            &tag.text_content
        } else {
            &tag.inner_html
        };
        if content.truthy() {
            return Some(format!("{t}:content:{}", content.js_string()));
        }
    }
    None
}

static UNIQUE_KEYS: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Key {
    Str(String),
    Num(u64),
    Bool(bool),
    Unique(usize),
}

impl Key {
    fn of(value: &HeadValue) -> Key {
        match value {
            HeadValue::Str(s) => Key::Str(s.clone()),
            HeadValue::Number(x) if x.is_nan() => Key::Num(f64::NAN.to_bits()),
            HeadValue::Number(x) => Key::Num((x + 0.0).to_bits()),
            HeadValue::Bool(b) => Key::Bool(*b),
            _ => Key::Unique(UNIQUE_KEYS.fetch_add(1, AtomicOrdering::Relaxed)),
        }
    }
}

fn hash_tag(tag: &Tag) -> Key {
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
    let mut keys: Vec<&String> = tag.props.0.iter().map(|(k, _)| k).collect();
    keys.sort_by(|a, b| js_cmp(a, b));
    let mut hash = format!("{}:", tag.tag);
    for (i, k) in keys.into_iter().enumerate() {
        if i > 0 {
            hash.push(',');
        }
        hash.push_str(k);
        hash.push(':');
        hash.push_str(&tag.props.get(k).map(Prop::js_string).unwrap_or_default());
    }
    Key::Str(hash)
}

fn order(a: &Tag, b: &Tag) -> Ordering {
    if a.weight == b.weight {
        a.position.cmp(&b.position)
    } else {
        a.weight.partial_cmp(&b.weight).unwrap_or(Ordering::Equal)
    }
}

struct Slot {
    tags: Vec<Tag>,
}

impl Slot {
    fn last(&self) -> &Tag {
        self.tags.last().expect("a slot holds a tag")
    }
}

#[derive(Default)]
struct TagMap {
    slots: Vec<(Key, Slot)>,
    index: HashMap<Key, usize>,
}

impl TagMap {
    fn get(&self, key: &Key) -> Option<&Slot> {
        self.index.get(key).map(|&i| &self.slots[i].1)
    }

    fn set(&mut self, key: Key, slot: Slot) {
        match self.index.get(&key) {
            Some(&i) => self.slots[i].1 = slot,
            None => {
                self.index.insert(key.clone(), self.slots.len());
                self.slots.push((key, slot));
            }
        }
    }
}

fn is_meta_array_key(key: &Key) -> bool {
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

fn merged(prev: &Tag, next: &Tag) -> Tag {
    let mut props = prev.props.clone();
    for (p, value) in &next.props.0 {
        let value = match (p.as_str(), prev.props.get(p), value) {
            ("style", before, Prop::Style(after)) => {
                let mut all = match before {
                    Some(Prop::Style(s)) => s.clone(),
                    _ => Vec::new(),
                };
                for (k, v) in after {
                    match all.iter_mut().find(|(sk, _)| sk == k) {
                        Some(slot) => slot.1 = v.clone(),
                        None => all.push((k.clone(), v.clone())),
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
                    if !all.contains(c) {
                        all.push(c.clone());
                    }
                }
                Prop::Class(all)
            }
            _ => value.clone(),
        };
        props.set(p.clone(), value);
    }
    Tag {
        props,
        ..next.clone()
    }
}

fn same_key(a: &HeadValue, b: &HeadValue) -> bool {
    match (a, b) {
        (HeadValue::Number(x), HeadValue::Number(y)) => x == y,
        (HeadValue::Array(_) | HeadValue::Object(_), _) => false,
        _ => a == b,
    }
}

fn outranks(next: &Tag, prev: &Tag) -> bool {
    if next.weight == prev.weight {
        next.position > prev.position
    } else {
        next.weight < prev.weight
    }
}

fn dedupe(mut tags: Vec<Tag>) -> (TagMap, bool) {
    tags.sort_by(order);
    let mut map = TagMap::default();
    let mut flat = false;
    for next in tags {
        let key = next
            .dedupe
            .clone()
            .map_or_else(|| hash_tag(&next), Key::Str);
        let Some(slot) = map.get(&key) else {
            map.set(key, Slot { tags: vec![next] });
            continue;
        };
        let prev = slot.last();
        let strategy_merge = if next.tag_duplicate_strategy.truthy() {
            next.tag_duplicate_strategy == HeadValue::str("merge")
        } else {
            MERGED.contains(&next.tag.as_str())
                || (next.key.truthy() && same_key(&next.key, &prev.key))
        };
        if strategy_merge {
            let tag = merged(prev, &next);
            map.set(key, Slot { tags: vec![tag] });
        } else if next.position >> 10 == prev.position >> 10
            && next.tag == "meta"
            && is_meta_array_key(&key)
        {
            let mut group = slot.tags.clone();
            group.push(next);
            map.set(key, Slot { tags: group });
            flat = true;
        } else if outranks(&next, prev) {
            map.set(key, Slot { tags: vec![next] });
        }
    }
    (map, flat)
}

fn title_template(map: &mut TagMap) {
    let title_key = Key::Str("title".to_owned());
    let template_key = Key::Str("titleTemplate".to_owned());
    let Some(template) = map.get(&template_key).map(|s| s.last().clone()) else {
        return;
    };
    if !template.text_content.truthy() {
        return;
    }
    let title = map.get(&title_key).map(|s| s.last().clone());
    let value = match &template.text_content {
        HeadValue::Str(t) => {
            let with = match &title {
                Some(title) if title.text_content.truthy() => title.text_content.js_string(),
                _ => String::new(),
            };
            HeadValue::Str(js_replace(t, "%s", &with).into_owned())
        }
        other => other.clone(),
    };
    match title {
        Some(title) => map.set(
            title_key,
            Slot {
                tags: vec![Tag {
                    text_content: value,
                    ..title
                }],
            },
        ),
        None => map.set(
            template_key,
            Slot {
                tags: vec![Tag {
                    tag: "title".to_owned(),
                    text_content: value,
                    ..template
                }],
            },
        ),
    }
}

fn has_content(value: &HeadValue) -> bool {
    match value {
        HeadValue::Number(x) => x.is_finite(),
        other => other.truthy(),
    }
}

fn sanitize(tags: Vec<Tag>) -> Vec<Tag> {
    let mut kept = Vec::with_capacity(tags.len());
    for mut t in tags {
        if !VALID.contains(&t.tag.as_str())
            || (t.props.0.is_empty()
                && !has_content(&t.inner_html)
                && !has_content(&t.text_content))
        {
            continue;
        }
        if t.tag == "meta"
            && !t.props.get("content").is_some_and(Prop::has_content)
            && !t.props.truthy("http-equiv")
            && !t.props.truthy("charset")
        {
            continue;
        }
        if t.tag == "script" && (t.inner_html.truthy() || t.text_content.truthy()) {
            let ty = t
                .props
                .get("type")
                .map_or_else(|| "undefined".to_owned(), Prop::js_string);
            let json_like = ty.ends_with("json") || ty == "importmap" || ty == "speculationrules";
            let escape = |content: &HeadValue| -> HeadValue {
                if json_like {
                    let text = match content {
                        HeadValue::Str(s) => s.clone(),
                        other => other.json().unwrap_or_default(),
                    };
                    HeadValue::Str(text.replace('<', "\\u003C"))
                } else {
                    match content {
                        HeadValue::Str(s) => HeadValue::Str(s.replace("</script", "<\\/script")),
                        other => other.clone(),
                    }
                }
            };
            if t.inner_html.truthy() {
                t.inner_html = escape(&t.inner_html);
            }
            if t.text_content.truthy() {
                t.text_content = escape(&t.text_content);
            }
            t.dedupe = dedupe_key(&t);
        }
        kept.push(t);
    }
    kept
}

fn escape_html_into(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            '/' => out.push_str("&#x2F;"),
            c => out.push(c),
        }
    }
}

fn props_into(out: &mut String, props: &Props) {
    for (key, value) in &props.0 {
        if key.is_empty() || invalid_attr_name(key) {
            continue;
        }
        let text = match value {
            Prop::Value(HeadValue::Bool(false) | HeadValue::Null) => continue,
            Prop::Value(HeadValue::Bool(true)) => {
                out.push(' ');
                out.push_str(key);
                continue;
            }
            Prop::Value(v) => v.js_string(),
            Prop::Class(classes) if key == "class" => classes.join(" "),
            Prop::Style(styles) if key == "style" => styles
                .iter()
                .map(|(k, v)| format!("{k}:{v}"))
                .collect::<Vec<_>>()
                .join(";"),
            other => other.js_string(),
        };
        out.push(' ');
        out.push_str(key);
        out.push_str("=\"");
        out.push_str(&text.replace('"', "&quot;"));
        out.push('"');
    }
}

fn replace_close_tag(content: &str, tag: &str) -> String {
    let needle = format!("</{tag}");
    let lower = content.to_ascii_lowercase();
    if !lower.contains(&needle) {
        return content.to_owned();
    }
    let mut out = String::with_capacity(content.len() + 4);
    let mut at = 0;
    while let Some(i) = lower[at..].find(&needle) {
        out.push_str(&content[at..at + i]);
        out.push_str("<\\/");
        out.push_str(tag);
        at += i + needle.len();
    }
    out.push_str(&content[at..]);
    out
}

fn tag_into(out: &mut String, tag: &Tag) {
    out.push('<');
    out.push_str(&tag.tag);
    props_into(out, &tag.props);
    out.push('>');
    if SELF_CLOSING.contains(&tag.tag.as_str()) {
        return;
    }
    if INNER_CONTENT.contains(&tag.tag.as_str()) {
        let content = match (&tag.text_content, &tag.inner_html) {
            (HeadValue::Undefined | HeadValue::Null, HeadValue::Undefined | HeadValue::Null) => {
                String::new()
            }
            (HeadValue::Undefined | HeadValue::Null, html) => html.js_string(),
            (text, _) => text.js_string(),
        };
        if tag.tag == "title" {
            escape_html_into(out, &content);
        } else {
            out.push_str(&replace_close_tag(&content, &tag.tag));
        }
    }
    out.push_str("</");
    out.push_str(&tag.tag);
    out.push('>');
}

#[cfg(test)]
mod tests;
