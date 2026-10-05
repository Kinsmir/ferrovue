use super::*;

struct Sanitised(&'static str);

impl TrustedHtml for Sanitised {
    fn trusted_html(&self) -> &str {
        self.0
    }
}

#[test]
fn trusted_html_is_written_as_it_is() {
    let mut out = String::new();
    trusted_into(&mut out, &Sanitised("<p>a &amp; <em>b</em></p>"));
    assert_eq!(out, "<p>a &amp; <em>b</em></p>");
}
