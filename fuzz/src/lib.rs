//! Values and references the fuzz targets share.

use std::fmt::Write as _;

use libfuzzer_sys::arbitrary::{self, Arbitrary};
use serde::ser::{
    SerializeMap, SerializeSeq, SerializeStruct, SerializeStructVariant, SerializeTuple,
    SerializeTupleStruct, SerializeTupleVariant,
};
use serde::{Serialize, Serializer};

const NAMES: [&str; 4] = ["a", "b", "<c>", "d\"&'"];

/// Every shape of value serde hands a serializer, with floats that may not be finite.
#[derive(Debug, Arbitrary)]
pub enum Value {
    /// `()`.
    Unit,
    /// A bool.
    Bool(bool),
    /// An `i64`.
    Int(i64),
    /// A `u8`.
    Byte(u8),
    /// An `f64`.
    Float(f64),
    /// An `f32`.
    Single(f32),
    /// A `char`.
    Char(char),
    /// A string.
    Str(String),
    /// Bytes, written as a list of numbers.
    Bytes(Vec<u8>),
    /// An `Option`.
    Opt(Option<Box<Value>>),
    /// A list.
    List(Vec<Value>),
    /// A tuple.
    Tuple(Vec<Value>),
    /// A tuple struct.
    TupleStruct(Vec<Value>),
    /// A map with string keys, which may repeat.
    Map(Vec<(String, Value)>),
    /// A struct whose field names are taken from a fixed list, and may repeat.
    Struct(Vec<(u8, Value)>),
    /// A newtype struct.
    Newtype(Box<Value>),
    /// A unit variant.
    UnitVariant(u8),
    /// A newtype variant.
    NewtypeVariant(u8, Box<Value>),
    /// A tuple variant.
    TupleVariant(u8, Vec<Value>),
    /// A struct variant.
    StructVariant(u8, Vec<(u8, Value)>),
}

fn name(i: u8) -> &'static str {
    NAMES[usize::from(i) % NAMES.len()]
}

impl Value {
    /// How deeply the value nests.
    #[must_use]
    pub fn depth(&self) -> usize {
        let max =
            |items: &mut dyn Iterator<Item = &Value>| items.map(Value::depth).max().unwrap_or(0);
        1 + match self {
            Value::Opt(Some(v)) | Value::Newtype(v) | Value::NewtypeVariant(_, v) => v.depth(),
            Value::List(items)
            | Value::Tuple(items)
            | Value::TupleStruct(items)
            | Value::TupleVariant(_, items) => max(&mut items.iter()),
            Value::Map(entries) => max(&mut entries.iter().map(|(_, v)| v)),
            Value::Struct(fields) | Value::StructVariant(_, fields) => {
                max(&mut fields.iter().map(|(_, v)| v))
            }
            _ => 0,
        }
    }

    /// Whether serde_json reads the value's JSON back as the value: no float that is not finite,
    /// and no `f32`, which serde_json reads back as the nearest `f64`.
    #[must_use]
    pub fn reads_back(&self) -> bool {
        match self {
            Value::Float(x) => x.is_finite(),
            Value::Single(_) => false,
            Value::Opt(Some(v)) | Value::Newtype(v) | Value::NewtypeVariant(_, v) => v.reads_back(),
            Value::List(items)
            | Value::Tuple(items)
            | Value::TupleStruct(items)
            | Value::TupleVariant(_, items) => items.iter().all(Value::reads_back),
            Value::Map(entries) => entries.iter().all(|(_, v)| v.reads_back()),
            Value::Struct(fields) | Value::StructVariant(_, fields) => {
                fields.iter().all(|(_, v)| v.reads_back())
            }
            _ => true,
        }
    }

    /// The value as JavaScript's `JSON.stringify` would write it if `NaN` and the infinities were
    /// written as themselves, built without the code under test.
    #[must_use]
    pub fn reference_json(&self) -> String {
        let mut out = String::new();
        self.write_reference(&mut out);
        out
    }

    fn write_reference(&self, out: &mut String) {
        let list = |out: &mut String, items: &[Value]| {
            out.push('[');
            for (i, v) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                v.write_reference(out);
            }
            out.push(']');
        };
        let object = |out: &mut String, entries: &mut dyn Iterator<Item = (&str, &Value)>| {
            out.push('{');
            for (i, (k, v)) in entries.enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&string(k));
                out.push(':');
                v.write_reference(out);
            }
            out.push('}');
        };
        match self {
            Value::Unit | Value::Opt(None) => out.push_str("null"),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Value::Int(n) => write!(out, "{n}").unwrap_or_default(),
            Value::Byte(n) => write!(out, "{n}").unwrap_or_default(),
            Value::Float(x) => out.push_str(&float(*x, || serde_json::to_string(x))),
            Value::Single(x) => {
                out.push_str(&float(f64::from(*x), || serde_json::to_string(x)));
            }
            Value::Char(c) => out.push_str(&string(&c.to_string())),
            Value::Str(s) => out.push_str(&string(s)),
            Value::Bytes(b) => {
                out.push('[');
                for (i, n) in b.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write!(out, "{n}").unwrap_or_default();
                }
                out.push(']');
            }
            Value::Opt(Some(v)) | Value::Newtype(v) => v.write_reference(out),
            Value::List(items) | Value::Tuple(items) | Value::TupleStruct(items) => {
                list(out, items);
            }
            Value::Map(entries) => object(out, &mut entries.iter().map(|(k, v)| (k.as_str(), v))),
            Value::Struct(fields) => object(out, &mut fields.iter().map(|(k, v)| (name(*k), v))),
            Value::UnitVariant(i) => out.push_str(&string(name(*i))),
            Value::NewtypeVariant(i, v) => {
                out.push('{');
                out.push_str(&string(name(*i)));
                out.push(':');
                v.write_reference(out);
                out.push('}');
            }
            Value::TupleVariant(i, items) => {
                out.push('{');
                out.push_str(&string(name(*i)));
                out.push(':');
                list(out, items);
                out.push('}');
            }
            Value::StructVariant(i, fields) => {
                out.push('{');
                out.push_str(&string(name(*i)));
                out.push(':');
                object(out, &mut fields.iter().map(|(k, v)| (name(*k), v)));
                out.push('}');
            }
        }
    }
}

fn float(x: f64, finite: impl FnOnce() -> serde_json::Result<String>) -> String {
    if x.is_nan() {
        "NaN".to_owned()
    } else if x == f64::INFINITY {
        "Infinity".to_owned()
    } else if x == f64::NEG_INFINITY {
        "-Infinity".to_owned()
    } else {
        finite().unwrap_or_default()
    }
}

fn string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if c < ' ' => write!(out, "\\u{:04x}", u32::from(c)).unwrap_or_default(),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

impl Serialize for Value {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Value::Unit => s.serialize_unit(),
            Value::Bool(b) => s.serialize_bool(*b),
            Value::Int(n) => s.serialize_i64(*n),
            Value::Byte(n) => s.serialize_u8(*n),
            Value::Float(x) => s.serialize_f64(*x),
            Value::Single(x) => s.serialize_f32(*x),
            Value::Char(c) => s.serialize_char(*c),
            Value::Str(v) => s.serialize_str(v),
            Value::Bytes(b) => s.serialize_bytes(b),
            Value::Opt(None) => s.serialize_none(),
            Value::Opt(Some(v)) => s.serialize_some(v),
            Value::List(items) => {
                let mut seq = s.serialize_seq(Some(items.len()))?;
                for v in items {
                    seq.serialize_element(v)?;
                }
                seq.end()
            }
            Value::Tuple(items) => {
                let mut tuple = s.serialize_tuple(items.len())?;
                for v in items {
                    tuple.serialize_element(v)?;
                }
                tuple.end()
            }
            Value::TupleStruct(items) => {
                let mut tuple = s.serialize_tuple_struct("T", items.len())?;
                for v in items {
                    tuple.serialize_field(v)?;
                }
                tuple.end()
            }
            Value::Map(entries) => {
                let mut map = s.serialize_map(Some(entries.len()))?;
                for (k, v) in entries {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
            Value::Struct(fields) => {
                let mut st = s.serialize_struct("S", fields.len())?;
                for (k, v) in fields {
                    st.serialize_field(name(*k), v)?;
                }
                st.end()
            }
            Value::Newtype(v) => s.serialize_newtype_struct("N", v),
            Value::UnitVariant(i) => s.serialize_unit_variant("E", u32::from(*i), name(*i)),
            Value::NewtypeVariant(i, v) => {
                s.serialize_newtype_variant("E", u32::from(*i), name(*i), v)
            }
            Value::TupleVariant(i, items) => {
                let mut tuple =
                    s.serialize_tuple_variant("E", u32::from(*i), name(*i), items.len())?;
                for v in items {
                    tuple.serialize_field(v)?;
                }
                tuple.end()
            }
            Value::StructVariant(i, fields) => {
                let mut st =
                    s.serialize_struct_variant("E", u32::from(*i), name(*i), fields.len())?;
                for (k, v) in fields {
                    st.serialize_field(name(*k), v)?;
                }
                st.end()
            }
        }
    }
}

/// `escapeHtml` as `@vue/shared` writes it, one character at a time.
#[must_use]
pub fn reference_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("&quot;"),
            '&' => out.push_str("&amp;"),
            '\'' => out.push_str("&#39;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
    out
}

const ENTITIES: [(&str, char); 5] = [
    ("&quot;", '"'),
    ("&amp;", '&'),
    ("&#39;", '\''),
    ("&lt;", '<'),
    ("&gt;", '>'),
];

/// Reads escaped text back, failing on a raw `"`, `'`, `<` or `>`, and on an `&` that starts none
/// of the five entities `escapeHtml` writes.
///
/// # Errors
///
/// The offset of the first character that escaped text cannot hold.
pub fn unescape(s: &str) -> Result<String, usize> {
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while let Some(c) = s[i..].chars().next() {
        match c {
            '"' | '\'' | '<' | '>' => return Err(i),
            '&' => {
                let (entity, c) = ENTITIES
                    .iter()
                    .find(|(e, _)| s[i..].starts_with(e))
                    .ok_or(i)?;
                out.push(*c);
                i += entity.len();
            }
            c => {
                out.push(c);
                i += c.len_utf8();
            }
        }
    }
    Ok(out)
}
