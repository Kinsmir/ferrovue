//! `v-html`: HTML written as it is, which only a [`TrustedHtml`] value can be.

/// HTML that is safe to write into a page as it is: what `v-html` may render.
///
/// The compiler accepts `v-html` only on a prop declared as `TrustedHtml` (from
/// `ferrovue/types`), and the project's configuration maps that to one Rust type implementing this
/// trait. Implement it only for a type whose every value has already been made safe — the output
/// of a sanitiser, never a string that merely looks fine — because that is the whole of what stands
/// between the value and the page.
///
/// A generated props struct holding the type derives `Debug`, `Clone` and `serde::Serialize`, and
/// `serde::Deserialize` under `cfg(test)`, so the type needs those too;
/// [`guide::escaping`](crate::guide::escaping#v-html-and-trustedhtml) shows a complete one.
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
///
/// Called by generated code for `v-html`; the example on [`TrustedHtml`] shows it.
pub fn trusted_into(out: &mut String, html: &impl TrustedHtml) {
    out.push_str(html.trusted_html());
}

#[cfg(test)]
mod tests;
