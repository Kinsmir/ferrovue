use std::fmt;
use std::hash::{Hash, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

use std::borrow::Cow;

use serde::de::{self, Deserialize, DeserializeOwned, Deserializer, Visitor};
use serde::ser::{Serialize, Serializer};

use crate::dates::{iso_time, js_time_clip, js_to_iso_string};
use crate::{record::Record, refused::Refused};

/// A JavaScript `Date`: its time value, the milliseconds since 1970-01-01T00:00:00Z, a whole number
/// within ±8.64 × 10¹⁵, or `NaN` for an invalid date. It is the Rust type of a prop the component
/// types `Date`, unless `dateType` in `ferrovue.config.json` names another
/// [`JsTime`].
///
/// An island's `data-props` carries it as `toISOString()` writes it, and an invalid date as `NaN`,
/// which `ferrovue/client` turns back into a `Date` before Vue hydrates. It reads back from such a
/// string, or from a number of milliseconds.
///
/// serde_json writes no `NaN`, so it writes an invalid date as `null`, which does not read back: an
/// `Option<JsDate>` holding [`JsDate::INVALID`] reads back as `None`, and a `JsDate` that is invalid
/// fails to read. `Deserialize` asks the format what it holds (`deserialize_any`), so it reads only
/// self-describing formats, such as JSON, and not bincode or postcard.
///
/// # Example
///
/// ```
/// use ferrovue::js_date::JsDate;
///
/// let posted = JsDate::parse("2024-05-01T09:30+02:00").unwrap();
/// assert_eq!(posted.time_value(), 1_714_548_600_000.0);
/// assert_eq!(posted.to_iso_string().as_deref(), Some("2024-05-01T07:30:00.000Z"));
/// assert_eq!(JsDate::from_millis(1_714_548_600_000.9), posted);
/// assert_eq!(serde_json::to_string(&posted).unwrap(), r#""2024-05-01T07:30:00.000Z""#);
///
/// assert!(!JsDate::from_millis(8.64e15 + 1.0).is_valid());
/// assert_eq!(JsDate::parse("+275761-01-01"), Some(JsDate::INVALID));
/// assert_eq!(JsDate::parse("May 1, 2024"), None);
/// ```
#[derive(Clone, Copy)]
pub struct JsDate(f64);

impl JsDate {
    /// An invalid date, `new Date(NaN)`.
    pub const INVALID: JsDate = JsDate(f64::NAN);

    /// `new Date(0)`: 1970-01-01T00:00:00.000Z.
    pub const UNIX_EPOCH: JsDate = JsDate(0.0);

    /// `new Date(ms)`: `ms` truncated toward zero, or an invalid date when `ms` is not finite or
    /// lies beyond ±8.64 × 10¹⁵.
    #[must_use]
    pub fn from_millis(ms: f64) -> JsDate {
        JsDate(js_time_clip(ms))
    }

    /// `new Date(s)` of a string in ECMAScript's date time string format, which every browser
    /// reads alike: a date alone (`2024-05-01`, read as UTC), or a date and time with a `Z` or an
    /// offset (`2024-05-01T09:30:15.250+02:00`), the year written with four digits or as `+`/`-`
    /// and six. A string in the format that lies beyond the range of dates is an invalid date.
    /// `None` for any other string, which an engine may read by rules of its own or in the time
    /// zone of the machine running it.
    #[must_use]
    pub fn parse(s: &str) -> Option<JsDate> {
        iso_time(s.as_bytes()).map(JsDate)
    }

    /// The current time, to the millisecond, as `new Date()` reads it in the browser. Read it once
    /// per request and pass it as a prop: the server renders at one moment and the browser
    /// hydrates at another.
    #[must_use]
    pub fn now() -> JsDate {
        SystemTime::now().into()
    }

    /// `getTime()`: the time value, `NaN` for an invalid date.
    #[must_use]
    pub const fn time_value(self) -> f64 {
        self.0
    }

    /// Whether the date is valid: whether its time value is a number.
    #[must_use]
    pub const fn is_valid(self) -> bool {
        !self.0.is_nan()
    }

    /// `toISOString()`: `2024-05-01T07:30:00.000Z`, the year written as `+`/`-` and six digits
    /// outside 0000 to 9999. `None` for an invalid date, where JavaScript throws.
    #[must_use]
    pub fn to_iso_string(self) -> Option<String> {
        self.is_valid().then(|| js_to_iso_string(self.0))
    }
}

impl PartialEq for JsDate {
    fn eq(&self, other: &JsDate) -> bool {
        self.0 == other.0 || (self.0.is_nan() && other.0.is_nan())
    }
}

impl Eq for JsDate {}

impl Hash for JsDate {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.0.to_bits().hash(state);
    }
}

impl fmt::Debug for JsDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.to_iso_string() {
            Some(iso) => write!(f, "JsDate({iso})"),
            None => f.write_str("JsDate(Invalid Date)"),
        }
    }
}

impl From<SystemTime> for JsDate {
    fn from(t: SystemTime) -> JsDate {
        let ms = match t.duration_since(UNIX_EPOCH) {
            Ok(after) => after.as_millis() as f64,
            Err(before) => -(before.duration().as_nanos().div_ceil(1_000_000) as f64),
        };
        JsDate::from_millis(ms)
    }
}

impl Serialize for JsDate {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.to_iso_string() {
            Some(iso) => serializer.serialize_str(&iso),
            None => serializer.serialize_f64(f64::NAN),
        }
    }
}

struct DateVisitor;

impl Visitor<'_> for DateVisitor {
    type Value = JsDate;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(
            "a date in ECMAScript's date time string format with a time zone, or a number of \
             milliseconds",
        )
    }

    fn visit_str<E: de::Error>(self, s: &str) -> Result<JsDate, E> {
        JsDate::parse(s).ok_or_else(|| {
            E::custom(format_args!(
                "the date {s:?} is not in ECMAScript's date time string format with a time zone, \
                 which every browser reads alike"
            ))
        })
    }

    fn visit_f64<E: de::Error>(self, ms: f64) -> Result<JsDate, E> {
        Ok(JsDate::from_millis(ms))
    }

    fn visit_i64<E: de::Error>(self, ms: i64) -> Result<JsDate, E> {
        Ok(JsDate::from_millis(ms as f64))
    }

    fn visit_u64<E: de::Error>(self, ms: u64) -> Result<JsDate, E> {
        Ok(JsDate::from_millis(ms as f64))
    }
}

impl<'de> Deserialize<'de> for JsDate {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<JsDate, D::Error> {
        deserializer.deserialize_any(DateVisitor)
    }
}

/// A Rust type a `Date` prop may be: one that holds a JavaScript time value, which the template's
/// `.getTime()`, `.toISOString()` and `.getUTC…()` read. [`JsDate`] implements it, and so does
/// `chrono::DateTime<chrono::Utc>` with the `chrono` feature; `dateType` in `ferrovue.config.json`
/// chooses which one the props are.
///
/// Generated code clips what `time_value` returns as `new Date(value)` does, in the markup and in
/// an island's `data-props` alike: a fraction is truncated toward zero, and a value that is not
/// finite or lies beyond ±8.64 × 10¹⁵ is an invalid date. An implementation need not clip it.
///
/// # Example
///
/// ```
/// use ferrovue::js_date::JsTime;
///
/// /// Whole seconds since 1970, as a database keeps them.
/// #[derive(Debug, Clone)]
/// struct Seconds(i64);
///
/// impl JsTime for Seconds {
///     fn time_value(&self) -> f64 {
///         self.0 as f64 * 1000.0
///     }
///
///     fn from_time_value(t: f64) -> Option<Self> {
///         (t.is_finite() && t % 1000.0 == 0.0).then(|| Seconds((t / 1000.0) as i64))
///     }
/// }
///
/// assert_eq!(Seconds(86_400).time_value(), 86_400_000.0);
/// assert!(Seconds::from_time_value(1.0).is_none());
/// ```
pub trait JsTime: Sized {
    /// The time value: the milliseconds since 1970-01-01T00:00:00Z, a whole number within
    /// ±8.64 × 10¹⁵, or `NaN` for an invalid date.
    fn time_value(&self) -> f64;

    /// The value of a time value `t`, or `None` where this type cannot hold it: a child component
    /// is handed a date its parent computed, or a fixture's props are read.
    fn from_time_value(t: f64) -> Option<Self>;
}

impl JsTime for JsDate {
    fn time_value(&self) -> f64 {
        self.0
    }

    fn from_time_value(t: f64) -> Option<JsDate> {
        Some(JsDate::from_millis(t))
    }
}

/// `new Date(x.time_value())`: the time value a `Date` prop gives the template, clipped as
/// JavaScript clips it.
#[doc(hidden)]
#[must_use]
pub fn js_time_of<T: JsTime>(date: &T) -> f64 {
    js_time_clip(date.time_value())
}

/// A child's `Date` prop, from the date its parent passes.
///
/// # Panics
///
/// When the prop's type cannot hold the date: `chrono::DateTime<Utc>` holds no invalid date, nor
/// one beyond ±262,142 years.
#[doc(hidden)]
#[must_use]
pub fn js_date_prop<T: JsTime>(t: f64) -> T {
    T::from_time_value(t).unwrap_or_else(|| panic!("{}", date_refused(t)))
}

#[cold]
pub(crate) fn date_refused(t: f64) -> Refused {
    Refused::new(
        "FV1812",
        format!(
            "the date {:?} is passed to a `Date` prop whose Rust type cannot hold it: check the \
             date before rendering, or name a `dateType` that holds every date, such as \
             `ferrovue::js_date::JsDate`",
            JsDate::from_millis(t)
        ),
    )
}

/// How a `Date` prop is written into an island's `data-props` and read back from a fixture,
/// whatever its Rust type: as [`JsDate`] is.
#[doc(hidden)]
pub mod date_prop {
    use super::{JsDate, JsTime, de};
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    /// The date as [`JsDate`] writes it.
    ///
    /// # Errors
    ///
    /// What the serializer refuses.
    pub fn serialize<T: JsTime, S: Serializer>(date: &T, serializer: S) -> Result<S::Ok, S::Error> {
        JsDate::from_millis(date.time_value()).serialize(serializer)
    }

    /// The date as [`JsDate`] reads it.
    ///
    /// # Errors
    ///
    /// A string outside ECMAScript's date time string format, or a date the type cannot hold.
    pub fn deserialize<'de, T: JsTime, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<T, D::Error> {
        held(JsDate::deserialize(deserializer)?)
    }

    pub(super) fn held<T: JsTime, E: de::Error>(date: JsDate) -> Result<T, E> {
        T::from_time_value(date.time_value()).ok_or_else(|| {
            E::custom(format_args!(
                "the date {date:?} is beyond what the prop's Rust type holds"
            ))
        })
    }
}

/// [`date_prop`] of an optional or nullable `Date` prop.
#[doc(hidden)]
pub mod opt_date_prop {
    use super::{JsDate, JsTime, date_prop};
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    /// The date as [`JsDate`] writes it, or `null`.
    ///
    /// # Errors
    ///
    /// What the serializer refuses.
    pub fn serialize<T: JsTime, S: Serializer>(
        date: &Option<T>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        date.as_ref()
            .map(|d| JsDate::from_millis(d.time_value()))
            .serialize(serializer)
    }

    /// The date as [`JsDate`] reads it, or `None` for `null`.
    ///
    /// # Errors
    ///
    /// A string outside ECMAScript's date time string format, or a date the type cannot hold.
    pub fn deserialize<'de, T: JsTime, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<T>, D::Error> {
        Option::<JsDate>::deserialize(deserializer)?
            .map(date_prop::held)
            .transpose()
    }
}

/// A value that holds dates in lists, dictionaries and optionals, written and read as
/// [`date_prop`] writes and reads one date: a field typed `Date[]`, `Record<string, Date>` or
/// `(Date | null)[]`.
#[doc(hidden)]
pub trait DateShape: Sized {
    /// The value with each date a [`JsDate`].
    type Js: Serialize + DeserializeOwned;

    /// The value with each date a [`JsDate`].
    fn to_js(&self) -> Self::Js;

    /// The value `js` holds.
    ///
    /// # Errors
    ///
    /// The first date the type cannot hold.
    fn from_js(js: Self::Js) -> Result<Self, JsDate>;
}

impl<T: JsTime> DateShape for T {
    type Js = JsDate;

    fn to_js(&self) -> JsDate {
        JsDate::from_millis(self.time_value())
    }

    fn from_js(js: JsDate) -> Result<T, JsDate> {
        T::from_time_value(js.time_value()).ok_or(js)
    }
}

impl<S: DateShape> DateShape for Option<S> {
    type Js = Option<S::Js>;

    fn to_js(&self) -> Option<S::Js> {
        self.as_ref().map(S::to_js)
    }

    fn from_js(js: Option<S::Js>) -> Result<Option<S>, JsDate> {
        js.map(S::from_js).transpose()
    }
}

impl<S: DateShape> DateShape for Vec<S> {
    type Js = Vec<S::Js>;

    fn to_js(&self) -> Vec<S::Js> {
        self.iter().map(S::to_js).collect()
    }

    fn from_js(js: Vec<S::Js>) -> Result<Vec<S>, JsDate> {
        js.into_iter().map(S::from_js).collect()
    }
}

impl<S: DateShape> DateShape for Record<'_, S> {
    type Js = Record<'static, S::Js>;

    fn to_js(&self) -> Record<'static, S::Js> {
        Record::from_entries(
            self.iter()
                .map(|(k, v)| (Cow::Owned(k.to_owned()), v.to_js()))
                .collect(),
        )
    }

    fn from_js(js: Record<'static, S::Js>) -> Result<Self, JsDate> {
        let entries = js
            .into_entries()
            .into_iter()
            .map(|(k, v)| S::from_js(v).map(|v| (k, v)))
            .collect::<Result<Vec<_>, JsDate>>()?;
        Ok(Record::from_entries(entries))
    }
}

/// How a field holding dates in lists, dictionaries and optionals is written into an island's
/// `data-props` and read back from a fixture, whatever the dates' Rust type: each date as
/// [`JsDate`] writes and reads it.
#[doc(hidden)]
pub mod dates_in {
    use super::{DateShape, de};
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    /// The value with each date as [`JsDate`](super::JsDate) writes it.
    ///
    /// # Errors
    ///
    /// What the serializer refuses.
    pub fn serialize<T: DateShape, S: Serializer>(
        value: &T,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.to_js().serialize(serializer)
    }

    /// The value with each date as [`JsDate`](super::JsDate) reads it.
    ///
    /// # Errors
    ///
    /// A string outside ECMAScript's date time string format, or a date the type cannot hold.
    pub fn deserialize<'de, T: DateShape, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<T, D::Error> {
        T::from_js(T::Js::deserialize(deserializer)?).map_err(|date| {
            <D::Error as de::Error>::custom(format_args!(
                "the date {date:?} is beyond what the prop's Rust type holds"
            ))
        })
    }
}

/// A [`JsDate`] that `chrono::DateTime<Utc>` cannot hold: an invalid date, or one beyond
/// chrono's ±262,142 years. JavaScript's dates reach from −271821 to +275760.
///
/// # Example
///
/// ```
/// use chrono::{DateTime, Utc};
/// use ferrovue::js_date::JsDate;
///
/// let far = JsDate::parse("+270000-01-01").unwrap();
/// let refused = DateTime::<Utc>::try_from(far).unwrap_err();
/// assert_eq!(refused.date(), far);
/// assert!(DateTime::<Utc>::try_from(JsDate::INVALID).is_err());
/// ```
#[cfg(feature = "chrono")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(docsrs, doc(cfg(feature = "chrono")))]
pub struct DateOutOfRange(JsDate);

#[cfg(feature = "chrono")]
impl DateOutOfRange {
    /// The date chrono cannot hold.
    #[must_use]
    pub const fn date(self) -> JsDate {
        self.0
    }
}

#[cfg(feature = "chrono")]
impl fmt::Display for DateOutOfRange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0.to_iso_string() {
            Some(iso) => write!(f, "{iso} is beyond the dates chrono holds"),
            None => f.write_str("an invalid date has no chrono date"),
        }
    }
}

#[cfg(feature = "chrono")]
impl std::error::Error for DateOutOfRange {}

#[cfg(feature = "chrono")]
mod chrono_time {
    use chrono::{DateTime, Utc};

    use super::{DateOutOfRange, JsDate, JsTime};

    impl From<DateTime<Utc>> for JsDate {
        fn from(t: DateTime<Utc>) -> JsDate {
            JsDate::from_millis(t.timestamp_millis() as f64)
        }
    }

    impl TryFrom<JsDate> for DateTime<Utc> {
        type Error = DateOutOfRange;

        fn try_from(date: JsDate) -> Result<DateTime<Utc>, DateOutOfRange> {
            if !date.is_valid() {
                return Err(DateOutOfRange(date));
            }
            DateTime::from_timestamp_millis(date.time_value() as i64).ok_or(DateOutOfRange(date))
        }
    }

    impl JsTime for DateTime<Utc> {
        fn time_value(&self) -> f64 {
            JsDate::from(*self).time_value()
        }

        fn from_time_value(t: f64) -> Option<DateTime<Utc>> {
            DateTime::try_from(JsDate::from_millis(t)).ok()
        }
    }
}

#[cfg(test)]
mod tests;
