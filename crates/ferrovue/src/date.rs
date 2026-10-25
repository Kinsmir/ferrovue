use crate::{props::Record, render::Refused};
use serde::de::{self, Deserialize, DeserializeOwned, Deserializer, Visitor};
use serde::ser::{Serialize, Serializer};
use std::borrow::Cow;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

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
/// use ferrovue::date::JsDate;
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
/// use ferrovue::date::JsTime;
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
             `ferrovue::date::JsDate`",
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
/// use ferrovue::date::JsDate;
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

const MS_PER_DAY: i64 = 86_400_000;
const MAX_TIME: f64 = 8.64e15;

/// `new Date(x)` of a number: the time value JavaScript keeps, `x` truncated toward zero, or `NaN`
/// (an invalid date) when `x` is not finite or lies beyond ±8.64 × 10¹⁵ ms.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_time_clip(1.9), 1.0);
/// assert!(ferrovue::date::js_time_clip(8.64e15 + 1.0).is_nan());
/// assert!(ferrovue::date::js_time_clip(-0.0).is_sign_positive());
/// ```
#[must_use]
pub fn js_time_clip(x: f64) -> f64 {
    if !x.is_finite() || x.abs() > MAX_TIME {
        return f64::NAN;
    }
    x.trunc() + 0.0
}

/// `new Date(s)` and `Date.parse(s)` of a string in ECMAScript's date time string format: a date
/// alone (`2024-05-01`, `2024-05`, `2024`, read as UTC), or a date and a time with a `Z` or an offset
/// (`2024-05-01T09:30Z`, `2024-05-01T09:30:15.250+02:00`), the year written with four digits or as
/// `+`/`-` and six. The time value is `NaN` where it lies beyond ±8.64 × 10¹⁵ ms.
///
/// # Panics
///
/// On any other string: a date and time without a `Z` or offset, which JavaScript reads in the
/// time zone of the machine running it, and every string outside the format (`"May 1, 2024"`,
/// `"2024-5-1"`, `"2024-02-30"`, `"2024-05-01 09:30Z"`), which each engine reads by rules of its
/// own; and a date and time whose fields lie beyond ±8.64 × 10¹⁵ ms read as UTC while its offset
/// brings it within (`"+275760-09-13T01:00+01:00"`), which Safari reads as an invalid date and the
/// other engines as a valid one. A server cannot know what the reader's browser makes of them.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_date_parse("1970-01-02"), 86_400_000.0);
/// assert_eq!(ferrovue::date::js_date_parse("1970-01-01T01:00+01:00"), 0.0);
/// assert!(std::panic::catch_unwind(|| ferrovue::date::js_date_parse("1970-01-01T00:00")).is_err());
/// ```
#[must_use]
pub fn js_date_parse(s: &str) -> f64 {
    try_date_parse(s).unwrap_or_else(|refused| panic!("{refused}"))
}

/// [`js_date_parse`], returning the refusal where it panics.
///
/// # Errors
///
/// FV1803 where [`js_date_parse`] panics.
#[doc(hidden)]
pub fn try_date_parse(s: &str) -> Result<f64, Refused> {
    iso_time(s.as_bytes()).ok_or_else(|| {
        Refused::new(
            "FV1803",
            format!(
                "the date {s:?} is not in ECMAScript's date time string format with a time zone, \
                 which every browser reads alike: check it before rendering, and pass a date such \
                 as \"2024-05-01\" or \"2024-05-01T09:30Z\" (see ferrovue::guide::dates_and_prices)"
            ),
        )
    })
}

/// `Date.prototype.toISOString` of a time value: `2024-05-01T09:30:00.000Z`, the year written as
/// `+`/`-` and six digits outside 0000 to 9999.
///
/// # Panics
///
/// Where JavaScript throws a `RangeError`: an invalid date (`NaN`).
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_to_iso_string(0.0), "1970-01-01T00:00:00.000Z");
/// assert_eq!(ferrovue::date::js_to_iso_string(-62_198_755_200_000.0), "-000001-01-01T00:00:00.000Z");
/// assert!(std::panic::catch_unwind(|| ferrovue::date::js_to_iso_string(f64::NAN)).is_err());
/// ```
#[must_use]
pub fn js_to_iso_string(t: f64) -> String {
    try_to_iso_string(t).unwrap_or_else(|refused| panic!("{refused}"))
}

/// [`js_to_iso_string`], returning the refusal where it panics.
///
/// # Errors
///
/// FV1811 for an invalid date.
#[doc(hidden)]
pub fn try_to_iso_string(t: f64) -> Result<String, Refused> {
    let Some(t) = time(t) else {
        return Err(Refused::new(
            "FV1811",
            "`.toISOString()` of an invalid date, where JavaScript throws a RangeError (Invalid \
             time value) and Vue's render fails too: test the date in the template first \
             (`v-if=\"!Number.isNaN(d.getTime())\"`), or check the props before rendering",
        ));
    };
    let (year, month, day) = civil(t.div_euclid(MS_PER_DAY));
    let ms = t.rem_euclid(MS_PER_DAY);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else {
        format!("{}{:06}", if year < 0 { '-' } else { '+' }, year.abs())
    };
    Ok(format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    ))
}

/// `Date.prototype.getUTCFullYear` of a time value; `NaN` for an invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_utc_full_year(-1.0), 1969.0);
/// ```
#[must_use]
pub fn js_utc_full_year(t: f64) -> f64 {
    date_part(t, |(year, _, _)| year)
}

/// `Date.prototype.getUTCMonth` of a time value, from 0 for January; `NaN` for an invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_utc_month(-1.0), 11.0);
/// ```
#[must_use]
pub fn js_utc_month(t: f64) -> f64 {
    date_part(t, |(_, month, _)| month - 1)
}

/// `Date.prototype.getUTCDate` of a time value, the day of the month from 1; `NaN` for an invalid
/// date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_utc_date(-1.0), 31.0);
/// ```
#[must_use]
pub fn js_utc_date(t: f64) -> f64 {
    date_part(t, |(_, _, day)| day)
}

/// `Date.prototype.getUTCDay` of a time value, the day of the week from 0 for Sunday; `NaN` for an
/// invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_utc_day(0.0), 4.0); // a Thursday
/// ```
#[must_use]
pub fn js_utc_day(t: f64) -> f64 {
    time(t).map_or(f64::NAN, |t| {
        (t.div_euclid(MS_PER_DAY) + 4).rem_euclid(7) as f64
    })
}

/// `Date.prototype.getUTCHours` of a time value; `NaN` for an invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_utc_hours(-1.0), 23.0);
/// ```
#[must_use]
pub fn js_utc_hours(t: f64) -> f64 {
    time_part(t, 3_600_000, 24)
}

/// `Date.prototype.getUTCMinutes` of a time value; `NaN` for an invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_utc_minutes(-1.0), 59.0);
/// ```
#[must_use]
pub fn js_utc_minutes(t: f64) -> f64 {
    time_part(t, 60_000, 60)
}

/// `Date.prototype.getUTCSeconds` of a time value; `NaN` for an invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_utc_seconds(-1.0), 59.0);
/// ```
#[must_use]
pub fn js_utc_seconds(t: f64) -> f64 {
    time_part(t, 1000, 60)
}

/// `Date.prototype.getUTCMilliseconds` of a time value; `NaN` for an invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_utc_milliseconds(-1.0), 999.0);
/// ```
#[must_use]
pub fn js_utc_milliseconds(t: f64) -> f64 {
    time_part(t, 1, 1000)
}

const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// `Date.prototype.toUTCString` of a time value: `Thu, 01 Jan 1970 00:00:00 GMT`, the year written
/// with at least four digits and a `-` before year 0 (`Fri, 01 Jan -0001 00:00:00 GMT`), and
/// `Invalid Date` for an invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_to_utc_string(0.0), "Thu, 01 Jan 1970 00:00:00 GMT");
/// assert_eq!(ferrovue::date::js_to_utc_string(f64::NAN), "Invalid Date");
/// ```
#[must_use]
pub fn js_to_utc_string(t: f64) -> String {
    let Some(t) = time(t) else {
        return "Invalid Date".to_owned();
    };
    let days = t.div_euclid(MS_PER_DAY);
    let (year, month, day) = civil(days);
    let ms = t.rem_euclid(MS_PER_DAY);
    let sign = if year < 0 { "-" } else { "" };
    format!(
        "{}, {day:02} {} {sign}{:04} {:02}:{:02}:{:02} GMT",
        WEEKDAYS[(days + 4).rem_euclid(7) as usize],
        MONTHS[(month - 1) as usize],
        year.abs(),
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60
    )
}

/// `Date.prototype.toJSON` of a time value: its ISO string, or `None` (JavaScript's `null`) for an
/// invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_to_json(0.0).as_deref(), Some("1970-01-01T00:00:00.000Z"));
/// assert_eq!(ferrovue::date::js_to_json(f64::NAN), None);
/// ```
#[must_use]
pub fn js_to_json(t: f64) -> Option<String> {
    try_to_iso_string(t).ok()
}

/// `JSON.stringify(d)` of a date of this time value: its ISO string quoted, or `null` for an
/// invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_json_date(0.0), r#""1970-01-01T00:00:00.000Z""#);
/// assert_eq!(ferrovue::date::js_json_date(f64::NAN), "null");
/// ```
#[must_use]
pub fn js_json_date(t: f64) -> String {
    js_to_json(t).map_or_else(|| "null".to_owned(), |iso| format!("\"{iso}\""))
}

const EXACT: f64 = 9_007_199_254_740_992.0;

fn integer(x: f64) -> f64 {
    x.trunc() + 0.0
}

fn v8_day(year: f64, month: f64, date: f64) -> f64 {
    if !((-1e6..=1e6).contains(&year) && (-1e7..=1e7).contains(&month)) {
        return f64::NAN;
    }
    const DELTA: i64 = 399_999;
    let days_before =
        |y: i64| 365 * (y + DELTA) + (y + DELTA) / 4 - (y + DELTA) / 100 + (y + DELTA) / 400;
    let mut y = year as i64;
    let mut m = month as i64;
    y += m / 12;
    m %= 12;
    if m < 0 {
        m += 12;
        y -= 1;
    }
    const COMMON: [i64; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const LEAP: [i64; 12] = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
    let table = if y % 4 != 0 || (y % 100 == 0 && y % 400 != 0) {
        COMMON
    } else {
        LEAP
    };
    let day = days_before(y) - days_before(1970) + table[m as usize];
    (day - 1) as f64 + integer(date)
}

/// `Date.UTC(year, month, date, hours, minutes, seconds, ms)`: the time value of a date and time
/// in UTC, each part truncated toward zero, a year from 0 to 99 read as 1900 to 1999, a month or a
/// day beyond its range carried into the next, and `NaN` where a part is not finite or the time
/// lies beyond ±8.64 × 10¹⁵ ms. The parts JavaScript leaves out are `0`, `0`, `1`, `0`, `0`, `0`.
///
/// # Panics
///
/// Where engines compute different dates: a year beyond ±1,000,000, a month beyond ±10,000,000,
/// or a year before −399,999 once the month is carried into it, unless the date is invalid in
/// every engine, since V8 reads them by rules of its own, which Firefox and Safari do not share;
/// and a part worth more than 2⁵³ ms that the others bring back within the range of dates, which
/// Node rounds otherwise than the browsers.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::date::js_date_utc(2024.0, 1.0, 29.0, 0.0, 0.0, 0.0, 0.0), 1_709_164_800_000.0);
/// assert_eq!(ferrovue::date::js_date_utc(99.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0), 915_148_800_000.0);
/// assert!(ferrovue::date::js_date_utc(f64::NAN, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0).is_nan());
/// ```
#[must_use]
pub fn js_date_utc(
    year: f64,
    month: f64,
    date: f64,
    hours: f64,
    minutes: f64,
    seconds: f64,
    ms: f64,
) -> f64 {
    try_date_utc(year, month, date, hours, minutes, seconds, ms)
        .unwrap_or_else(|refused| panic!("{refused}"))
}

/// [`js_date_utc`], returning the refusal where it panics.
///
/// # Errors
///
/// FV1808 where [`js_date_utc`] panics.
#[doc(hidden)]
pub fn try_date_utc(
    year: f64,
    month: f64,
    date: f64,
    hours: f64,
    minutes: f64,
    seconds: f64,
    ms: f64,
) -> Result<f64, Refused> {
    let parts = [year, month, date, hours, minutes, seconds, ms];
    if !parts.iter().all(|x| x.is_finite()) {
        return Ok(f64::NAN);
    }
    let mut year = year;
    let whole = integer(year);
    if (0.0..=99.0).contains(&whole) {
        year = 1900.0 + whole;
    }
    let terms = [
        integer(hours) * 3_600_000.0,
        integer(minutes) * 60_000.0,
        integer(seconds) * 1000.0,
    ];
    let time = terms[0] + terms[1] + terms[2] + integer(ms);
    if !time.is_finite() {
        return Ok(f64::NAN);
    }
    let carried = integer(year) + (integer(month) / 12.0).floor();
    let agreed =
        (-1e6..=1e6).contains(&year) && (-1e7..=1e7).contains(&month) && carried >= -399_999.0;
    let differs = || {
        Refused::new(
            "FV1808",
            format!(
                "Date.UTC({}, {}, {}, {hours}, {minutes}, {seconds}, {ms}) is a date engines \
                 compute differently: check the parts before rendering, and keep the year within \
                 ±1,000,000 and each part within the range of dates (see \
                 ferrovue::guide::dates_and_prices)",
                parts[0], parts[1], parts[2]
            ),
        )
    };
    if !agreed {
        if carried.abs() >= 399_999.0 && integer(date).abs() <= 1e7 && time.abs() <= 1e15 {
            return Ok(f64::NAN);
        }
        return Err(differs());
    }
    let days = v8_day(year, month, date) * MS_PER_DAY as f64;
    let t = days + time;
    let largest = terms.iter().fold(days.abs(), |m, x| m.max(x.abs()));
    if t.is_finite() && largest > EXACT && t.abs() <= MAX_TIME + largest * 2f64.powi(-50) {
        return Err(differs());
    }
    Ok(if t.is_finite() && t.abs() <= MAX_TIME {
        integer(t)
    } else {
        f64::NAN
    })
}

fn time(t: f64) -> Option<i64> {
    let t = js_time_clip(t);
    (!t.is_nan()).then_some(t as i64)
}

fn date_part(t: f64, part: fn((i64, i64, i64)) -> i64) -> f64 {
    time(t).map_or(f64::NAN, |t| part(civil(t.div_euclid(MS_PER_DAY))) as f64)
}

fn time_part(t: f64, unit: i64, count: i64) -> f64 {
    time(t).map_or(f64::NAN, |t| {
        (t.rem_euclid(MS_PER_DAY) / unit % count) as f64
    })
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

struct Cursor<'s> {
    s: &'s [u8],
    at: usize,
}

impl Cursor<'_> {
    fn eat(&mut self, c: u8) -> bool {
        let found = self.s.get(self.at) == Some(&c);
        self.at += usize::from(found);
        found
    }

    fn digits(&mut self, n: usize) -> Option<i64> {
        let run = self.s.get(self.at..self.at + n)?;
        if !run.iter().all(u8::is_ascii_digit) {
            return None;
        }
        self.at += n;
        Some(run.iter().fold(0, |acc, d| acc * 10 + i64::from(d - b'0')))
    }

    fn sign(&mut self) -> Option<i64> {
        if self.eat(b'+') {
            Some(1)
        } else if self.eat(b'-') {
            Some(-1)
        } else {
            None
        }
    }

    fn within(&mut self, n: usize, low: i64, high: i64) -> Option<i64> {
        self.digits(n).filter(|v| (low..=high).contains(v))
    }
}

pub(crate) fn iso_time(s: &[u8]) -> Option<f64> {
    let mut c = Cursor { s, at: 0 };
    let year = match c.sign() {
        Some(sign) => {
            let year = c.digits(6)?;
            if sign == -1 && year == 0 {
                return None;
            }
            sign * year
        }
        None => c.digits(4)?,
    };
    let mut month = 1;
    let mut day = 1;
    if c.eat(b'-') {
        month = c.within(2, 1, 12)?;
        if c.eat(b'-') {
            day = c.within(2, 1, days_in_month(year, month))?;
        }
    }
    let mut ms = days_from_civil(year, month, day) * MS_PER_DAY;
    if c.eat(b'T') {
        let hours = c.within(2, 0, 23)?;
        c.eat(b':').then_some(())?;
        let minutes = c.within(2, 0, 59)?;
        let mut seconds = 0;
        let mut millis = 0;
        if c.eat(b':') {
            seconds = c.within(2, 0, 59)?;
            if c.eat(b'.') {
                millis = c.digits(3)?;
            }
        }
        ms += ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
        if !c.eat(b'Z') {
            let sign = c.sign()?;
            let hours = c.within(2, 0, 23)?;
            c.eat(b':').then_some(())?;
            let fields = ms as f64;
            ms -= sign * (hours * 60 + c.within(2, 0, 59)?) * 60_000;
            if js_time_clip(fields).is_nan() && !js_time_clip(ms as f64).is_nan() {
                return None;
            }
        }
    }
    if c.at != s.len() {
        return None;
    }
    Some(js_time_clip(ms as f64))
}

#[cfg(test)]
mod tests;
