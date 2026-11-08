use std::borrow::Cow;

use super::HeadValue;
use super::tag::{
    INNER_CONTENT, Prop, Props, SELF_CLOSING, Tag, VALID, has_content, invalid_attr_name,
};

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

pub(super) fn sanitize(tags: &mut Vec<Tag<'_>>) {
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

pub(super) fn props_into(out: &mut String, props: &Props<'_>) {
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

pub(super) fn tag_into(out: &mut String, tag: &Tag<'_>) {
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
