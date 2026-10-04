//! The Rust twins of `components/helpers.ts`.

pub fn plural(n: i64) -> &'static str {
    if n == 1 { "" } else { "s" }
}

pub fn tone(score: Option<i64>) -> &'static str {
    match score {
        None => "unknown",
        Some(s) if s > 0 => "positive",
        Some(s) if s < 0 => "negative",
        Some(_) => "zero",
    }
}

pub fn is_even(n: i64) -> bool {
    n % 2 == 0
}

pub fn or_dash(s: Option<&str>) -> &str {
    match s {
        Some(s) if !s.is_empty() => s,
        _ => "—",
    }
}
