use serde::de::{self, Deserialize, Deserializer, MapAccess, Visitor};
use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};
use std::borrow::Cow;
use std::fmt;
use std::marker::PhantomData;

pub(crate) fn array_index(name: &str) -> Option<u32> {
    let n: u32 = name.parse().ok()?;
    (n < u32::MAX && n.to_string() == name).then_some(n)
}

/// A `Record<string, T>` (or `{ [key: string]: T }`) prop: entries in the order JavaScript gives an
/// object's keys, which is what `v-for` and `Object.keys` walk. Keys that are array indices (`"0"`,
/// `"12"`) come first, in numeric order, then the others in the order they were added; a key given
/// twice keeps its first place and its last value, as `JSON.parse` keeps it.
///
/// # Example
///
/// ```
/// use ferrovue::props::Record;
///
/// let scores: Record<'_, i64> = [("b", 1), ("10", 2), ("a", 3), ("2", 4), ("b", 5)].into_iter().collect();
/// let keys: Vec<&str> = scores.keys().collect();
/// assert_eq!(keys, ["2", "10", "b", "a"]);
/// assert_eq!(scores.get("b"), Some(&5));
/// assert_eq!(serde_json::to_string(&scores).unwrap(), r#"{"2":4,"10":2,"b":5,"a":3}"#);
/// ```
#[derive(Debug, Clone, PartialEq)]
pub struct Record<'a, V> {
    entries: Vec<(Cow<'a, str>, V)>,
}

impl<V> Default for Record<'_, V> {
    fn default() -> Self {
        Record {
            entries: Vec::new(),
        }
    }
}

impl<'a, V> Record<'a, V> {
    /// An empty record.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The number of entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether there are no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Each key and its value, in JavaScript's order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &V)> {
        self.entries.iter().map(|(k, v)| (&**k, v))
    }

    /// The keys, in JavaScript's order: `Object.keys`.
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(k, _)| &**k)
    }

    /// The values, in JavaScript's order: `Object.values`.
    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.entries.iter().map(|(_, v)| v)
    }

    /// The value of `key`, if there is one.
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&V> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
}

impl<'a, K: Into<Cow<'a, str>>, V> FromIterator<(K, V)> for Record<'a, V> {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Self {
        let mut entries: Vec<(Cow<'a, str>, V)> = Vec::new();
        for (k, v) in iter {
            let k = k.into();
            match entries.iter_mut().find(|(e, _)| *e == k) {
                Some(entry) => entry.1 = v,
                None => entries.push((k, v)),
            }
        }
        entries.sort_by_key(|(k, _)| array_index(k).map_or((1, 0), |i| (0, i)));
        Record { entries }
    }
}

impl<V: Serialize> Serialize for Record<'_, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.entries.len()))?;
        for (k, v) in &self.entries {
            map.serialize_entry(&**k, v)?;
        }
        map.end()
    }
}

impl<'de, V: Deserialize<'de>> Deserialize<'de> for Record<'_, V> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Entries<V>(PhantomData<V>);

        impl<'de, V: Deserialize<'de>> Visitor<'de> for Entries<V> {
            type Value = Vec<(String, V)>;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("an object")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut entries = Vec::with_capacity(map.size_hint().unwrap_or(0));
                while let Some(entry) = map.next_entry()? {
                    entries.push(entry);
                }
                Ok(entries)
            }
        }

        Ok(deserializer
            .deserialize_map(Entries(PhantomData))?
            .into_iter()
            .collect())
    }
}

impl<'a, V> Record<'a, V> {
    pub(crate) fn from_entries(entries: Vec<(Cow<'a, str>, V)>) -> Self {
        Record { entries }
    }

    pub(crate) fn into_entries(self) -> Vec<(Cow<'a, str>, V)> {
        self.entries
    }
}

/// A Rust enum that a union of string literals is: the enum ferrovue generates for one, or an
/// application's own enum that `unions` in `ferrovue.config.json` names for the union's `type`
/// alias.
///
/// Generated code renders a value as the literal [`as_str`](Union::as_str) gives, writes it into
/// `data-props` as that literal, and reads a fixture's literal back as the value of
/// [`ALL`](Union::ALL) that gives it. Each variant is named as the variant ferrovue would generate
/// for its literal (`"x-dark"` is `XDark`), so that the generated `match`es and comparisons name
/// them: a variant missing from the enum, or one the union lacks, stops the build at the generated
/// module.
///
/// # Example
///
/// ```
/// use ferrovue::props::Union;
///
/// // `export type Tone = "warm" | "cool" | "x-dark";` in a `.ts` file, and
/// // `"unions": { "Tone": "crate::Tone" }` in ferrovue.config.json.
/// #[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// pub enum Tone {
///     Warm,
///     Cool,
///     XDark,
/// }
///
/// impl Union for Tone {
///     const ALL: &'static [Self] = &[Tone::Warm, Tone::Cool, Tone::XDark];
///
///     fn as_str(self) -> &'static str {
///         match self {
///             Tone::Warm => "warm",
///             Tone::Cool => "cool",
///             Tone::XDark => "x-dark",
///         }
///     }
/// }
///
/// assert_eq!(Tone::XDark.as_str(), "x-dark");
/// assert_eq!(Tone::ALL.len(), 3);
/// ```
pub trait Union: Copy + PartialEq + fmt::Debug + 'static {
    /// Every value, each once.
    const ALL: &'static [Self];

    /// The string literal the value stands for.
    #[must_use]
    fn as_str(self) -> &'static str;
}

struct Literal<T>(T);

impl<'de, T: Union> Deserialize<'de> for Literal<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = Cow::<'de, str>::deserialize(deserializer)?;
        T::ALL
            .iter()
            .copied()
            .find(|v| v.as_str() == s)
            .map(Literal)
            .ok_or_else(|| {
                let members: Vec<String> =
                    T::ALL.iter().map(|v| format!("`{}`", v.as_str())).collect();
                de::Error::custom(format_args!(
                    "`{s}` is not one of the members of the union: {}",
                    members.join(", ")
                ))
            })
    }
}

/// A value holding values of a [`Union`], alone, optional or in a list, written and read as their
/// literals.
#[doc(hidden)]
pub trait UnionShape: Sized {
    /// Write the value with each union value as its literal.
    ///
    /// # Errors
    ///
    /// What the serializer refuses.
    fn serialize_literals<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error>;

    /// Read the value with each union value from its literal.
    ///
    /// # Errors
    ///
    /// A string that is none of the union's literals.
    fn deserialize_literals<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error>;
}

struct Shaped<'a, T>(&'a T);

impl<T: UnionShape> Serialize for Shaped<'_, T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize_literals(serializer)
    }
}

struct Owned<T>(T);

impl<'de, T: UnionShape> Deserialize<'de> for Owned<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize_literals(deserializer).map(Owned)
    }
}

impl<T: Union> UnionShape for T {
    fn serialize_literals<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }

    fn deserialize_literals<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Literal::<T>::deserialize(deserializer).map(|l| l.0)
    }
}

impl<T: UnionShape> UnionShape for Option<T> {
    fn serialize_literals<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Some(v) => serializer.serialize_some(&Shaped(v)),
            None => serializer.serialize_none(),
        }
    }

    fn deserialize_literals<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Option::<Owned<T>>::deserialize(deserializer).map(|o| o.map(|v| v.0))
    }
}

impl<T: UnionShape> UnionShape for Vec<T> {
    fn serialize_literals<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.len()))?;
        for v in self {
            seq.serialize_element(&Shaped(v))?;
        }
        seq.end()
    }

    fn deserialize_literals<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Vec::<Owned<T>>::deserialize(deserializer).map(|vs| vs.into_iter().map(|v| v.0).collect())
    }
}

/// How a field holding an application's own [`Union`], alone, optional or in a list, is written
/// into an island's `data-props` and read back from a fixture: each value as its literal.
#[doc(hidden)]
pub mod union_prop {
    use serde::{Deserializer, Serializer};

    use super::UnionShape;

    /// The value with each union value as its literal.
    ///
    /// # Errors
    ///
    /// What the serializer refuses.
    pub fn serialize<T: UnionShape, S: Serializer>(
        value: &T,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.serialize_literals(serializer)
    }

    /// The value with each union value read from its literal.
    ///
    /// # Errors
    ///
    /// A string that is none of the union's literals.
    pub fn deserialize<'de, T: UnionShape, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<T, D::Error> {
        T::deserialize_literals(deserializer)
    }
}

/// A string read as a value of an enum `unions` names, as `str::parse` reads one of a generated
/// enum.
#[doc(hidden)]
pub trait ParseUnion {
    /// The value of `T`, the enum for the union `union` of the literals `members`, whose literal
    /// is the string.
    ///
    /// # Errors
    ///
    /// A string that is none of the literals.
    fn parse_union<T: Union>(
        &self,
        union: &'static str,
        members: &'static [&'static str],
    ) -> Result<T, ParseUnionError>;
}

impl ParseUnion for str {
    fn parse_union<T: Union>(
        &self,
        union: &'static str,
        members: &'static [&'static str],
    ) -> Result<T, ParseUnionError> {
        T::ALL
            .iter()
            .copied()
            .find(|v| v.as_str() == self)
            .ok_or_else(|| ParseUnionError::new(union, self, members))
    }
}

/// Check that `T`, the enum `unions` names for the union `union`, gives each value the literal
/// `members` pairs it with, and that [`Union::ALL`] holds each value once: the test generated
/// code writes for each such enum.
///
/// # Panics
///
/// When a value's literal is another, or `ALL` leaves a value out or holds one twice.
#[doc(hidden)]
#[track_caller]
pub fn check_union<T: Union>(union: &str, members: &[(T, &str)]) {
    for &(v, literal) in members {
        assert!(
            v.as_str() == literal,
            "`{union}` gives `{v:?}` the literal `{}`, and the union's member is `{literal}`: return `{literal}` from `as_str` for it",
            v.as_str()
        );
        let held = T::ALL.iter().filter(|w| **w == v).count();
        assert!(
            held == 1,
            "`{union}::ALL` holds `{v:?}` {held} times: list each value once"
        );
    }
    assert!(
        T::ALL.len() == members.len(),
        "`{union}::ALL` holds {} values, and the union has {} members: list each value once",
        T::ALL.len(),
        members.len()
    );
}

/// The error of parsing a string as the enum generated for a union of string literals, when the
/// string is none of its members.
///
/// The generated enums' `FromStr` and `TryFrom<&str>` return it:
///
/// ```
/// # #[derive(Debug, PartialEq)]
/// # enum Size { Sm, Md }
/// # impl std::str::FromStr for Size {
/// #     type Err = ferrovue::props::ParseUnionError;
/// #     fn from_str(s: &str) -> Result<Self, Self::Err> {
/// #         match s {
/// #             "sm" => Ok(Size::Sm),
/// #             "md" => Ok(Size::Md),
/// #             _ => Err(ferrovue::props::ParseUnionError::new("Size", s, &["sm", "md"])),
/// #         }
/// #     }
/// # }
/// let e = "xl".parse::<Size>().unwrap_err();
/// assert_eq!(e.value(), "xl");
/// assert_eq!(e.members(), ["sm", "md"]);
/// assert_eq!(e.to_string(), "`xl` is not one of the members of `Size`: `sm`, `md`");
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseUnionError {
    union: &'static str,
    value: String,
    members: &'static [&'static str],
}

impl ParseUnionError {
    #[doc(hidden)]
    #[must_use]
    pub fn new(union: &'static str, value: &str, members: &'static [&'static str]) -> Self {
        ParseUnionError {
            union,
            value: value.to_owned(),
            members,
        }
    }

    /// The name of the enum.
    #[must_use]
    pub fn union(&self) -> &'static str {
        self.union
    }

    /// The string that is none of the members.
    #[must_use]
    pub fn value(&self) -> &str {
        &self.value
    }

    /// The members of the union, in the order it declares them.
    #[must_use]
    pub fn members(&self) -> &'static [&'static str] {
        self.members
    }
}

impl fmt::Display for ParseUnionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "`{}` is not one of the members of `{}`: ",
            self.value, self.union
        )?;
        for (i, m) in self.members.iter().enumerate() {
            if i > 0 {
                f.write_str(", ")?;
            }
            write!(f, "`{m}`")?;
        }
        Ok(())
    }
}

impl std::error::Error for ParseUnionError {}

#[cfg(test)]
mod tests;
