use serde::{Deserialize, Deserializer, Serialize};

use crate::{TrustedHtml, escape_into};

/// Untrusted text with a few formatting tags: a [`TrustedHtml`] for `v-html` that needs no
/// sanitiser.
///
/// [`BasicHtml::new`] never parses the input as HTML. It escapes every character, as
/// [`escape_into`] does, except for these tags written exactly so, in lower case and with no
/// attributes or spaces: `<b>`, `<i>`, `<em>`, `<strong>`, `<code>`, `<br>`, `<p>`, `<ul>`, `<ol>`
/// and `<li>`, and their end tags (`<br>` has none). Those it writes as tags, kept in an order a
/// browser reads back as written:
///
/// - an element left open is closed where its parent ends, or at the end;
/// - an end tag with no open element of its name is left out;
/// - `<p>`, `<ul>` and `<ol>` close an open `<p>` and the formatting elements around them first;
/// - `<li>` closes what is open inside the nearest list, and stays text outside a list;
/// - past 32 elements deep, a start tag stays text.
///
/// Character references (`&amp;`, `&#60;`, `&eacute;`) are kept: they only ever write text. A
/// lone `&` is escaped, NUL characters are left out, and `\r\n` and `\r` become `\n`, as a browser
/// reads them. Building again from the result gives the same result, so deserialising one, which
/// builds it again with [`BasicHtml::new`], reads back what was serialised.
///
/// It serialises as the string, so an island's `data-props` carries exactly the HTML the server
/// wrote. Name it as the `trustedHtml` type in `ferrovue.config.json`:
///
/// ```json
/// { "trustedHtml": "ferrovue::BasicHtml" }
/// ```
///
/// # Example
///
/// ```
/// use ferrovue::BasicHtml;
///
/// let html = BasicHtml::new(r#"<b>Bold</b>, <B>not</B>, <b onclick="x()">nor this</b><p>open"#);
/// assert_eq!(
///     html.as_str(),
///     "<b>Bold</b>, &lt;B&gt;not&lt;/B&gt;, &lt;b onclick=&quot;x()&quot;&gt;nor this<p>open</p>"
/// );
///
/// let text = BasicHtml::from_text("Dear <you>,\nhello.\n\nBye & thanks");
/// assert_eq!(text.as_str(), "<p>Dear &lt;you&gt;,<br>hello.</p><p>Bye &amp; thanks</p>");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct BasicHtml(String);

impl BasicHtml {
    /// The tags [`BasicHtml::new`] writes as tags.
    pub const TAGS: [&str; 10] = [
        "b", "i", "em", "strong", "code", "br", "p", "ul", "ol", "li",
    ];

    /// `untrusted`, escaped but for the tags in [`BasicHtml::TAGS`], balanced.
    pub fn new(untrusted: &str) -> Self {
        let mut html = Builder::default();
        let mut rest = untrusted;
        while let Some(at) = rest.find(['<', '&', '\0', '\r']) {
            escape_into(&mut html.out, &rest[..at]);
            rest = &rest[at..];
            let taken = match rest.as_bytes()[0] {
                b'<' => html.tag(rest),
                b'&' => html.reference(rest),
                b'\r' => html.line_break(rest),
                _ => 1,
            };
            rest = &rest[taken..];
        }
        escape_into(&mut html.out, rest);
        BasicHtml(html.finish())
    }

    /// Plain text: everything escaped, blank lines between paragraphs, each paragraph a `<p>` and
    /// each line break within one a `<br>`.
    pub fn from_text(text: &str) -> Self {
        let text = text
            .replace('\0', "")
            .replace("\r\n", "\n")
            .replace('\r', "\n");
        let mut out = String::with_capacity(text.len());
        let mut in_paragraph = false;
        for line in text.split('\n') {
            if line.trim().is_empty() {
                if in_paragraph {
                    out.push_str("</p>");
                    in_paragraph = false;
                }
                continue;
            }
            out.push_str(if in_paragraph { "<br>" } else { "<p>" });
            in_paragraph = true;
            escape_into(&mut out, line);
        }
        if in_paragraph {
            out.push_str("</p>");
        }
        BasicHtml(out)
    }

    /// The HTML.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The HTML, as an owned string.
    pub fn into_string(self) -> String {
        self.0
    }
}

impl TrustedHtml for BasicHtml {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for BasicHtml {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let untrusted = String::deserialize(deserializer)?;
        Ok(BasicHtml::new(&untrusted))
    }
}

const MAX_DEPTH: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tag {
    B,
    I,
    Em,
    Strong,
    Code,
    Br,
    P,
    Ul,
    Ol,
    Li,
}

impl Tag {
    fn named(name: &[u8]) -> Option<Tag> {
        Some(match name {
            b"b" => Tag::B,
            b"i" => Tag::I,
            b"em" => Tag::Em,
            b"strong" => Tag::Strong,
            b"code" => Tag::Code,
            b"br" => Tag::Br,
            b"p" => Tag::P,
            b"ul" => Tag::Ul,
            b"ol" => Tag::Ol,
            b"li" => Tag::Li,
            _ => return None,
        })
    }

    fn name(self) -> &'static str {
        match self {
            Tag::B => "b",
            Tag::I => "i",
            Tag::Em => "em",
            Tag::Strong => "strong",
            Tag::Code => "code",
            Tag::Br => "br",
            Tag::P => "p",
            Tag::Ul => "ul",
            Tag::Ol => "ol",
            Tag::Li => "li",
        }
    }

    fn is_formatting(self) -> bool {
        matches!(self, Tag::B | Tag::I | Tag::Em | Tag::Strong | Tag::Code)
    }

    fn is_list(self) -> bool {
        matches!(self, Tag::Ul | Tag::Ol)
    }
}

#[derive(Default)]
struct Builder {
    out: String,
    open: Vec<Tag>,
}

impl Builder {
    fn tag(&mut self, rest: &str) -> usize {
        let bytes = rest.as_bytes();
        let closing = bytes.get(1) == Some(&b'/');
        let name_at = if closing { 2 } else { 1 };
        let tag = bytes[name_at..]
            .iter()
            .take(7)
            .position(|&b| b == b'>')
            .and_then(|len| {
                Some((
                    Tag::named(&bytes[name_at..name_at + len])?,
                    name_at + len + 1,
                ))
            });
        match tag {
            Some((tag, len)) if closing && tag != Tag::Br => {
                self.end(tag);
                len
            }
            Some((tag, len)) if !closing && self.start(tag) => len,
            _ => {
                self.out.push_str("&lt;");
                1
            }
        }
    }

    fn reference(&mut self, rest: &str) -> usize {
        let len = reference_len(rest.as_bytes());
        match len {
            Some(len) => self.out.push_str(&rest[..len]),
            None => self.out.push_str("&amp;"),
        }
        len.unwrap_or(1)
    }

    fn line_break(&mut self, rest: &str) -> usize {
        self.out.push('\n');
        if rest.as_bytes().get(1) == Some(&b'\n') {
            2
        } else {
            1
        }
    }

    fn start(&mut self, tag: Tag) -> bool {
        match tag {
            Tag::Br => {
                self.out.push_str("<br>");
                return true;
            }
            Tag::P | Tag::Ul | Tag::Ol => self.close_while(|t| t.is_formatting() || t == Tag::P),
            Tag::Li if self.open.iter().any(|t| t.is_list()) => {
                self.close_while(|t| !t.is_list());
            }
            Tag::Li => return false,
            _ => {}
        }
        if self.open.len() >= MAX_DEPTH {
            return false;
        }
        self.open.push(tag);
        self.out.push('<');
        self.out.push_str(tag.name());
        self.out.push('>');
        true
    }

    fn end(&mut self, tag: Tag) {
        if self.open.contains(&tag) {
            self.close_while(|t| t != tag);
            self.close_top();
        }
    }

    fn close_while(&mut self, keep_closing: impl Fn(Tag) -> bool) {
        while self.open.last().is_some_and(|&t| keep_closing(t)) {
            self.close_top();
        }
    }

    fn close_top(&mut self) {
        if let Some(tag) = self.open.pop() {
            self.out.push_str("</");
            self.out.push_str(tag.name());
            self.out.push('>');
        }
    }

    fn finish(mut self) -> String {
        self.close_while(|_| true);
        self.out
    }
}

fn reference_len(bytes: &[u8]) -> Option<usize> {
    let (start, max, allowed): (usize, usize, fn(&u8) -> bool) = match bytes.get(1..3) {
        Some([b'#', b'x' | b'X']) => (3, 6, u8::is_ascii_hexdigit),
        Some([b'#', _]) => (2, 7, u8::is_ascii_digit),
        _ if bytes.get(1).is_some_and(u8::is_ascii_alphabetic) => {
            (1, 32, u8::is_ascii_alphanumeric)
        }
        _ => return None,
    };
    let len = bytes
        .get(start..)?
        .iter()
        .take(max + 1)
        .take_while(|b| allowed(b))
        .count();
    (1..=max).contains(&len).then_some(())?;
    (bytes.get(start + len) == Some(&b';')).then_some(start + len + 1)
}

#[cfg(test)]
mod tests;
