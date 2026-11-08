use std::collections::HashSet;

use super::JsRegex;

#[derive(Debug, Clone)]
pub(super) enum Atom {
    Unit(u16),
    Any,
    Class(Vec<(u16, u16)>, bool, Option<HashSet<u16>>),
    Start,
    End,
    Boundary(bool),
}

#[derive(Debug, Clone)]
pub(super) struct Piece {
    atom: Atom,
    min: usize,
    max: usize,
    greedy: bool,
}

const SPACES: [(u16, u16); 10] = [
    (0x09, 0x0D),
    (0x20, 0x20),
    (0xA0, 0xA0),
    (0x1680, 0x1680),
    (0x2000, 0x200A),
    (0x2028, 0x2029),
    (0x202F, 0x202F),
    (0x205F, 0x205F),
    (0x3000, 0x3000),
    (0xFEFF, 0xFEFF),
];
const DIGITS: [(u16, u16); 1] = [(0x30, 0x39)];
const WORD: [(u16, u16); 4] = [(0x30, 0x39), (0x41, 0x5A), (0x5F, 0x5F), (0x61, 0x7A)];
const QUANTIFIER_BOUND: usize = i32::MAX as usize;

fn negated(ranges: &[(u16, u16)]) -> Vec<(u16, u16)> {
    let mut out = Vec::new();
    let mut next = 0_u32;
    for &(lo, hi) in ranges {
        if u32::from(lo) > next {
            out.push((next as u16, lo - 1));
        }
        next = u32::from(hi) + 1;
    }
    if next <= 0xFFFF {
        out.push((next as u16, 0xFFFF));
    }
    out
}

fn escape_class(c: char) -> Option<Vec<(u16, u16)>> {
    match c {
        'd' => Some(DIGITS.to_vec()),
        'D' => Some(negated(&DIGITS)),
        'w' => Some(WORD.to_vec()),
        'W' => Some(negated(&WORD)),
        's' => Some(SPACES.to_vec()),
        'S' => Some(negated(&SPACES)),
        _ => None,
    }
}

pub(super) struct Parser<'p> {
    units: Vec<u16>,
    at: usize,
    pattern: &'p str,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u16> {
        self.units.get(self.at).copied()
    }

    fn next(&mut self) -> Result<u16, String> {
        let unit = self
            .peek()
            .ok_or_else(|| format!("`/{}/` ends too early", self.pattern))?;
        self.at += 1;
        Ok(unit)
    }

    fn hex(&mut self, digits: usize) -> Result<u16, String> {
        let mut value = 0_u16;
        for _ in 0..digits {
            let unit = self.next()?;
            let digit = char::from_u32(u32::from(unit))
                .and_then(|c| c.to_digit(16))
                .ok_or_else(|| {
                    format!(
                        "`/{}/` has an escape with a digit that is not hexadecimal",
                        self.pattern
                    )
                })?;
            value = value * 16 + digit as u16;
        }
        Ok(value)
    }

    fn escape(&mut self, in_class: bool) -> Result<Result<u16, Vec<(u16, u16)>>, String> {
        let unit = self.next()?;
        let c = char::from_u32(u32::from(unit)).unwrap_or('\u{FFFD}');
        if let Some(ranges) = escape_class(c) {
            return Ok(Err(ranges));
        }
        Ok(Ok(match c {
            't' => 0x09,
            'n' => 0x0A,
            'v' => 0x0B,
            'f' => 0x0C,
            'r' => 0x0D,
            '0' if !self.peek().is_some_and(|u| (0x30..=0x39).contains(&u)) => 0,
            'x' => self.hex(2)?,
            'u' => self.hex(4)?,
            'b' if in_class => 0x08,
            '-' if in_class => unit,
            '^' | '$' | '\\' | '.' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '|'
            | '/' => unit,
            _ => {
                return Err(format!(
                    "`/{}/` has the escape `\\{c}`, which the server does not translate",
                    self.pattern
                ));
            }
        }))
    }

    fn class(&mut self) -> Result<Atom, String> {
        let negate = self.peek() == Some(u16::from(b'^'));
        if negate {
            self.at += 1;
        }
        let mut ranges = Vec::new();
        loop {
            let unit = self.next()?;
            if unit == u16::from(b']') {
                break;
            }
            let low = if unit == u16::from(b'\\') {
                match self.escape(true)? {
                    Ok(u) => u,
                    Err(set) => {
                        ranges.extend(set);
                        continue;
                    }
                }
            } else {
                unit
            };
            if self.peek() == Some(u16::from(b'-'))
                && self.units.get(self.at + 1) != Some(&u16::from(b']'))
            {
                self.at += 1;
                let unit = self.next()?;
                let high = if unit == u16::from(b'\\') {
                    match self.escape(true)? {
                        Ok(u) => u,
                        Err(_) => {
                            return Err(format!(
                                "`/{}/` has a range that ends at a class escape",
                                self.pattern
                            ));
                        }
                    }
                } else {
                    unit
                };
                if high < low {
                    return Err(format!("`/{}/` has a range out of order", self.pattern));
                }
                ranges.push((low, high));
            } else {
                ranges.push((low, low));
            }
        }
        Ok(Atom::Class(ranges, negate, None))
    }

    fn number(&mut self) -> Option<usize> {
        let start = self.at;
        #[cfg(test)]
        let mut turns = crate::Turns::default();
        while self.peek().is_some_and(|u| (0x30..=0x39).contains(&u)) {
            #[cfg(test)]
            turns.next();
            self.at += 1;
        }
        (self.at > start).then(|| {
            self.units[start..self.at].iter().fold(0, |n: usize, &u| {
                n.saturating_mul(10)
                    .saturating_add(usize::from(u - 0x30))
                    .min(QUANTIFIER_BOUND)
            })
        })
    }

    fn quantifier(&mut self) -> Result<Option<(usize, usize)>, String> {
        let Some(unit) = self.peek() else {
            return Ok(None);
        };
        let bounds = match unit {
            0x2A => (0, usize::MAX),
            0x2B => (1, usize::MAX),
            0x3F => (0, 1),
            0x7B => {
                let start = self.at;
                self.at += 1;
                let Some(min) = self.number() else {
                    self.at = start;
                    return Ok(None);
                };
                let max = if self.peek() == Some(u16::from(b',')) {
                    self.at += 1;
                    if self.peek() == Some(u16::from(b'}')) {
                        Some(usize::MAX)
                    } else {
                        self.number()
                    }
                } else {
                    Some(min)
                };
                let Some(max) = max.filter(|_| self.peek() == Some(u16::from(b'}'))) else {
                    self.at = start;
                    return Ok(None);
                };
                if max < min {
                    return Err(format!(
                        "`/{}/` has a quantifier out of order",
                        self.pattern
                    ));
                }
                (min, max)
            }
            _ => return Ok(None),
        };
        self.at += 1;
        Ok(Some(bounds))
    }

    fn parse(mut self) -> Result<Vec<Piece>, String> {
        let mut pieces: Vec<Piece> = Vec::new();
        while let Some(unit) = self.peek() {
            self.at += 1;
            let atom = match unit {
                0x5E => Atom::Start,
                0x24 => Atom::End,
                0x2E => Atom::Any,
                0x5B => self.class()?,
                0x5C => {
                    if self.peek() == Some(u16::from(b'b')) || self.peek() == Some(u16::from(b'B'))
                    {
                        let word = self.next()? == u16::from(b'b');
                        Atom::Boundary(word)
                    } else {
                        match self.escape(false)? {
                            Ok(u) => Atom::Unit(u),
                            Err(set) => Atom::Class(set, false, None),
                        }
                    }
                }
                0x28 | 0x29 | 0x7C | 0x5D | 0x7D | 0x2A | 0x2B | 0x3F | 0x7B => {
                    let c = char::from_u32(u32::from(unit)).unwrap_or('?');
                    return Err(format!(
                        "`/{}/` holds `{c}` where the server's subset has none",
                        self.pattern
                    ));
                }
                _ => Atom::Unit(unit),
            };
            let zero_width = matches!(atom, Atom::Start | Atom::End | Atom::Boundary(_));
            let (min, max, greedy) = match self.quantifier()? {
                Some(_) if zero_width => {
                    return Err(format!("`/{}/` quantifies an assertion", self.pattern));
                }
                Some((min, max)) => {
                    let lazy = self.peek() == Some(u16::from(b'?'));
                    if lazy {
                        self.at += 1;
                    }
                    (min, max, !lazy)
                }
                None => (1, 1, true),
            };
            pieces.push(Piece {
                atom,
                min,
                max,
                greedy,
            });
        }
        Ok(pieces)
    }
}

pub(super) fn pieces(pattern: &str, ignore_case: bool) -> Result<Vec<Piece>, String> {
    let mut pieces = Parser {
        units: pattern.encode_utf16().collect(),
        at: 0,
        pattern,
    }
    .parse()?;
    if ignore_case {
        for p in &mut pieces {
            if let Atom::Class(ranges, _, folded) = &mut p.atom {
                *folded = Some(
                    ranges
                        .iter()
                        .flat_map(|&(lo, hi)| lo..=hi)
                        .map(canonical)
                        .collect(),
                );
            }
        }
    }
    Ok(pieces)
}

fn canonical(unit: u16) -> u16 {
    let Some(c) = char::from_u32(u32::from(unit)) else {
        return unit;
    };
    let mut upper = c.to_uppercase();
    match (upper.next(), upper.next()) {
        (Some(u), None) if u.len_utf16() == 1 && !(unit >= 128 && (u as u32) < 128) => u as u16,
        _ => unit,
    }
}

fn is_word(unit: u16) -> bool {
    WORD.iter().any(|&(lo, hi)| (lo..=hi).contains(&unit))
}

impl JsRegex {
    fn matches_unit(&self, atom: &Atom, unit: u16) -> bool {
        match atom {
            Atom::Unit(u) => *u == unit || (self.ignore_case && canonical(*u) == canonical(unit)),
            Atom::Any => !matches!(unit, 0x0A | 0x0D | 0x2028 | 0x2029),
            Atom::Class(ranges, negate, folded) => {
                let found = ranges.iter().any(|&(lo, hi)| (lo..=hi).contains(&unit))
                    || folded
                        .as_ref()
                        .is_some_and(|set| set.contains(&canonical(unit)));
                found != *negate
            }
            Atom::Start | Atom::End | Atom::Boundary(_) => false,
        }
    }

    fn assertion(atom: &Atom, text: &[u16], at: usize) -> Option<bool> {
        match atom {
            Atom::Start => Some(at == 0),
            Atom::End => Some(at == text.len()),
            Atom::Boundary(word) => {
                let before = at > 0 && is_word(text[at - 1]);
                let after = at < text.len() && is_word(text[at]);
                Some((before != after) == *word)
            }
            _ => None,
        }
    }

    pub(super) fn match_from(&self, piece: usize, text: &[u16], at: usize) -> Option<usize> {
        let Some(p) = self.pieces.get(piece) else {
            return Some(at);
        };
        if let Some(holds) = JsRegex::assertion(&p.atom, text, at) {
            return if holds {
                self.match_from(piece + 1, text, at)
            } else {
                None
            };
        }
        let mut count = 0;
        #[cfg(test)]
        let mut turns = crate::Turns::default();
        while count < p.max
            && at + count < text.len()
            && self.matches_unit(&p.atom, text[at + count])
        {
            #[cfg(test)]
            turns.next();
            count += 1;
        }
        if count < p.min {
            return None;
        }
        if p.greedy {
            (p.min..=count)
                .rev()
                .find_map(|n| self.match_from(piece + 1, text, at + n))
        } else {
            (p.min..=count).find_map(|n| self.match_from(piece + 1, text, at + n))
        }
    }

    pub(super) fn find(&self, text: &[u16], from: usize) -> Option<(usize, usize)> {
        (from..=text.len())
            .find_map(|start| self.match_from(0, text, start).map(|end| (start, end)))
    }
}

pub(super) fn substitute_units(
    out: &mut Vec<u16>,
    with: &[u16],
    text: &[u16],
    start: usize,
    end: usize,
) {
    let mut i = 0;
    while i < with.len() {
        if with[i] == u16::from(b'$') && i + 1 < with.len() {
            match with[i + 1] {
                0x24 => {
                    out.push(0x24);
                    i += 2;
                    continue;
                }
                0x26 => {
                    out.extend_from_slice(&text[start..end]);
                    i += 2;
                    continue;
                }
                0x60 => {
                    out.extend_from_slice(&text[..start]);
                    i += 2;
                    continue;
                }
                0x27 => {
                    out.extend_from_slice(&text[end..]);
                    i += 2;
                    continue;
                }
                _ => {}
            }
        }
        out.push(with[i]);
        i += 1;
    }
}
