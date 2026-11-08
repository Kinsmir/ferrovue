use super::calendar::{days_from_civil, days_in_month};
use super::{MS_PER_DAY, js_time_clip};

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

pub(super) fn iso_time(s: &[u8]) -> Option<f64> {
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
