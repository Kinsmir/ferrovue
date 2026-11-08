pub(super) fn digit(b: u8, radix: u32) -> Option<u32> {
    char::from(b).to_digit(radix)
}

pub(super) fn power_of_two_value(digits: &[u8], radix: u32) -> f64 {
    let bits = radix.trailing_zeros();
    let mut number: u64 = 0;
    let mut exponent: i32 = 0;
    for (i, &b) in digits.iter().enumerate() {
        number = number * u64::from(radix) + u64::from(digit(b, radix).expect("a digit"));
        let overflow = number >> 53;
        if overflow == 0 {
            continue;
        }
        let dropped_count = 64 - overflow.leading_zeros();
        let dropped = number & ((1 << dropped_count) - 1);
        number >>= dropped_count;
        exponent = dropped_count as i32;
        let rest = &digits[i + 1..];
        let zero_tail = rest.iter().all(|&d| d == b'0');
        exponent += (rest.len() as i32) * bits as i32;
        let middle = 1 << (dropped_count - 1);
        if dropped > middle || (dropped == middle && (number & 1 == 1 || !zero_tail)) {
            number += 1;
        }
        if number & (1 << 53) != 0 {
            exponent += 1;
            number >>= 1;
        }
        break;
    }
    (number as f64) * 2f64.powi(exponent)
}

pub(super) fn decimal_prefix(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let digits_from = |mut i: usize| {
        #[cfg(test)]
        let mut turns = crate::Turns::default();
        while i < b.len() && b[i].is_ascii_digit() {
            #[cfg(test)]
            turns.next();
            i += 1;
        }
        i
    };
    let mut i = usize::from(matches!(b.first(), Some(b'+' | b'-')));
    if s[i..].starts_with("Infinity") {
        return Some(i + "Infinity".len());
    }
    let int_end = digits_from(i);
    let whole = int_end > i;
    i = int_end;
    if b.get(i) == Some(&b'.') {
        let frac_end = digits_from(i + 1);
        if whole || frac_end > i + 1 {
            i = frac_end;
        } else {
            return None;
        }
    } else if !whole {
        return None;
    }
    if matches!(b.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(b.get(j), Some(b'+' | b'-')) {
            j += 1;
        }
        let exp_end = digits_from(j);
        if exp_end > j {
            i = exp_end;
        }
    }
    Some(i)
}

pub(super) fn decimal_value(literal: &str) -> f64 {
    match literal {
        "Infinity" | "+Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        _ => literal.parse().expect("a decimal literal"),
    }
}
