#![no_main]

use ferrovue::attrs::Attr;
use ferrovue_fuzz::unescape;
use libfuzzer_sys::{arbitrary, fuzz_target};

const KEYS: [&str; 20] = [
    "class",
    "style",
    "id",
    "title",
    "hidden",
    "disabled",
    "className",
    "htmlFor",
    "acceptCharset",
    "onClick",
    "key",
    "ref",
    "^x",
    ".value",
    "data-x",
    "aria-label",
    "fooBar",
    "İd",
    "a b",
    "x>y",
];

const IDS: &str = " data-v-1";

#[derive(Debug, arbitrary::Arbitrary)]
enum Key {
    Known(u8),
    Any(String),
}

#[derive(Debug, arbitrary::Arbitrary)]
enum Leaf {
    Undefined,
    Str(String),
    Bool(bool),
    Int(i64),
    Float(f64),
    Names(String),
}

#[derive(Debug, arbitrary::Arbitrary)]
enum Value {
    Leaf(Leaf),
    Style(Vec<(String, Leaf)>),
    Styles(Vec<Leaf>),
}

#[derive(Debug, arbitrary::Arbitrary)]
struct Input {
    sources: Vec<Vec<(Key, Value)>>,
    ids_at: u8,
    css: String,
}

fn key(k: &Key) -> &str {
    match k {
        Key::Known(i) => KEYS[usize::from(*i) % KEYS.len()],
        Key::Any(s) => s,
    }
}

fn leaf(l: &Leaf) -> Attr<'_> {
    match l {
        Leaf::Undefined => Attr::Undefined,
        Leaf::Str(s) => Attr::str(s),
        Leaf::Bool(b) => Attr::Bool(*b),
        Leaf::Int(n) => Attr::Int(*n),
        Leaf::Float(x) => Attr::Float(*x),
        Leaf::Names(s) => Attr::Names(s.as_str().into()),
    }
}

fn attr(v: &Value) -> Attr<'_> {
    match v {
        Value::Leaf(l) => leaf(l),
        Value::Style(entries) => Attr::style(entries.iter().map(|(k, v)| (k.as_str(), leaf(v)))),
        Value::Styles(items) => Attr::styles(items.iter().map(leaf)),
    }
}

fn is_name_char(c: char) -> bool {
    !matches!(
        c,
        '\t' | '\n' | '\x0c' | '\r' | ' ' | '/' | '>' | '=' | '"' | '\''
    )
}

fn attributes(mut s: &str) -> Vec<(&str, Option<String>)> {
    let mut read = Vec::new();
    while !s.is_empty() {
        s = s
            .strip_prefix(' ')
            .unwrap_or_else(|| panic!("an attribute starts with a space: {s:?}"));
        let end = s.find(|c| !is_name_char(c)).unwrap_or(s.len());
        let (name, rest) = s.split_at(end);
        s = rest;
        if let Some(rest) = s.strip_prefix("=\"") {
            let end = rest
                .find('"')
                .unwrap_or_else(|| panic!("a value is closed: {rest:?}"));
            let value = unescape(&rest[..end])
                .unwrap_or_else(|at| panic!("a value is escaped: {:?} at {at}", &rest[..end]));
            read.push((name, Some(value)));
            s = &rest[end + 1..];
        } else {
            read.push((name, None));
        }
    }
    read
}

fuzz_target!(|input: Input| {
    let lists: Vec<Vec<(&str, Attr<'_>)>> = input
        .sources
        .iter()
        .map(|list| list.iter().map(|(k, v)| (key(k), attr(v))).collect())
        .collect();
    let sources: Vec<&[(&str, Attr<'_>)]> = lists.iter().map(Vec::as_slice).collect();

    let ids_at = usize::from(input.ids_at);
    let mut out = String::new();
    ferrovue::attrs::attrs_into(&mut out, &sources, ids_at, IDS);
    let mut without = String::new();
    ferrovue::attrs::attrs_into(&mut without, &sources, ids_at, "");
    assert!(
        out.match_indices(IDS)
            .any(|(i, _)| out[..i] == without[..i] && out[i + IDS.len()..] == without[i..]),
        "{out}"
    );
    assert!(
        attributes(&without).len() <= lists.iter().map(Vec::len).sum::<usize>(),
        "{out}"
    );
    attributes(&out);

    for list in &lists {
        let mut out = String::new();
        ferrovue::attrs::passed_attrs_into(&mut out, list, IDS);
        let read = attributes(&out);
        assert!(read.len() <= 1 + list.len(), "{out}");
        let mut without = String::new();
        ferrovue::attrs::passed_attrs_into(&mut without, list, "");
        assert_eq!(out.strip_suffix(IDS), Some(&*without));
    }

    let mut style = String::new();
    ferrovue::attrs::style_text_into(&mut style, &input.css);
    let mut out = String::from(" style=\"");
    out.push_str(&style);
    out.push('"');
    assert_eq!(attributes(&out).len(), 1, "{out}");
});
