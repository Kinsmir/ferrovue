use std::borrow::Cow;

pub(super) fn boundary(s: &str, i: usize) -> (usize, bool) {
    let mut unit = 0;
    for (byte, c) in s.char_indices() {
        if unit >= i {
            return (byte, false);
        }
        let width = c.len_utf16();
        if unit + width > i {
            return (byte + c.len_utf8(), true);
        }
        unit += width;
    }
    (s.len(), false)
}

pub(super) fn units(s: &str, from: usize, to: usize) -> Cow<'_, str> {
    if from >= to {
        return Cow::Borrowed("");
    }
    if s.is_ascii() {
        return Cow::Borrowed(&s[from..to]);
    }
    let (start, low_half) = boundary(s, from);
    let (end, high_half) = boundary(s, to);
    if !low_half && !high_half {
        return Cow::Borrowed(&s[start..end]);
    }
    let whole_end = if high_half { end - 4 } else { end };
    let mut out = String::with_capacity(whole_end.saturating_sub(start) + 6);
    if low_half {
        out.push('\u{FFFD}');
    }
    if whole_end > start {
        out.push_str(&s[start..whole_end]);
    }
    if high_half {
        out.push('\u{FFFD}');
    }
    Cow::Owned(out)
}

pub(super) fn unit(s: &str, k: usize) -> &str {
    if s.is_ascii() {
        return &s[k..k + 1];
    }
    let mut at = 0;
    for (byte, c) in s.char_indices() {
        let width = c.len_utf16();
        if k < at + width {
            return if width == 1 {
                &s[byte..byte + c.len_utf8()]
            } else {
                "\u{FFFD}"
            };
        }
        at += width;
    }
    unreachable!("code unit {k} is in range")
}

pub(super) fn char_start(s: &str, unit: usize) -> usize {
    match boundary(s, unit) {
        (byte, true) => byte - 4,
        (byte, false) => byte,
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Cursor<'a> {
    pub(super) s: &'a str,
    pub(super) len: usize,
    ascii: bool,
    unit: usize,
    pub(super) byte: usize,
}

#[cfg(test)]
thread_local! {
    pub(super) static STEPS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn step(n: usize) {
    STEPS.with(|steps| steps.set(steps.get() + n));
}

impl<'a> Cursor<'a> {
    pub(super) fn new(s: &'a str) -> Self {
        #[cfg(test)]
        step(s.len());
        let ascii = s.is_ascii();
        let len = if ascii {
            s.len()
        } else {
            s.chars().map(char::len_utf16).sum()
        };
        Self {
            s,
            len,
            ascii,
            unit: 0,
            byte: 0,
        }
    }

    pub(super) fn seek(&mut self, k: usize) -> (char, usize) {
        if self.ascii {
            self.unit = k;
            self.byte = k;
            return (char::from(self.s.as_bytes()[k]), 0);
        }
        while self.unit > k {
            #[cfg(test)]
            step(1);
            let ch = self.s[..self.byte]
                .chars()
                .next_back()
                .expect("a character before");
            self.unit -= ch.len_utf16();
            self.byte -= ch.len_utf8();
        }
        loop {
            #[cfg(test)]
            step(1);
            let ch = self.s[self.byte..]
                .chars()
                .next()
                .expect("a character in range");
            let width = ch.len_utf16();
            if k < self.unit + width {
                return (ch, k - self.unit);
            }
            self.unit += width;
            self.byte += ch.len_utf8();
        }
    }
}
