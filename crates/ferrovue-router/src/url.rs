use std::borrow::Cow;
use std::collections::HashMap;

pub(crate) fn parse_query(search: &str) -> Vec<(String, Vec<Option<String>>)> {
    let mut query: Vec<(String, Vec<Option<String>>)> = Vec::new();
    if search.is_empty() {
        return query;
    }
    let mut at: HashMap<String, usize> = HashMap::new();
    for pair in search.split('&') {
        let pair = pair.replace('+', " ");
        let (key, value) = match pair.find('=') {
            Some(i) => (decode(&pair[..i]), Some(decode(&pair[i + 1..]))),
            None => (decode(&pair), None),
        };
        match at.get(&key) {
            Some(&i) => query[i].1.push(value),
            None => {
                at.insert(key.clone(), query.len());
                query.push((key, vec![value]));
            }
        }
    }
    query
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Part {
    Param,
    QueryValue,
    QueryKey,
    Hash,
}

pub(crate) fn encode_param(text: &str) -> String {
    encode_url(text, Part::Param)
}

pub(crate) fn encode_url(text: &str, part: Part) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        let uri = ferrovue_core::kept_by_encode_uri(c) || matches!(c, '|' | '[' | ']');
        let keep = match (part, c) {
            (Part::Param, '#' | '?' | '/') => false,
            (Part::QueryValue | Part::QueryKey, '+' | '#' | '&') => false,
            (Part::QueryKey, '=') => false,
            (Part::QueryValue | Part::QueryKey, ' ') => {
                out.push('+');
                continue;
            }
            (Part::QueryValue | Part::QueryKey, '`' | '{' | '}' | '^') => true,
            (Part::Hash, '{' | '}' | '^') => true,
            _ => uri,
        };
        if keep {
            out.push(c);
        } else {
            ferrovue_core::percent_encode_into(&mut out, c);
        }
    }
    out
}

pub(crate) fn parse_url(location: &str, current: &str) -> (String, String) {
    let (path, search, hash) = split_url(location, current);
    let full = format!("{path}{search}{hash}");
    (path.into_owned(), full)
}

pub(crate) fn split_url<'a>(
    location: &'a str,
    current: &'a str,
) -> (Cow<'a, str>, &'a str, &'a str) {
    let hash_pos = location.find('#');
    let search_pos = location
        .find('?')
        .filter(|&s| hash_pos.is_none_or(|h| s < h));
    let mut path: Option<&str> = None;
    let mut search = "";
    let mut hash = "";
    if let Some(s) = search_pos {
        path = Some(&location[..s]);
        let end = hash_pos.filter(|&h| h > 0).unwrap_or(location.len());
        search = &location[s..end];
    }
    if let Some(h) = hash_pos {
        path = Some(path.filter(|p| !p.is_empty()).unwrap_or(&location[..h]));
        hash = &location[h..];
    }
    (
        resolve_relative_path(path.unwrap_or(location), current),
        search,
        hash,
    )
}

pub(crate) fn resolve_relative_path<'a>(to: &'a str, from: &'a str) -> Cow<'a, str> {
    if to.starts_with('/') {
        return Cow::Borrowed(to);
    }
    if to.is_empty() {
        return Cow::Borrowed(from);
    }
    let from_segments: Vec<&str> = from.split('/').collect();
    let mut to_segments: Vec<&str> = to.split('/').collect();
    if matches!(to_segments.last(), Some(&("." | ".."))) {
        to_segments.push("");
    }
    let mut position = from_segments.len() - 1;
    let mut to_position = 0;
    #[cfg(test)]
    let mut turns = crate::tests::Turns::default();
    while to_position < to_segments.len() {
        #[cfg(test)]
        turns.next();
        match to_segments[to_position] {
            "." => {}
            ".." => {
                if position > 1 {
                    position -= 1;
                }
            }
            _ => break,
        }
        to_position += 1;
    }
    Cow::Owned(format!(
        "{}/{}",
        from_segments[..position].join("/"),
        to_segments[to_position..].join("/")
    ))
}

pub(crate) fn decodes_to(raw: &str, here: &str) -> bool {
    if !raw.contains('%') {
        return raw == here;
    }
    let bytes = raw.as_bytes();
    let mut want = here.bytes();
    let mut equal = true;
    let mut i = 0;
    while i < bytes.len() {
        let byte = if bytes[i] == b'%' {
            let hex = |b: u8| (b as char).to_digit(16);
            match (
                bytes.get(i + 1).and_then(|&b| hex(b)),
                bytes.get(i + 2).and_then(|&b| hex(b)),
            ) {
                (Some(hi), Some(lo)) => {
                    i += 3;
                    (hi * 16 + lo) as u8
                }
                _ => return raw == here,
            }
        } else {
            i += 1;
            bytes[i - 1]
        };
        equal = equal && want.next() == Some(byte);
    }
    if equal && want.next().is_none() {
        return true;
    }
    raw == here && decode(raw) == raw
}

pub(crate) fn decode(text: &str) -> String {
    if !text.contains('%') {
        return text.to_owned();
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = |b: u8| (b as char).to_digit(16);
            match (
                bytes.get(i + 1).and_then(|&b| hex(b)),
                bytes.get(i + 2).and_then(|&b| hex(b)),
            ) {
                (Some(hi), Some(lo)) => {
                    out.push((hi * 16 + lo) as u8);
                    i += 3;
                    continue;
                }
                _ => return text.to_owned(),
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_owned())
}
