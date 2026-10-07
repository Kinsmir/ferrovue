use serde::{Deserialize, Deserializer, Serialize};

use crate::TrustedHtml;

/// HTML cleaned by [ammonia](https://docs.rs/ammonia): a [`TrustedHtml`] for `v-html`, with the
/// `ammonia` feature.
///
/// The only ways to make one run the sanitiser: [`Sanitised::new`] with ammonia's default policy,
/// [`Sanitised::with`] with a policy of your own, and deserialising, which cleans the string with
/// the default policy. Name it as the `trustedHtml` type in `ferrovue.config.json`:
///
/// ```json
/// { "trustedHtml": "ferrovue::Sanitised" }
/// ```
///
/// It serialises as the cleaned string, so an island's `data-props` carries exactly the HTML the
/// server rendered, and the client's `v-html` writes the same string.
///
/// # Example
///
/// ```
/// use ferrovue::{Sanitised, trusted_into};
///
/// let body = Sanitised::new(r#"<p onclick="steal()">Hi <script>alert(1)</script><a href="javascript:x()">you</a></p>"#);
/// assert_eq!(body.as_str(), r#"<p>Hi <a rel="noopener noreferrer">you</a></p>"#);
///
/// let mut out = String::new();
/// trusted_into(&mut out, &body);
/// assert_eq!(out, body.as_str());
/// assert_eq!(serde_json::to_string(&body).unwrap(), r#""<p>Hi <a rel=\"noopener noreferrer\">you</a></p>""#);
///
/// let mut policy = ferrovue::ammonia::Builder::empty();
/// policy.add_tags(["em"]);
/// assert_eq!(Sanitised::with(&policy, "<p><em>only</em> this</p>").as_str(), "<em>only</em> this");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct Sanitised(String);

impl Sanitised {
    /// `untrusted`, cleaned with ammonia's default policy.
    #[must_use]
    pub fn new(untrusted: &str) -> Self {
        Sanitised(ammonia::clean(untrusted))
    }

    /// `untrusted`, cleaned with `policy`.
    #[must_use]
    pub fn with(policy: &ammonia::Builder<'_>, untrusted: &str) -> Self {
        Sanitised(policy.clean(untrusted).to_string())
    }

    /// The cleaned HTML.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The cleaned HTML, as an owned string.
    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }
}

impl TrustedHtml for Sanitised {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for Sanitised {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let untrusted = String::deserialize(deserializer)?;
        Ok(Sanitised::new(&untrusted))
    }
}

#[cfg(test)]
mod tests;
