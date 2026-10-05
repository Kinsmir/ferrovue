/// HTML that is safe to write into a page as it is: what `v-html` may render.
///
/// Implement it only for a type whose every value has already been made safe: the output of a
/// sanitiser, never a string that merely looks fine. [`BasicHtml`](crate::BasicHtml) and, with the
/// `ammonia` feature, `Sanitised` implement it; the guide's `escaping` page says how to choose.
///
/// # Example
///
/// ```
/// use ferrovue::{trusted_into, TrustedHtml};
///
/// /// HTML a sanitiser produced: the only way to make one is through it.
/// struct Sanitised(String);
///
/// impl Sanitised {
///     fn new(untrusted: &str) -> Self {
///         // A real project calls its sanitiser (ammonia, for example) here.
///         Sanitised(untrusted.replace('<', "&lt;"))
///     }
/// }
///
/// impl TrustedHtml for Sanitised {
///     fn trusted_html(&self) -> &str {
///         &self.0
///     }
/// }
///
/// let mut out = String::new();
/// trusted_into(&mut out, &Sanitised::new("<script>"));
/// assert_eq!(out, "&lt;script>");
/// ```
pub trait TrustedHtml {
    /// The HTML, which is written into the page exactly as it is.
    fn trusted_html(&self) -> &str;
}

/// `v-html`: the value, unescaped. Only a [`TrustedHtml`] can reach it.
pub fn trusted_into(out: &mut String, html: &impl TrustedHtml) {
    out.push_str(html.trusted_html());
}

#[cfg(test)]
mod tests;
