use super::{MS_PER_DAY, js_time_clip};

pub(super) fn integer(x: f64) -> f64 {
    x.trunc() + 0.0
}

pub(super) fn v8_day(year: f64, month: f64, date: f64) -> f64 {
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

pub(super) fn time(t: f64) -> Option<i64> {
    let t = js_time_clip(t);
    (!t.is_nan()).then_some(t as i64)
}

pub(super) fn date_part(t: f64, part: fn((i64, i64, i64)) -> i64) -> f64 {
    time(t).map_or(f64::NAN, |t| part(civil(t.div_euclid(MS_PER_DAY))) as f64)
}

pub(super) fn time_part(t: f64, unit: i64, count: i64) -> f64 {
    time(t).map_or(f64::NAN, |t| {
        (t.rem_euclid(MS_PER_DAY) / unit % count) as f64
    })
}

pub(super) fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub(super) fn civil(days: i64) -> (i64, i64, i64) {
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

pub(super) fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}
