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
