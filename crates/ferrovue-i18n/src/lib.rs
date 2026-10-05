//! vue-i18n's `t()`, for components that call `$t` or `useI18n().t`: part of
//! [ferrovue](https://docs.rs/ferrovue)'s runtime.
//!
//! # Example
//!
//! ```
//! # mod ferrovue { pub use ferrovue_i18n::I18n; pub use ferrovue_i18n as i18n; }
//! use ferrovue::i18n::{Args, Locale, Message, Part, Value};
//! use ferrovue::I18n;
//!
//! // What the compiler writes for `en.json`: `{ "greeting": "Hello {name}!" }`.
//! static LOCALES: &[Locale] = &[Locale {
//!     name: "en",
//!     messages: &[(
//!         "greeting",
//!         Message { cases: &[&[Part::Text("Hello "), Part::Named("name"), Part::Text("!")]] },
//!     )],
//! }];
//!
//! let i18n = I18n::new(LOCALES, "en", &[]);
//! let args = Args { named: &[("name", Value::Str("Ada"))], ..Args::default() };
//! assert_eq!(i18n.t("greeting", &args), "Hello Ada!");
//! ```
#![cfg_attr(docsrs, feature(doc_cfg))]
#![warn(
    missing_docs,
    missing_debug_implementations,
    rustdoc::missing_crate_level_docs
)]

use std::fmt::Write;

/// One piece of a compiled message.
#[derive(Debug)]
pub enum Part {
    /// Text written as it is.
    Text(&'static str),
    /// `{name}`: a named value.
    Named(&'static str),
    /// `{0}`: a value from the list.
    List(usize),
    /// `{'{'}`: a literal.
    Literal(&'static str),
    /// `@:key` or `@.modifier:key`: another message of the same locale.
    Linked {
        /// The message linked to.
        key: &'static str,
        /// `upper`, `lower` or `capitalize`, if given.
        modifier: Option<&'static str>,
    },
}

/// A compiled message: one case, or the cases of a plural message (`one | many`).
#[derive(Debug)]
pub struct Message {
    /// The cases; a message without `|` has one.
    pub cases: &'static [&'static [Part]],
}

/// A locale's messages, by key (nested keys joined with dots), sorted for lookup.
///
/// The messages must be sorted by key, byte by byte.
#[derive(Debug)]
pub struct Locale {
    /// The locale's name: its file's name, `en` for `en.json`.
    pub name: &'static str,
    /// `(key, message)`, sorted by key.
    pub messages: &'static [(&'static str, Message)],
}

impl Locale {
    fn get(&'static self, key: &str) -> Option<&'static Message> {
        self.messages
            .binary_search_by(|(k, _)| (*k).cmp(key))
            .ok()
            .map(|i| &self.messages[i].1)
    }
}

/// A value interpolated into a message, written as `toDisplayString` writes it.
///
/// `count` and `n` take the plural number when they are not given, or are given a falsy value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Value<'a> {
    /// A string, as it is.
    Str(&'a str),
    /// An integer, as JavaScript writes a number.
    Int(i64),
    /// A fraction, as JavaScript writes a number.
    Float(f64),
    /// `true` or `false`.
    Bool(bool),
}

impl Value<'_> {
    fn write(&self, out: &mut String) {
        match self {
            Value::Str(s) => out.push_str(s),
            Value::Int(n) => ferrovue_core::push_int(out, *n),
            Value::Float(x) => ferrovue_core::push_number(out, *x),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        }
    }

    fn truthy(&self) -> bool {
        match self {
            Value::Str(s) => !s.is_empty(),
            Value::Int(n) => *n != 0,
            Value::Float(x) => *x != 0.0 && !x.is_nan(),
            Value::Bool(b) => *b,
        }
    }
}

/// What a `t()` call is given besides its key: `t(key, { named })`, `t(key, [list])`,
/// `t(key, plural)`, or a named object and a plural together.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_i18n::I18n; pub use ferrovue_i18n as i18n; }
/// use ferrovue::i18n::{Args, Value};
///
/// // t("greeting", { name: "Ada" }, 3)
/// let args = Args { named: &[("name", Value::Str("Ada"))], list: &[], plural: Some(3) };
/// assert_eq!(args.plural, Some(3));
/// ```
#[derive(Clone, Copy, Debug, Default)]
pub struct Args<'a> {
    /// `{ name: value }`.
    pub named: &'a [(&'a str, Value<'a>)],
    /// `[value, …]`.
    pub list: &'a [Value<'a>],
    /// The number that chooses a plural case.
    pub plural: Option<i64>,
}

/// The messages and the locale one request renders in.
#[derive(Clone, Debug)]
pub struct I18n {
    locales: &'static [Locale],
    chain: Vec<usize>,
    locale: String,
}

const MAX_LINK_DEPTH: usize = 32;

impl I18n {
    /// Translate in `locale`, falling back to `fallback` in order. A locale with no messages of its
    /// own is still the current one: every key then falls back. Names that match no locale in
    /// `locales` are skipped.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_i18n::I18n; pub use ferrovue_i18n as i18n; }
    /// use ferrovue::i18n::{Args, Locale, Message, Part};
    /// use ferrovue::I18n;
    ///
    /// static LOCALES: &[Locale] = &[
    ///     Locale { name: "en", messages: &[("hi", Message { cases: &[&[Part::Text("hi")]] })] },
    ///     Locale { name: "nl", messages: &[] },
    /// ];
    ///
    /// // A Belgian reader: no `nl-BE` messages, so Dutch, then English.
    /// let i18n = I18n::new(LOCALES, "nl-BE", &["nl", "en"]);
    /// assert_eq!(i18n.locale(), "nl-BE");
    /// assert_eq!(i18n.t("hi", &Args::default()), "hi");
    /// ```
    pub fn new(locales: &'static [Locale], locale: &str, fallback: &[&str]) -> I18n {
        let index = |name: &str| locales.iter().position(|l| l.name == name);
        let mut chain: Vec<usize> = Vec::new();
        for name in std::iter::once(locale).chain(fallback.iter().copied()) {
            if let Some(i) = index(name)
                && !chain.contains(&i)
            {
                chain.push(i);
            }
        }
        I18n {
            locales,
            chain,
            locale: locale.to_owned(),
        }
    }

    /// The current locale, as `useI18n().locale` reads it.
    pub fn locale(&self) -> &str {
        &self.locale
    }

    /// `t(key, …)`: the message in the first locale of the chain that has it, evaluated with these
    /// arguments, or the key itself when none does, as vue-i18n returns it.
    ///
    /// The result is the message's text, unescaped.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_i18n::I18n; pub use ferrovue_i18n as i18n; }
    /// use ferrovue::i18n::{Args, Locale, Message, Part, Value};
    /// use ferrovue::I18n;
    ///
    /// // `{ "apples": "no apples | one apple | {count} apples", "app": "ferrovue",
    /// //    "about": "@.upper:app and {0}" }`
    /// static LOCALES: &[Locale] = &[Locale {
    ///     name: "en",
    ///     messages: &[
    ///         ("about", Message { cases: &[&[
    ///             Part::Linked { key: "app", modifier: Some("upper") },
    ///             Part::Text(" and "),
    ///             Part::List(0),
    ///         ]] }),
    ///         ("app", Message { cases: &[&[Part::Text("ferrovue")]] }),
    ///         ("apples", Message { cases: &[
    ///             &[Part::Text("no apples")],
    ///             &[Part::Text("one apple")],
    ///             &[Part::Named("count"), Part::Text(" apples")],
    ///         ] }),
    ///     ],
    /// }];
    /// let i18n = I18n::new(LOCALES, "en", &[]);
    ///
    /// // t("apples", 0), t("apples", 1), t("apples", 5)
    /// let plural = |n| i18n.t("apples", &Args { plural: Some(n), ..Args::default() });
    /// assert_eq!([plural(0), plural(1), plural(5)], ["no apples", "one apple", "5 apples"]);
    ///
    /// // t("about", ["Rust"])
    /// let args = Args { list: &[Value::Str("Rust")], ..Args::default() };
    /// assert_eq!(i18n.t("about", &args), "FERROVUE and Rust");
    ///
    /// // A key no locale has is written as itself.
    /// assert_eq!(i18n.t("no.such.key", &Args::default()), "no.such.key");
    /// ```
    pub fn t(&self, key: &str, args: &Args<'_>) -> String {
        match self.find(key) {
            Some((_, message)) => {
                let mut out = String::new();
                self.evaluate(message, args, &mut out, 0);
                out
            }
            None => key.to_owned(),
        }
    }

    fn find(&self, key: &str) -> Option<(&'static Locale, &'static Message)> {
        self.chain.iter().find_map(|&i| {
            let locale = &self.locales[i];
            locale.get(key).map(|m| (locale, m))
        })
    }

    fn evaluate(&self, message: &Message, args: &Args<'_>, out: &mut String, depth: usize) {
        let case = match message.cases {
            [] => return,
            [only] => *only,
            cases => {
                let index = plural_index(plural_choice(args), cases.len());
                debug_assert!(
                    index.is_some(),
                    "a plural number of {} chooses none of the cases",
                    plural_choice(args)
                );
                match index.and_then(|i| cases.get(i)) {
                    Some(case) => *case,
                    None => return,
                }
            }
        };
        for part in case {
            match part {
                Part::Text(text) | Part::Literal(text) => out.push_str(text),
                Part::Named(name) => {
                    if let Some(value) = named(args, name) {
                        value.write(out);
                    }
                }
                Part::List(index) => {
                    if let Some(value) = args.list.get(*index) {
                        value.write(out);
                    }
                }
                Part::Linked { key, modifier } => {
                    let mut linked = String::new();
                    if depth < MAX_LINK_DEPTH
                        && let Some((_, m)) = self.find(key)
                    {
                        self.evaluate(m, args, &mut linked, depth + 1);
                    }
                    if linked.is_empty() {
                        linked.push_str(key);
                    }
                    match *modifier {
                        Some("upper") => out.push_str(&linked.to_uppercase()),
                        Some("lower") => out.push_str(&linked.to_lowercase()),
                        Some("capitalize") => {
                            let mut chars = linked.chars();
                            if let Some(first) = chars.next() {
                                let _ = write!(out, "{}{}", first.to_uppercase(), chars.as_str());
                            }
                        }
                        _ => out.push_str(&linked),
                    }
                }
            }
        }
    }
}

fn named<'a>(args: &Args<'a>, name: &str) -> Option<Value<'a>> {
    let given = args.named.iter().find(|(k, _)| *k == name).map(|(_, v)| *v);
    match (name, args.plural) {
        ("count" | "n", Some(n)) if !given.is_some_and(|v| v.truthy()) => Some(Value::Int(n)),
        _ => given,
    }
}

fn plural_choice(args: &Args<'_>) -> f64 {
    for name in ["count", "n"] {
        match args.named.iter().find(|(k, _)| *k == name).map(|(_, v)| *v) {
            Some(Value::Int(n)) => return n as f64,
            Some(Value::Float(x)) if x.is_finite() => return x,
            _ => {}
        }
    }
    args.plural.map_or(-1.0, |n| n as f64)
}

fn plural_index(choice: f64, cases: usize) -> Option<usize> {
    let choice = choice.abs();
    if cases == 2 {
        Some(usize::from(choice != 1.0))
    } else {
        let index = choice.min(2.0);
        (index.fract() == 0.0).then_some(index as usize)
    }
}

#[cfg(test)]
mod tests;
