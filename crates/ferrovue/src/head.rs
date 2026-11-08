use std::borrow::{Borrow, Cow};
use std::cell::{Cell, RefCell};
use std::sync::LazyLock;

use ferrovue_core::push_number;

use crate::props::array_index;
use crate::strings::{js_json_number, js_json_string};
use dedupe::{capo_weight, dedupe, dedupe_key, hash_tag, order, title_template};
use normalize::{entry_tags, seo_meta_tags, strip_unsafe};
use tag::{Props, Tag};
use write::{props_into, sanitize, tag_into};

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

mod dedupe;
mod normalize;
mod tag;
mod write;

#[cfg(test)]
mod tests;
