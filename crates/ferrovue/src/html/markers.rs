pub(super) fn marker(text: &str, attr: &str) -> Option<(String, usize)> {
    let tag_len = text[1..].find(|c: char| !c.is_ascii_alphanumeric() && c != '-')? + 1;
    let tag = &text[1..tag_len];
    if tag.is_empty() || !tag.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }
    let after = text[tag_len..]
        .strip_prefix(' ')?
        .strip_prefix(attr)?
        .strip_prefix("=\"")?;
    let quote = after.find('"')?;
    let close = format!("></{tag}>");
    let tail = after[quote + 1..].strip_prefix(close.as_str())?;
    let value = &after[..quote];
    if value.contains('<') {
        return None;
    }
    Some((unescape(value), text.len() - tail.len()))
}

fn unescape(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", "\u{a0}")
        .replace("&amp;", "&")
}
