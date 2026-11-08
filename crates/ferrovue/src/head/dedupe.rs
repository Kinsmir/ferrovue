use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::HashMap;

use super::HeadValue;
use super::tag::{INNER_CONTENT, Key, MERGED, META_ARRAYABLE, Prop, Tag, UNIQUE, joined};
use crate::strings::{js_cmp, js_replace};

pub(super) fn capo_weight(tag: &Tag<'_>) -> f64 {
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

pub(super) fn dedupe_key<'a>(tag: &Tag<'a>) -> Option<Cow<'a, str>> {
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

pub(super) fn hash_tag<'a>(tag: &Tag<'a>) -> Key<'a> {
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

pub(super) fn order(a: &Tag<'_>, b: &Tag<'_>) -> Ordering {
    if a.weight == b.weight {
        a.position.cmp(&b.position)
    } else {
        a.weight.partial_cmp(&b.weight).unwrap_or(Ordering::Equal)
    }
}

#[derive(Default)]
pub(super) struct TagMap<'a> {
    pub(super) slots: Vec<Vec<Tag<'a>>>,
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

pub(super) fn dedupe(mut tags: Vec<Tag<'_>>) -> (TagMap<'_>, bool) {
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

pub(super) fn title_template(map: &mut TagMap<'_>) {
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
