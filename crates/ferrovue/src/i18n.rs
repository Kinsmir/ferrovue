//! vue-i18n's `t()`, for components that call `$t` or `useI18n().t`.
//!
//! The compiler parses every message with vue-i18n's own message compiler and writes the result as
//! static tables of [`Part`]s, one [`Locale`] per locale file. At run time [`I18n::t`] evaluates a
//! message the way vue-i18n's message context does: named and list interpolation, literals, linked
//! messages with their modifiers, plural cases chosen by vue-i18n's default rule, and the fallback
//! locales — and, when nothing has the key, the key itself.
//!
//! The locale is chosen per request: build an [`I18n`] for it and pass it to the components that
//! translate, as the route is passed.

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

/// A locale's messages, by key — nested keys joined with dots — sorted for lookup.
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
            Value::Int(n) => crate::push_int(out, *n),
            Value::Float(x) => crate::push_number(out, *x),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        }
    }

    /// JavaScript's truthiness, which decides whether `count` and `n` take the plural number.
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
    /// The locale, then its fallbacks, as indices into `locales`.
    chain: Vec<usize>,
    locale: String,
}

/// How deep linked messages may nest before a cycle is assumed.
const MAX_LINK_DEPTH: usize = 32;

impl I18n {
    /// Translate in `locale`, falling back to `fallback` in order. A locale with no messages of its
    /// own is still the current one: every key then falls back.
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
    /// arguments — or the key itself when none does, as vue-i18n returns it.
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

    /// The message for a key in the first locale of the chain that has it.
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
            cases => match cases.get(plural_index(plural_choice(args), cases.len())) {
                Some(case) => *case,
                None => return,
            },
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
                    // Resolved as a message is, through the fallbacks; an unresolved link, or one
                    // nested too deep, is written as its key.
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

/// A named value, with `count` and `n` taking the plural number when they are not given, or falsy.
fn named<'a>(args: &Args<'a>, name: &str) -> Option<Value<'a>> {
    let given = args.named.iter().find(|(k, _)| *k == name).map(|(_, v)| *v);
    match (name, args.plural) {
        ("count" | "n", Some(n)) if !given.is_some_and(|v| v.truthy()) => Some(Value::Int(n)),
        _ => given,
    }
}

/// `getPluralIndex`: a numeric `count`, else a numeric `n`, else the plural number, else −1 — read
/// from the values as given, before `count` and `n` take the plural number.
fn plural_choice(args: &Args<'_>) -> i64 {
    for name in ["count", "n"] {
        match args.named.iter().find(|(k, _)| *k == name).map(|(_, v)| *v) {
            Some(Value::Int(n)) => return n,
            Some(Value::Float(x)) => return x as i64,
            _ => {}
        }
    }
    args.plural.unwrap_or(-1)
}

/// `pluralDefault`: with two cases, singular for exactly one and plural otherwise; with more,
/// zero, singular, then plural.
fn plural_index(choice: i64, cases: usize) -> usize {
    let choice = choice.unsigned_abs();
    if cases == 2 {
        usize::from(choice != 1)
    } else {
        choice.min(2) as usize
    }
}
