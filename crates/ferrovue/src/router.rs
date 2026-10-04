//! Vue Router's location matching, for `<RouterLink>` on the server.
//!
//! A link renders differently when it points where the reader already is: `aria-current="page"`
//! and the `router-link-active router-link-exact-active` classes. Deciding that means resolving the
//! link the way the client's router will, so this is vue-router's own algorithm — `parseURL`,
//! `resolveRelativePath`, the path parser's scores and its regular expression, `decode` — for the
//! path syntax ferrovue accepts: static segments, `:name`, and a final `:name(.*)`. The routes are
//! flat (no nesting), which is what makes "active" and "exactly active" the same test: the same
//! route, with the same parameters.
//!
//! `tests/vectors/router.json` holds the cases both this and the real vue-router are run against.

/// The routes, in the order vue-router tries them.
pub struct Router {
    routes: Vec<Pattern>,
    /// What every `href` starts with: the history's base, normalised as vue-router normalises it.
    base: String,
}

struct Pattern {
    tokens: Vec<Token>,
    /// One score per segment, as vue-router computes it for a non-strict, case-insensitive path.
    score: Vec<i32>,
    /// The route's `name`, which a `<RouterLink :to="{ name }">` resolves by.
    name: Option<String>,
}

enum Token {
    Static(String),
    Param { name: String, wildcard: bool },
}

const ROOT: i32 = 90;
const STATIC: i32 = 80;
const PARAM: i32 = 60;
/// `:name(.*)`: a parameter (60) with a custom pattern (+10) that is the wildcard (−50).
const WILDCARD: i32 = 20;

impl Router {
    /// A router over these paths, written as vue-router writes them: `/users/:id`,
    /// `/docs/:section/:page(.*)`.
    ///
    /// # Panics
    ///
    /// On a path outside the syntax described at the top of this module. The paths are part of the
    /// program, so this is a programming error, found the first time the router is built.
    pub fn new(paths: &[&str]) -> Router {
        Router::named(&paths.iter().map(|p| (*p, None)).collect::<Vec<_>>())
    }

    /// A router over these routes, each a path and, if it has one, its name.
    ///
    /// # Panics
    ///
    /// As [`Router::new`] does, and on two routes with the same name.
    pub fn named(routes: &[(&str, Option<&str>)]) -> Router {
        let mut patterns: Vec<Pattern> = routes
            .iter()
            .map(|(path, name)| Pattern::new(path, name.map(str::to_owned)))
            .collect();
        for (i, a) in patterns.iter().enumerate() {
            if let Some(name) = &a.name {
                let again = patterns[i + 1..]
                    .iter()
                    .any(|b| b.name.as_ref() == Some(name));
                assert!(!again, "two routes are called {name:?}");
            }
        }
        // Stable, so routes that score the same keep the order they were given in, as vue-router's
        // insertion does.
        patterns.sort_by(|a, b| compare(&a.score, &b.score));
        Router {
            routes: patterns,
            base: String::new(),
        }
    }

    /// The same routes under a base path, as `createWebHistory(base)` serves them: every `href`
    /// starts with it. `/app/` and `app` both mean `/app`.
    pub fn with_base(mut self, base: &str) -> Router {
        let mut b = if base.is_empty() || base.starts_with('/') || base.starts_with('#') {
            base.to_owned()
        } else {
            format!("/{base}")
        };
        if b.ends_with('/') {
            b.pop();
        }
        // `createHref`: in a hash history only what follows the `#` is kept.
        if let Some(i) = b.find('#')
            && i > 0
        {
            b = b[i..].to_owned();
        }
        self.base = b;
        self
    }

    /// The reader's location: a path, with any query and hash.
    pub fn at(&self, location: &str) -> Route<'_> {
        let (path, _) = parse_url(location, "/");
        let hash = location
            .find('#')
            .map_or_else(String::new, |h| decode(&location[h..]));
        Route {
            router: self,
            matched: self.matched(&path),
            path,
            hash,
        }
    }

    /// The route a path resolves to, and its parameters, decoded.
    fn matched(&self, path: &str) -> Option<(usize, Vec<String>)> {
        self.routes
            .iter()
            .enumerate()
            .find_map(|(i, r)| r.parse(path).map(|params| (i, params)))
    }
}

/// Where the reader is, which is what every link on the page is compared with.
pub struct Route<'r> {
    router: &'r Router,
    path: String,
    /// `route.hash`: the location's hash, `#` included, decoded.
    hash: String,
    matched: Option<(usize, Vec<String>)>,
}

/// A `<RouterLink>`'s `to`, resolved.
pub struct Link {
    /// What the anchor's `href` is.
    pub href: String,
    /// Whether it points at the route the reader is on.
    pub active: bool,
}

impl Route<'_> {
    /// The location's path, without its query or hash.
    pub fn path(&self) -> &str {
        &self.path
    }

    /// `route.hash`: the location's hash, with its `#`, decoded; empty when there is none.
    pub fn hash(&self) -> &str {
        &self.hash
    }

    /// `route.name`: the name of the route the location matched, if it has one.
    pub fn name(&self) -> Option<&str> {
        let (i, _) = self.matched.as_ref()?;
        self.router.routes[*i].name.as_deref()
    }

    /// `route.params.<name>`: that parameter of the route the location matched, decoded; `None`
    /// when the route has no such parameter, or the location matched no route.
    pub fn param(&self, name: &str) -> Option<&str> {
        let (i, values) = self.matched.as_ref()?;
        let at = self.router.routes[*i]
            .tokens
            .iter()
            .filter_map(|t| match t {
                Token::Param { name, .. } => Some(name.as_str()),
                Token::Static(_) => None,
            })
            .position(|n| n == name)?;
        values.get(at).map(String::as_str)
    }

    /// Resolve a link from here.
    pub fn link(&self, to: &str) -> Link {
        let (path, full) = parse_url(to, &self.path);
        let matched = self.router.matched(&path);
        Link {
            href: format!("{}{full}", self.router.base),
            active: matched.is_some() && matched == self.matched,
        }
    }

    /// Resolve `{ name, params, query, hash }`: the named route's path with each parameter
    /// encoded, then `search` (a query [`query_into`] built, without its `?`) and `hash`.
    ///
    /// # Panics
    ///
    /// On a name no route has. The compiler checks the names a template uses against the routes.
    pub fn link_named(
        &self,
        name: &str,
        params: &[(&str, &str)],
        search: &str,
        hash: &str,
    ) -> Link {
        let i = self
            .router
            .routes
            .iter()
            .position(|r| r.name.as_deref() == Some(name))
            .unwrap_or_else(|| panic!("no route is called {name:?}"));
        let route = &self.router.routes[i];
        let mut path = String::new();
        let mut values = Vec::new();
        for token in &route.tokens {
            path.push('/');
            match token {
                Token::Static(text) => path.push_str(text),
                Token::Param { name, .. } => {
                    // An absent parameter is an error in vue-router; it writes nothing here.
                    let value = params
                        .iter()
                        .find(|(k, _)| k == name)
                        .map_or("", |(_, v)| v);
                    let encoded = encode_param(value);
                    values.push(decode(&encoded));
                    path.push_str(&encoded);
                }
            }
        }
        if path.is_empty() {
            path.push('/');
        }
        let matched = Some((i, values));
        Link {
            href: self.href(&path, search, hash),
            active: matched == self.matched,
        }
    }

    /// Resolve `{ path, query, hash }`: the path resolved from here, as a string `to` would be,
    /// then `search` and `hash`.
    pub fn link_path(&self, path: &str, search: &str, hash: &str) -> Link {
        let (path, _) = parse_url(path, &self.path);
        let matched = self.router.matched(&path);
        Link {
            href: self.href(&path, search, hash),
            active: matched.is_some() && matched == self.matched,
        }
    }

    /// `stringifyURL`, then `createHref`.
    fn href(&self, path: &str, search: &str, hash: &str) -> String {
        let mut href = format!("{}{path}", self.router.base);
        if !search.is_empty() {
            href.push('?');
            href.push_str(search);
        }
        href.push_str(&encode_url(hash, Part::Hash));
        href
    }
}

/// `stringifyQuery`, one key and value at a time: `key=value`, each encoded as vue-router encodes
/// them, after a `&` when `search` already holds a pair.
pub fn query_into(search: &mut String, key: &str, value: &str) {
    if !search.is_empty() {
        search.push('&');
    }
    search.push_str(&encode_url(key, Part::QueryKey));
    search.push('=');
    search.push_str(&encode_url(value, Part::QueryValue));
}

/// The part of a URL a string is encoded for, each with vue-router's own rules.
#[derive(Clone, Copy, PartialEq)]
enum Part {
    /// `encodeParam`: a path parameter, whose `/` is encoded too.
    Param,
    /// `encodeQueryValue`: a space is `+`, and `+`, `#` and `&` are encoded.
    QueryValue,
    /// `encodeQueryKey`: as a value, and `=` encoded.
    QueryKey,
    /// `encodeHash`.
    Hash,
}

fn encode_param(text: &str) -> String {
    encode_url(text, Part::Param)
}

/// `encodeURI`, then the characters vue-router puts back or encodes as well for `part`.
fn encode_url(text: &str, part: Part) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        // What `encodeURI` leaves alone, and what `commonEncode` puts back: `|`, `[` and `]`.
        let uri = c.is_ascii_alphanumeric() || ";,/?:@&=+$-_.!~*'()#|[]".contains(c);
        let keep = match (part, c) {
            (Part::Param, '#' | '?' | '/') => false,
            (Part::QueryValue | Part::QueryKey, '+' | '#' | '&') => false,
            (Part::QueryKey, '=') => false,
            (Part::QueryValue | Part::QueryKey, ' ') => {
                out.push('+');
                continue;
            }
            (Part::QueryValue | Part::QueryKey, '`' | '{' | '}' | '^') => true,
            (Part::Hash, '{' | '}' | '^') => true,
            _ => uri,
        };
        if keep {
            out.push(c);
        } else {
            let mut buf = [0; 4];
            for b in c.encode_utf8(&mut buf).bytes() {
                let _ = write!(out, "%{b:02X}");
            }
        }
    }
    out
}

impl Pattern {
    fn new(path: &str, name: Option<String>) -> Pattern {
        let Some(rest) = path.strip_prefix('/') else {
            panic!("a route path starts with `/`: {path:?}");
        };
        if rest.is_empty() {
            return Pattern {
                tokens: Vec::new(),
                score: vec![ROOT],
                name,
            };
        }
        let segments: Vec<&str> = rest.split('/').collect();
        let mut tokens = Vec::new();
        let mut score = Vec::new();
        for (i, seg) in segments.iter().enumerate() {
            if let Some(param) = seg.strip_prefix(':') {
                let (name, wildcard) = match param.strip_suffix("(.*)") {
                    Some(name) => (name, true),
                    None => (param, false),
                };
                let named = !name.is_empty()
                    && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
                assert!(named, "a parameter is `:name` or `:name(.*)`: {path:?}");
                assert!(
                    !wildcard || i == segments.len() - 1,
                    "`(.*)` is supported on the last segment only: {path:?}"
                );
                tokens.push(Token::Param {
                    name: name.to_owned(),
                    wildcard,
                });
                score.push(if wildcard { WILDCARD } else { PARAM });
            } else {
                let plain = !seg.is_empty()
                    && seg.is_ascii()
                    && !seg.contains([':', '(', ')', '*', '?', '+', '\\']);
                assert!(plain, "a static segment is plain ASCII text: {path:?}");
                tokens.push(Token::Static((*seg).to_owned()));
                score.push(STATIC);
            }
        }
        Pattern {
            tokens,
            score,
            name,
        }
    }

    /// The pattern's regular expression, `^(/static|/([^/]+?)|/(.*))*/?$` with the `i` flag, run
    /// by hand: each parameter's extent is forced by the `/` or end that must follow it.
    fn parse(&self, path: &str) -> Option<Vec<String>> {
        let mut rest = path;
        let mut params = Vec::new();
        for token in &self.tokens {
            rest = rest.strip_prefix('/')?;
            match token {
                Token::Static(text) => {
                    let head = rest.get(..text.len())?;
                    if !head.eq_ignore_ascii_case(text) {
                        return None;
                    }
                    rest = &rest[text.len()..];
                }
                Token::Param {
                    wildcard: false, ..
                } => {
                    let end = rest.find('/').unwrap_or(rest.len());
                    if end == 0 {
                        return None;
                    }
                    params.push(decode(&rest[..end]));
                    rest = &rest[end..];
                }
                Token::Param { wildcard: true, .. } => {
                    // `.` stops at a line terminator, and `$` is the end of the input alone.
                    if rest.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
                        return None;
                    }
                    params.push(decode(rest));
                    rest = "";
                }
            }
        }
        matches!(rest, "" | "/").then_some(params)
    }
}

/// `comparePathParserScore`, for patterns of one token per segment and no negative scores: the
/// higher score first, segment by segment, then the longer pattern.
fn compare(a: &[i32], b: &[i32]) -> std::cmp::Ordering {
    for (x, y) in a.iter().zip(b) {
        if x != y {
            return y.cmp(x);
        }
    }
    b.len().cmp(&a.len())
}

/// `parseURL`: the path, resolved against `current`, and the full location — path, query and hash
/// exactly as written.
fn parse_url(location: &str, current: &str) -> (String, String) {
    let hash_pos = location.find('#');
    let search_pos = location
        .find('?')
        .filter(|&s| hash_pos.is_none_or(|h| s < h));
    let mut path: Option<&str> = None;
    let mut search = "";
    let mut hash = "";
    if let Some(s) = search_pos {
        path = Some(&location[..s]);
        let end = hash_pos.filter(|&h| h > 0).unwrap_or(location.len());
        search = &location[s..end];
    }
    if let Some(h) = hash_pos {
        // `path || …`: an empty path is falsy too.
        path = Some(path.filter(|p| !p.is_empty()).unwrap_or(&location[..h]));
        hash = &location[h..];
    }
    let path = resolve_relative_path(path.unwrap_or(location), current);
    let full = format!("{path}{search}{hash}");
    (path, full)
}

/// `resolveRelativePath`, for an absolute `from`.
fn resolve_relative_path(to: &str, from: &str) -> String {
    if to.starts_with('/') {
        return to.to_owned();
    }
    if to.is_empty() {
        return from.to_owned();
    }
    let from_segments: Vec<&str> = from.split('/').collect();
    let mut to_segments: Vec<&str> = to.split('/').collect();
    if matches!(to_segments.last(), Some(&("." | ".."))) {
        to_segments.push("");
    }
    let mut position = from_segments.len() - 1;
    let mut to_position = 0;
    while to_position < to_segments.len() {
        match to_segments[to_position] {
            "." => {}
            ".." => {
                if position > 1 {
                    position -= 1;
                }
            }
            _ => break,
        }
        to_position += 1;
    }
    format!(
        "{}/{}",
        from_segments[..position].join("/"),
        to_segments[to_position..].join("/")
    )
}

/// `decode`: `decodeURIComponent`, or the text as it is when that throws — on a `%` not followed by
/// two hex digits, or escapes that are not UTF-8.
fn decode(text: &str) -> String {
    if !text.contains('%') {
        return text.to_owned();
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = |b: u8| (b as char).to_digit(16);
            match (
                bytes.get(i + 1).and_then(|&b| hex(b)),
                bytes.get(i + 2).and_then(|&b| hex(b)),
            ) {
                (Some(hi), Some(lo)) => {
                    out.push((hi * 16 + lo) as u8);
                    i += 3;
                    continue;
                }
                _ => return text.to_owned(),
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_owned())
}

#[cfg(test)]
mod tests;
