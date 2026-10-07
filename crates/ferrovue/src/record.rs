use std::borrow::Cow;
use std::fmt;
use std::marker::PhantomData;

use serde::de::{Deserialize, Deserializer, MapAccess, Visitor};
use serde::ser::{Serialize, SerializeMap, Serializer};

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
/// use ferrovue::Record;
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

#[cfg(test)]
mod tests;
