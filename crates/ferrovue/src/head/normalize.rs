use std::borrow::Cow;

use super::tag::{
    CONFIG_KEYS, DUPEABLE, HAS_ELEMENT, Key, Prop, Tag, invalid_attr_name, unsafe_key,
};
use super::{HeadValue, SeoMeta};
use crate::strings::js_trim;

fn has_unsafe(value: &HeadValue) -> bool {
    match value {
        HeadValue::Array(items) => items.iter().any(has_unsafe),
        HeadValue::Object(entries) => entries.iter().any(|(k, v)| unsafe_key(k) || has_unsafe(v)),
        _ => false,
    }
}

pub(super) fn strip_unsafe(value: &HeadValue) -> Cow<'_, HeadValue> {
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

pub(super) fn entry_tags<'a>(input: &'a HeadValue, out: &mut Vec<Tag<'a>>) {
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

pub(super) fn seo_meta_tags<'a>(meta: &'a [SeoMeta], out: &mut Vec<Tag<'a>>) {
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
