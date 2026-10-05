//! `escapeHtml`: the escaping every interpolated value goes through.

/// `escapeHtml`: `"`, `&`, `'`, `<` and `>`, and nothing else.
///
/// Appends `s` to `out` with those five characters written as entities, which makes it safe as
/// text and as a quoted attribute value. Generated code writes every interpolated value through
/// it; use it for any text your own code writes into a page or a slot.
/// [`guide::escaping`] covers what escaping does and does not protect.
///
/// [`guide::escaping`]: https://docs.rs/ferrovue/latest/ferrovue/guide/escaping/index.html
///
/// # Example
///
/// ```
/// # use ferrovue_core as ferrovue;
/// let mut out = String::from("<p>");
/// ferrovue::escape_into(&mut out, r#"<a href="x">Tom & 'Jerry'</a>"#);
/// assert_eq!(out, "<p>&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
/// ```
pub fn escape_into(out: &mut String, s: &str) {
    // Most strings need nothing escaped, and are then written in one copy.
    if !needs_escape(s.as_bytes()) {
        out.push_str(s);
        return;
    }
    let mut last = 0;
    for (i, b) in s.bytes().enumerate() {
        let rep = match b {
            b'"' => "&quot;",
            b'&' => "&amp;",
            b'\'' => "&#39;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            _ => continue,
        };
        out.push_str(&s[last..i]);
        out.push_str(rep);
        last = i + 1;
    }
    out.push_str(&s[last..]);
}

/// Whether any byte of `s` is one `escapeHtml` replaces, read eight bytes at a time as a `u64`. A
/// byte equal to `c` is the one that `x ^ cccccccc` makes zero, and subtracting 1 from every byte
/// borrows through a zero byte into its top bit; `!t` keeps only the borrows that began there.
fn needs_escape(s: &[u8]) -> bool {
    const ONES: u64 = u64::from_ne_bytes([0x01; 8]);
    const TOPS: u64 = u64::from_ne_bytes([0x80; 8]);
    let special = |word: u64| {
        let zero = |c: u8| {
            let t = word ^ (ONES * u64::from(c));
            t.wrapping_sub(ONES) & !t & TOPS
        };
        (zero(b'"') | zero(b'&') | zero(b'\'') | zero(b'<') | zero(b'>')) != 0
    };
    let Some(last) = s.last_chunk::<8>() else {
        return s
            .iter()
            .any(|b| matches!(b, b'"' | b'&' | b'\'' | b'<' | b'>'));
    };
    // Whole words, then the last eight bytes, which overlap the words already read.
    let (words, _) = s.as_chunks::<8>();
    words.iter().any(|w| special(u64::from_ne_bytes(*w))) || special(u64::from_ne_bytes(*last))
}

#[cfg(test)]
mod tests;
