use crate::url::{decode, decodes_to};
use crate::{Route, Router};

pub(crate) struct Pattern {
    pub(crate) path: String,
    pub(crate) parent: Option<usize>,
    pub(crate) tokens: Vec<Token>,
    pub(crate) score: Vec<i32>,
    pub(crate) name: Option<String>,
    pub(crate) matchable: bool,
    pub(crate) seq: usize,
}

pub(crate) enum Token {
    Static(String),
    Param {
        name: String,
        wildcard: bool,
        optional: bool,
    },
}

pub(crate) type Values = Vec<Option<String>>;

pub(crate) const SPANS: usize = 8;

pub(crate) struct Spans<'p> {
    pub(crate) at: [Option<&'p str>; SPANS],
    pub(crate) len: usize,
}

pub(crate) trait Captures<'p> {
    fn push(&mut self, raw: Option<&'p str>);
    fn pop(&mut self);
}

impl Captures<'_> for Values {
    fn push(&mut self, raw: Option<&str>) {
        Vec::push(self, raw.map(decode));
    }

    fn pop(&mut self) {
        Vec::pop(self);
    }
}

impl<'p> Captures<'p> for Spans<'p> {
    fn push(&mut self, raw: Option<&'p str>) {
        self.at[self.len] = raw;
        self.len += 1;
    }

    fn pop(&mut self) {
        self.len -= 1;
    }
}

pub(crate) trait Captured {
    fn given(&self) -> Option<&str>;
    fn same(given: &str, here: &str) -> bool;
}

impl Captured for Option<String> {
    fn given(&self) -> Option<&str> {
        self.as_deref()
    }

    fn same(given: &str, here: &str) -> bool {
        given == here
    }
}

impl Captured for Option<&str> {
    fn given(&self) -> Option<&str> {
        *self
    }

    fn same(given: &str, here: &str) -> bool {
        decodes_to(given, here)
    }
}

pub(crate) const ROOT: i32 = 9000;
pub(crate) const STATIC: i32 = 8000;
pub(crate) const PARAM: i32 = 6000;
pub(crate) const OPTIONAL: i32 = 5200;
pub(crate) const WILDCARD: i32 = 2000;
pub(crate) const STRICT: i32 = 70;

impl Router {
    pub(crate) fn up(&self, mut from: usize, to: usize) -> Option<usize> {
        let mut steps = 0;
        loop {
            if from == to {
                return Some(steps);
            }
            from = self.routes[from].parent?;
            steps += 1;
        }
    }

    pub(crate) fn params<'a>(
        &'a self,
        i: usize,
        values: &'a [Option<String>],
    ) -> Vec<(&'a str, &'a str)> {
        self.routes[i]
            .names()
            .zip(values)
            .filter_map(|(name, value)| Some((name, value.as_deref()?)))
            .collect()
    }

    pub(crate) fn matched(&self, path: &str) -> Option<(usize, Values)> {
        match (self.strict, self.sensitive) {
            (false, false) => self.matched_as::<false, false>(path),
            (true, false) => self.matched_as::<true, false>(path),
            (false, true) => self.matched_as::<false, true>(path),
            (true, true) => self.matched_as::<true, true>(path),
        }
    }

    fn matched_as<const STRICT: bool, const SENSITIVE: bool>(
        &self,
        path: &str,
    ) -> Option<(usize, Values)> {
        self.routes
            .iter()
            .enumerate()
            .filter(|(_, r)| r.matchable)
            .find_map(|(i, r)| {
                let mut params = Vec::new();
                r.parse_from::<_, STRICT, SENSITIVE>(&r.tokens, path, &mut params)
                    .then_some((i, params))
            })
    }

    pub(crate) fn matched_spans<'p>(&self, path: &'p str) -> Option<(usize, Spans<'p>)> {
        match (self.strict, self.sensitive) {
            (false, false) => self.spans_as::<false, false>(path),
            (true, false) => self.spans_as::<true, false>(path),
            (false, true) => self.spans_as::<false, true>(path),
            (true, true) => self.spans_as::<true, true>(path),
        }
    }

    fn spans_as<'p, const STRICT: bool, const SENSITIVE: bool>(
        &self,
        path: &'p str,
    ) -> Option<(usize, Spans<'p>)> {
        self.routes
            .iter()
            .enumerate()
            .filter(|(_, r)| r.matchable)
            .find_map(|(i, r)| {
                let mut spans = Spans {
                    at: [None; SPANS],
                    len: 0,
                };
                r.parse_from::<_, STRICT, SENSITIVE>(&r.tokens, path, &mut spans)
                    .then_some((i, spans))
            })
    }
}

impl Route<'_> {
    pub(crate) fn state<V: Captured>(&self, target: Option<(usize, &[V])>) -> (bool, bool) {
        let (Some((t, link_values)), Some((c, here_values))) = (target, self.matched.as_ref())
        else {
            return (false, false);
        };
        let router = self.router;
        let c = *c;
        let up = router.up(c, t).or_else(|| {
            let parent = router.routes[t].parent?;
            let parent_path = &router.routes[parent].path;
            let nested =
                router.routes[t].path == *parent_path && router.routes[c].path != *parent_path;
            nested.then(|| router.up(c, parent)).flatten()
        });
        let Some(up) = up else {
            return (false, false);
        };
        let here = || {
            router.routes[c]
                .names()
                .zip(here_values)
                .filter_map(|(name, value)| Some((name, value.as_deref()?)))
        };
        let mut given = 0;
        for (k, v) in router.routes[t].names().zip(link_values) {
            let Some(v) = v.given() else {
                continue;
            };
            given += 1;
            if !here().any(|(hk, hv)| hk == k && V::same(v, hv)) {
                return (false, false);
            }
        }
        (true, up == 0 && given == here().count())
    }
}

impl Pattern {
    pub(crate) fn names(&self) -> impl Iterator<Item = &str> {
        self.tokens.iter().filter_map(|t| match t {
            Token::Param { name, .. } => Some(name.as_str()),
            Token::Static(_) => None,
        })
    }

    pub(crate) fn new(path: &str, name: Option<String>) -> Pattern {
        let Some(rest) = path.strip_prefix('/') else {
            panic!("a route path starts with `/`: {path:?}");
        };
        let segments: Vec<&str> = if rest.is_empty() {
            Vec::new()
        } else {
            rest.split('/').collect()
        };
        let mut tokens = Vec::new();
        for (i, seg) in segments.iter().enumerate() {
            if let Some(param) = seg.strip_prefix(':') {
                let (param, optional) = match param.strip_suffix('?') {
                    Some(param) => (param, true),
                    None => (param, false),
                };
                let (name, wildcard) = match param.strip_suffix("(.*)") {
                    Some(name) => (name, true),
                    None => (param, false),
                };
                let named = !name.is_empty()
                    && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
                    && !(wildcard && optional);
                assert!(
                    named,
                    "a parameter is `:name`, `:name?` or `:name(.*)`: {path:?}"
                );
                assert!(
                    !wildcard || i == segments.len() - 1,
                    "`(.*)` is supported on the last segment only: {path:?}"
                );
                tokens.push(Token::Param {
                    name: name.to_owned(),
                    wildcard,
                    optional,
                });
            } else {
                let plain = !seg.is_empty()
                    && seg.is_ascii()
                    && !seg.contains([':', '(', ')', '*', '?', '+', '\\']);
                assert!(plain, "a static segment is plain ASCII text: {path:?}");
                tokens.push(Token::Static((*seg).to_owned()));
            }
        }
        let mut pattern = Pattern {
            path: path.to_owned(),
            parent: None,
            tokens,
            score: Vec::new(),
            name,
            matchable: true,
            seq: 0,
        };
        pattern.rescore(false);
        pattern
    }

    pub(crate) fn rescore(&mut self, strict: bool) {
        self.score = if self.tokens.is_empty() {
            vec![ROOT]
        } else {
            self.tokens
                .iter()
                .map(|t| match t {
                    Token::Static(_) => STATIC,
                    Token::Param { wildcard: true, .. } => WILDCARD,
                    Token::Param { optional: true, .. } => OPTIONAL,
                    Token::Param { .. } => PARAM,
                })
                .collect()
        };
        if strict && let Some(last) = self.score.last_mut() {
            *last += STRICT;
        }
    }

    pub(crate) fn parse_from<'p, C: Captures<'p>, const STRICT: bool, const SENSITIVE: bool>(
        &self,
        tokens: &[Token],
        rest: &'p str,
        params: &mut C,
    ) -> bool {
        let Some((token, after)) = tokens.split_first() else {
            if !STRICT {
                return matches!(rest, "" | "/") || (self.tokens.is_empty() && rest == "//");
            }
            return rest == if self.tokens.is_empty() { "/" } else { "" };
        };
        match token {
            Token::Static(text) => {
                let Some(rest) = rest.strip_prefix('/') else {
                    return false;
                };
                match rest.get(..text.len()) {
                    Some(head)
                        if if SENSITIVE {
                            head == text
                        } else {
                            head.eq_ignore_ascii_case(text)
                        } =>
                    {
                        self.parse_from::<C, STRICT, SENSITIVE>(after, &rest[text.len()..], params)
                    }
                    _ => false,
                }
            }
            Token::Param {
                wildcard: false,
                optional,
                ..
            } => {
                if let Some(inner) = rest.strip_prefix('/') {
                    let end = inner.find('/').unwrap_or(inner.len());
                    if end > 0 {
                        params.push(Some(&inner[..end]));
                        if self.parse_from::<C, STRICT, SENSITIVE>(after, &inner[end..], params) {
                            return true;
                        }
                        params.pop();
                    }
                }
                if *optional {
                    params.push(None);
                    if self.parse_from::<C, STRICT, SENSITIVE>(after, rest, params) {
                        return true;
                    }
                    params.pop();
                }
                false
            }
            Token::Param { wildcard: true, .. } => {
                let Some(rest) = rest.strip_prefix('/') else {
                    return false;
                };
                if rest.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
                    return false;
                }
                params.push(Some(rest));
                self.parse_from::<C, STRICT, SENSITIVE>(after, "", params)
            }
        }
    }
}

pub(crate) fn compare(a: &[i32], b: &[i32]) -> std::cmp::Ordering {
    for (x, y) in a.iter().zip(b) {
        if x != y {
            return y.cmp(x);
        }
    }
    b.len().cmp(&a.len())
}
