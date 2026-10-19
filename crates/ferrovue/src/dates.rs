const MS_PER_DAY: i64 = 86_400_000;
const MAX_TIME: f64 = 8.64e15;

/// `new Date(x)` of a number: the time value JavaScript keeps, `x` truncated toward zero, or `NaN`
/// (an invalid date) when `x` is not finite or lies beyond ±8.64 × 10¹⁵ ms.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_time_clip(1.9), 1.0);
/// assert!(ferrovue::js_time_clip(8.64e15 + 1.0).is_nan());
/// assert!(ferrovue::js_time_clip(-0.0).is_sign_positive());
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
/// assert_eq!(ferrovue::js_date_parse("1970-01-02"), 86_400_000.0);
/// assert_eq!(ferrovue::js_date_parse("1970-01-01T01:00+01:00"), 0.0);
/// assert!(std::panic::catch_unwind(|| ferrovue::js_date_parse("1970-01-01T00:00")).is_err());
/// ```
#[must_use]
pub fn js_date_parse(s: &str) -> f64 {
    iso_time(s.as_bytes()).unwrap_or_else(|| {
        panic!(
            "ferrovue: the date {s:?} is not in ECMAScript's date time string format with a time \
             zone, which every browser reads alike (see ferrovue::guide::dates_and_prices)"
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
/// assert_eq!(ferrovue::js_to_iso_string(0.0), "1970-01-01T00:00:00.000Z");
/// assert_eq!(ferrovue::js_to_iso_string(-62_198_755_200_000.0), "-000001-01-01T00:00:00.000Z");
/// assert!(std::panic::catch_unwind(|| ferrovue::js_to_iso_string(f64::NAN)).is_err());
/// ```
#[must_use]
pub fn js_to_iso_string(t: f64) -> String {
    let Some(t) = time(t) else {
        panic!("RangeError: Invalid time value");
    };
    let (year, month, day) = civil(t.div_euclid(MS_PER_DAY));
    let ms = t.rem_euclid(MS_PER_DAY);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else {
        format!("{}{:06}", if year < 0 { '-' } else { '+' }, year.abs())
    };
    format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}

/// `Date.prototype.getUTCFullYear` of a time value; `NaN` for an invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_utc_full_year(-1.0), 1969.0);
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
/// assert_eq!(ferrovue::js_utc_month(-1.0), 11.0);
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
/// assert_eq!(ferrovue::js_utc_date(-1.0), 31.0);
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
/// assert_eq!(ferrovue::js_utc_day(0.0), 4.0); // a Thursday
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
/// assert_eq!(ferrovue::js_utc_hours(-1.0), 23.0);
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
/// assert_eq!(ferrovue::js_utc_minutes(-1.0), 59.0);
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
/// assert_eq!(ferrovue::js_utc_seconds(-1.0), 59.0);
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
/// assert_eq!(ferrovue::js_utc_milliseconds(-1.0), 999.0);
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
/// assert_eq!(ferrovue::js_to_utc_string(0.0), "Thu, 01 Jan 1970 00:00:00 GMT");
/// assert_eq!(ferrovue::js_to_utc_string(f64::NAN), "Invalid Date");
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
/// assert_eq!(ferrovue::js_to_json(0.0).as_deref(), Some("1970-01-01T00:00:00.000Z"));
/// assert_eq!(ferrovue::js_to_json(f64::NAN), None);
/// ```
#[must_use]
pub fn js_to_json(t: f64) -> Option<String> {
    time(t).map(|_| js_to_iso_string(t))
}

/// `JSON.stringify(d)` of a date of this time value: its ISO string quoted, or `null` for an
/// invalid date.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_json_date(0.0), r#""1970-01-01T00:00:00.000Z""#);
/// assert_eq!(ferrovue::js_json_date(f64::NAN), "null");
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
/// assert_eq!(ferrovue::js_date_utc(2024.0, 1.0, 29.0, 0.0, 0.0, 0.0, 0.0), 1_709_164_800_000.0);
/// assert_eq!(ferrovue::js_date_utc(99.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0), 915_148_800_000.0);
/// assert!(ferrovue::js_date_utc(f64::NAN, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0).is_nan());
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
    let parts = [year, month, date, hours, minutes, seconds, ms];
    if !parts.iter().all(|x| x.is_finite()) {
        return f64::NAN;
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
        return f64::NAN;
    }
    let carried = integer(year) + (integer(month) / 12.0).floor();
    let agreed =
        (-1e6..=1e6).contains(&year) && (-1e7..=1e7).contains(&month) && carried >= -399_999.0;
    let differs = || -> ! {
        panic!(
            "ferrovue: Date.UTC({}, {}, {}, {hours}, {minutes}, {seconds}, {ms}) is a date \
             engines compute differently (see ferrovue::guide::dates_and_prices)",
            parts[0], parts[1], parts[2]
        )
    };
    if !agreed {
        if carried.abs() >= 399_999.0 && integer(date).abs() <= 1e7 && time.abs() <= 1e15 {
            return f64::NAN;
        }
        differs();
    }
    let days = v8_day(year, month, date) * MS_PER_DAY as f64;
    let t = days + time;
    let largest = terms.iter().fold(days.abs(), |m, x| m.max(x.abs()));
    if t.is_finite() && largest > EXACT && t.abs() <= MAX_TIME + largest * 2f64.powi(-50) {
        differs();
    }
    if t.is_finite() && t.abs() <= MAX_TIME {
        integer(t)
    } else {
        f64::NAN
    }
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
