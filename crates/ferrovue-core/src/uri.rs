/// `encodeURIComponent(s)`: every character but the ASCII letters and digits and `-_.!~*'()`
/// written as `%XX` for each byte of its UTF-8, the hexadecimal digits in upper case.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// assert_eq!(ferrovue::core::uri::js_encode_uri_component("a b&c/é"), "a%20b%26c%2F%C3%A9");
/// assert_eq!(ferrovue::core::uri::js_encode_uri_component("🦀"), "%F0%9F%A6%80");
/// ```
#[must_use]
pub fn js_encode_uri_component(s: &str) -> String {
    encoded(s, kept_by_encode_uri_component)
}

/// `encodeURI(s)`: as [`js_encode_uri_component`], but keeping the characters a URI reserves as
/// well, `;/?:@&=+$,#`.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_core as core; }
/// assert_eq!(ferrovue::core::uri::js_encode_uri("/a b?q=1&r=é#top"), "/a%20b?q=1&r=%C3%A9#top");
/// assert_eq!(ferrovue::core::uri::js_encode_uri("[|]"), "%5B%7C%5D");
/// ```
#[must_use]
pub fn js_encode_uri(s: &str) -> String {
    encoded(s, kept_by_encode_uri)
}

fn encoded(s: &str, keep: fn(char) -> bool) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if keep(c) {
            out.push(c);
        } else {
            percent_encode_into(&mut out, c);
        }
    }
    out
}

fn kept_by_encode_uri_component(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '(' | ')')
}

/// Whether `encodeURI` writes `c` as it is.
#[doc(hidden)]
#[must_use]
pub fn kept_by_encode_uri(c: char) -> bool {
    kept_by_encode_uri_component(c)
        || matches!(
            c,
            ';' | '/' | '?' | ':' | '@' | '&' | '=' | '+' | '$' | ',' | '#'
        )
}

/// Appends `c` as `%XX` for each byte of its UTF-8, the hexadecimal digits in upper case.
#[doc(hidden)]
pub fn percent_encode_into(out: &mut String, c: char) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut buf = [0; 4];
    for &b in c.encode_utf8(&mut buf).as_bytes() {
        out.push('%');
        out.push(char::from(HEX[usize::from(b >> 4)]));
        out.push(char::from(HEX[usize::from(b & 0xF)]));
    }
}

#[cfg(test)]
mod tests;
