use ferrovue_core::escape_into;

pub(super) fn build(untrusted: &str, inline: bool) -> String {
    let mut html = Builder {
        inline,
        ..Builder::default()
    };
    let mut rest = untrusted;
    #[cfg(test)]
    let mut turns = crate::Turns::default();
    while let Some(at) = rest.find(['<', '&', '\0', '\r']) {
        #[cfg(test)]
        turns.next();
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
    html.finish()
}

pub(super) const MAX_DEPTH: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Tag {
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
    pub(super) fn named(name: &[u8]) -> Option<Tag> {
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

    pub(super) fn name(self) -> &'static str {
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

    pub(super) fn is_inline(self) -> bool {
        self.is_formatting() || self == Tag::Br
    }

    fn is_list(self) -> bool {
        matches!(self, Tag::Ul | Tag::Ol)
    }
}

#[derive(Default)]
struct Builder {
    out: String,
    open: Vec<Tag>,
    inline: bool,
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
            })
            .filter(|&(tag, _)| !self.inline || tag.is_inline());
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
        #[cfg(test)]
        let mut turns = crate::Turns::default();
        while self.open.last().is_some_and(|&t| keep_closing(t)) {
            #[cfg(test)]
            turns.next();
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
