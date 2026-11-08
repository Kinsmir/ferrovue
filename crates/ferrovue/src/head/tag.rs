use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

use super::{HeadValue, js_key_place};
use crate::strings::is_js_space;

#[derive(Debug, Clone)]
pub(super) enum Prop<'a> {
    Value(Cow<'a, HeadValue>),
    Class(Vec<&'a str>),
    Style(Vec<(&'a str, Cow<'a, str>)>),
}

impl Prop<'_> {
    pub(super) fn truthy(&self) -> bool {
        match self {
            Prop::Value(v) => v.truthy(),
            Prop::Class(_) | Prop::Style(_) => true,
        }
    }

    pub(super) fn js_str(&self) -> Cow<'_, str> {
        match self {
            Prop::Value(v) => v.js_str(),
            Prop::Class(_) => Cow::Borrowed("[object Set]"),
            Prop::Style(_) => Cow::Borrowed("[object Map]"),
        }
    }

    pub(super) fn as_str(&self) -> Option<&str> {
        match self {
            Prop::Value(v) => match &**v {
                HeadValue::Str(s) => Some(s),
                _ => None,
            },
            _ => None,
        }
    }

    pub(super) fn is_str(&self, s: &str) -> bool {
        self.as_str() == Some(s)
    }

    pub(super) fn is_value(&self, f: impl Fn(&HeadValue) -> bool) -> bool {
        matches!(self, Prop::Value(v) if f(v))
    }

    pub(super) fn has_content(&self) -> bool {
        match self {
            Prop::Value(v) => has_content(v),
            other => other.truthy(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct Props<'a>(pub(super) Vec<(Cow<'a, str>, Prop<'a>)>);

impl<'a> Props<'a> {
    pub(super) fn get(&self, key: &str) -> Option<&Prop<'a>> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub(super) fn truthy(&self, key: &str) -> bool {
        self.get(key).is_some_and(Prop::truthy)
    }

    pub(super) fn defined(&self, key: &str) -> Option<&Prop<'a>> {
        self.get(key)
            .filter(|p| !p.is_value(|v| matches!(v, HeadValue::Undefined)))
    }

    pub(super) fn set(&mut self, key: Cow<'a, str>, value: Prop<'a>) {
        if let Some(slot) = self.0.iter_mut().find(|(k, _)| *k == key) {
            slot.1 = value;
            return;
        }
        let at = js_key_place(self.0.iter().map(|(k, _)| &**k), &key);
        self.0.insert(at, (key, value));
    }

    pub(super) fn assign(&mut self, other: Props<'a>) {
        for (k, v) in other.0 {
            self.set(k, v);
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct Tag<'a> {
    pub(super) tag: &'a str,
    pub(super) props: Props<'a>,
    pub(super) text_content: Cow<'a, HeadValue>,
    pub(super) inner_html: Cow<'a, HeadValue>,
    pub(super) key: Cow<'a, HeadValue>,
    pub(super) tag_position: Cow<'a, HeadValue>,
    pub(super) tag_priority: Cow<'a, HeadValue>,
    pub(super) tag_duplicate_strategy: Cow<'a, HeadValue>,
    pub(super) weight: f64,
    pub(super) position: i64,
    pub(super) dedupe: Option<Cow<'a, str>>,
    pub(super) hash: Option<Key<'a>>,
}

impl<'a> Tag<'a> {
    pub(super) fn named(tag: &'a str) -> Tag<'a> {
        Tag {
            tag,
            ..Tag::default()
        }
    }
}

static UNIQUE_KEYS: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) enum Key<'a> {
    Str(Cow<'a, str>),
    Num(u64),
    Bool(bool),
    Unique(usize),
}

impl<'a> Key<'a> {
    pub(super) fn of(value: &Cow<'a, HeadValue>) -> Key<'a> {
        match **value {
            HeadValue::Str(_) => Key::Str(value_str(value)),
            HeadValue::Number(x) if x.is_nan() => Key::Num(f64::NAN.to_bits()),
            HeadValue::Number(x) => Key::Num((x + 0.0).to_bits()),
            HeadValue::Bool(b) => Key::Bool(b),
            _ => Key::Unique(UNIQUE_KEYS.fetch_add(1, AtomicOrdering::Relaxed)),
        }
    }
}

const SCANNED: usize = 16;

#[derive(Default)]
pub(super) struct Places<'a>(Option<HashMap<&'a str, usize>>);

impl<'a> Places<'a> {
    #[cfg(test)]
    pub(super) fn indexed(&self) -> Option<usize> {
        self.0.as_ref().map(HashMap::len)
    }

    fn of<T>(&mut self, items: &[T], key: impl Fn(&T) -> &'a str, k: &str) -> Option<usize> {
        if items.len() < SCANNED {
            return items.iter().position(|item| key(item) == k);
        }
        let places = self.0.get_or_insert_with(HashMap::new);
        for (i, item) in items.iter().enumerate().skip(places.len()) {
            places.entry(key(item)).or_insert(i);
        }
        places.get(k).copied()
    }
}

pub(super) fn add_class<'a>(classes: &mut Vec<&'a str>, places: &mut Places<'a>, c: &'a str) {
    if places.of(classes, |c| c, c).is_none() {
        classes.push(c);
    }
}

pub(super) fn add_style<'a>(
    styles: &mut Vec<(&'a str, Cow<'a, str>)>,
    places: &mut Places<'a>,
    k: &'a str,
    v: Cow<'a, str>,
) {
    match places.of(styles, |(k, _)| k, k) {
        Some(i) => styles[i].1 = v,
        None => styles.push((k, v)),
    }
}

pub(super) const SELF_CLOSING: [&str; 3] = ["meta", "link", "base"];
pub(super) const DUPEABLE: [&str; 4] = ["link", "style", "script", "noscript"];
pub(super) const INNER_CONTENT: [&str; 5] =
    ["title", "titleTemplate", "script", "style", "noscript"];
pub(super) const HAS_ELEMENT: [&str; 6] = ["base", "meta", "link", "style", "script", "noscript"];
pub(super) const VALID: [&str; 9] = [
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
pub(super) const UNIQUE: [&str; 6] = [
    "base",
    "title",
    "titleTemplate",
    "bodyAttrs",
    "htmlAttrs",
    "templateParams",
];
pub(super) const CONFIG_KEYS: [&str; 7] = [
    "key",
    "tagPosition",
    "tagPriority",
    "tagDuplicateStrategy",
    "innerHTML",
    "textContent",
    "processTemplateParams",
];
pub(super) const MERGED: [&str; 3] = ["templateParams", "htmlAttrs", "bodyAttrs"];
pub(super) const META_ARRAYABLE: [&str; 12] = [
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

pub(super) fn unsafe_key(key: &str) -> bool {
    matches!(key, "__proto__" | "constructor" | "prototype")
}

pub(super) fn invalid_attr_name(name: &str) -> bool {
    name.chars().any(|c| {
        is_js_space(c)
            || matches!(
                c,
                '"' | '\'' | '<' | '>' | '/' | '=' | '\u{0}'..='\u{1f}' | '\u{7f}'
            )
    })
}

fn value_str<'a>(value: &Cow<'a, HeadValue>) -> Cow<'a, str> {
    match value {
        Cow::Borrowed(v) => v.js_str(),
        Cow::Owned(v) => Cow::Owned(v.js_str().into_owned()),
    }
}

pub(super) fn joined(parts: &[&str]) -> String {
    let mut out = String::with_capacity(parts.iter().map(|p| p.len()).sum());
    for part in parts {
        out.push_str(part);
    }
    out
}

pub(super) fn has_content(value: &HeadValue) -> bool {
    match value {
        HeadValue::Number(x) => x.is_finite(),
        other => other.truthy(),
    }
}
