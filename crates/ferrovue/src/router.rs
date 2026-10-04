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
    /// The full path, its ancestors' included, as vue-router normalises a nested record's.
    path: String,
    /// The route it is nested in, as an index into `Router::routes`.
    parent: Option<usize>,
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
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::Router;
    ///
    /// let router = Router::named(&[("/", Some("home")), ("/users/:id", Some("user"))]).with_base("/app/");
    /// let route = router.at("/users/7?tab=posts#bio");
    /// assert_eq!(route.param("id"), Some("7"));
    /// assert_eq!(route.name(), Some("user"));
    /// assert_eq!(route.hash(), "#bio");
    ///
    /// let link = route.link_named("user", &[("id", "7")], "", "");
    /// assert_eq!(link.href, "/app/users/7");
    /// assert!(link.active);
    /// ```
    pub fn named(routes: &[(&str, Option<&str>)]) -> Router {
        let defs: Vec<RouteDef<'_>> = routes
            .iter()
            .map(|(path, name)| RouteDef {
                path,
                name: *name,
                children: &[],
            })
            .collect();
        Router::tree(&defs)
    }

    /// A router over nested routes: each child's path is joined to its parent's, unless it starts
    /// with `/`, and an empty one is its parent's own, its default child.
    ///
    /// # Panics
    ///
    /// As [`Router::named`] does.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::{RouteDef, Router};
    ///
    /// let router = Router::tree(&[RouteDef {
    ///     path: "/users/:id",
    ///     name: Some("user"),
    ///     children: &[RouteDef { path: "posts", name: Some("user-posts"), children: &[] }],
    /// }]);
    /// let here = router.at("/users/7/posts");
    /// let parent = here.link("/users/7");
    /// // The parent is active on its child's page, but not exactly.
    /// assert!(parent.active && !parent.exact);
    /// ```
    pub fn tree(defs: &[RouteDef<'_>]) -> Router {
        // Every record, parents before their children, as vue-router adds them.
        fn add(defs: &[RouteDef<'_>], parent: Option<usize>, records: &mut Vec<Pattern>) {
            for d in defs {
                let path = match parent {
                    Some(p) if !d.path.starts_with('/') => {
                        let parent_path = &records[p].path;
                        let slash = if parent_path.ends_with('/') || d.path.is_empty() {
                            ""
                        } else {
                            "/"
                        };
                        format!("{parent_path}{slash}{}", d.path)
                    }
                    _ => d.path.to_owned(),
                };
                let mut pattern = Pattern::new(&path, d.name.map(str::to_owned));
                pattern.parent = parent;
                records.push(pattern);
                let me = records.len() - 1;
                add(d.children, Some(me), records);
            }
        }
        let mut records: Vec<Pattern> = Vec::new();
        add(defs, None, &mut records);
        for (i, a) in records.iter().enumerate() {
            if let Some(name) = &a.name {
                let again = records[i + 1..]
                    .iter()
                    .any(|b| b.name.as_ref() == Some(name));
                assert!(!again, "two routes are called {name:?}");
            }
        }
        // `findInsertionIndex`: after every record that scores as well, but before an ancestor that
        // scores the same — so a default child is tried before its parent.
        let mut order: Vec<usize> = Vec::new();
        for i in 0..records.len() {
            let (mut lower, mut upper) = (0, order.len());
            while lower != upper {
                let mid = (lower + upper) / 2;
                if compare(&records[i].score, &records[order[mid]].score)
                    == std::cmp::Ordering::Less
                {
                    upper = mid;
                } else {
                    lower = mid + 1;
                }
            }
            let mut ancestor = records[i].parent;
            while let Some(a) = ancestor {
                if compare(&records[i].score, &records[a].score) == std::cmp::Ordering::Equal {
                    if let Some(at) = order[..upper].iter().rposition(|&x| x == a) {
                        upper = at;
                    }
                    break;
                }
                ancestor = records[a].parent;
            }
            order.insert(upper, i);
        }
        let mut position = vec![0; records.len()];
        for (at, &i) in order.iter().enumerate() {
            position[i] = at;
        }
        let mut slots: Vec<Option<Pattern>> = records.into_iter().map(Some).collect();
        let routes = order
            .iter()
            .map(|&i| {
                let mut p = slots[i].take().expect("each record once");
                p.parent = p.parent.map(|parent| position[parent]);
                p
            })
            .collect();
        Router {
            routes,
            base: String::new(),
        }
    }

    /// A route and the routes it is nested in, outermost first: what `route.matched` holds.
    fn chain(&self, mut i: usize) -> Vec<usize> {
        let mut chain = vec![i];
        while let Some(p) = self.routes[i].parent {
            chain.push(p);
            i = p;
        }
        chain.reverse();
        chain
    }

    /// A matched route's parameters by name.
    fn params<'a>(&'a self, i: usize, values: &'a [String]) -> Vec<(&'a str, &'a str)> {
        self.routes[i]
            .tokens
            .iter()
            .filter_map(|t| match t {
                Token::Param { name, .. } => Some(name.as_str()),
                Token::Static(_) => None,
            })
            .zip(values.iter().map(String::as_str))
            .collect()
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
        let (path, full_path) = parse_url(location, "/");
        let hash_pos = location.find('#');
        let hash = hash_pos.map_or_else(String::new, |h| decode(&location[h..]));
        // `parseURL`'s search: from the `?` to the hash, when the `?` comes first.
        let search = location
            .find('?')
            .filter(|&s| hash_pos.is_none_or(|h| s < h))
            .map_or("", |s| {
                &location[s + 1..hash_pos.filter(|&h| h > 0).unwrap_or(location.len())]
            });
        Route {
            router: self,
            matched: self.matched(&path),
            path,
            hash,
            query: parse_query(search),
            full_path,
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

/// A route as the routes file lists it: a path, its name if it has one, and the routes nested in
/// it, rendered by the `<RouterView>` in its component.
#[derive(Clone, Copy, Debug)]
pub struct RouteDef<'a> {
    /// The path, relative to the parent's unless it starts with `/`; empty for a default child.
    pub path: &'a str,
    /// The route's name.
    pub name: Option<&'a str>,
    /// The routes nested in it.
    pub children: &'a [RouteDef<'a>],
}

/// Where the reader is, which is what every link on the page is compared with.
pub struct Route<'r> {
    router: &'r Router,
    path: String,
    /// `route.hash`: the location's hash, `#` included, decoded.
    hash: String,
    matched: Option<(usize, Vec<String>)>,
    /// `route.query`: each key with its values, in the order the keys first appear.
    query: Vec<(String, Vec<Option<String>>)>,
    /// `route.fullPath`: the path, then the query and hash as they were written.
    full_path: String,
}

/// One value of `route.query`, as vue-router parses it: a key may be absent, given without a value
/// (`?flag`, which is `null`), given once, or given more than once, which makes an array.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Query<'r> {
    /// No such key: `undefined`.
    Absent,
    /// `?flag`: `null`.
    Null,
    /// `?q=text`, decoded.
    One(&'r str),
    /// `?q=a&q=b`: an array, in which a value written without `=` is `null`.
    Many(&'r [Option<String>]),
}

impl<'r> Query<'r> {
    /// `{{ route.query.q }}`, escaped: nothing for `undefined` and `null`, the text for a string,
    /// and an array as `toDisplayString` writes one — `JSON.stringify(value, null, 2)`.
    pub fn write_display(&self, out: &mut String) {
        match self {
            Query::Absent | Query::Null => {}
            Query::One(s) => crate::escape_into(out, s),
            Query::Many(values) => {
                let mut json = String::from("[\n");
                for (i, v) in values.iter().enumerate() {
                    if i > 0 {
                        json.push_str(",\n");
                    }
                    json.push_str("  ");
                    match v {
                        // A string cannot fail to serialise.
                        Some(s) => json.push_str(&serde_json::to_string(s).unwrap_or_default()),
                        None => json.push_str("null"),
                    }
                }
                json.push_str("\n]");
                crate::escape_into(out, &json);
            }
        }
    }

    /// JavaScript's truthiness: a non-empty string or an array.
    pub fn truthy(&self) -> bool {
        match self {
            Query::One(s) => !s.is_empty(),
            Query::Many(_) => true,
            Query::Absent | Query::Null => false,
        }
    }

    /// `route.query.q === text`: only a single value can equal a string.
    pub fn is(&self, text: &str) -> bool {
        matches!(self, Query::One(s) if *s == text)
    }

    /// `route.query.q === undefined`.
    pub fn is_undefined(&self) -> bool {
        matches!(self, Query::Absent)
    }

    /// `Array.isArray(route.query.q)`.
    pub fn is_array(&self) -> bool {
        matches!(self, Query::Many(_))
    }

    /// `route.query.q ?? fallback`: the fallback for `undefined` and `null`.
    pub fn or<'a>(self, fallback: &'a str) -> Query<'a>
    where
        'r: 'a,
    {
        match self {
            Query::Absent | Query::Null => Query::One(fallback),
            other => other,
        }
    }

    /// The value as an attribute writes it: only a string is written; `null`, `undefined` and an
    /// array leave the attribute out.
    pub fn attr_value(&self) -> Option<&'r str> {
        match self {
            Query::One(s) => Some(s),
            _ => None,
        }
    }
}

/// `parseQuery`: `&`-separated pairs, `+` read as a space, keys and values decoded, a pair without
/// `=` a `null`, a repeated key an array.
fn parse_query(search: &str) -> Vec<(String, Vec<Option<String>>)> {
    let mut query: Vec<(String, Vec<Option<String>>)> = Vec::new();
    if search.is_empty() {
        return query;
    }
    for pair in search.split('&') {
        let pair = pair.replace('+', " ");
        let (key, value) = match pair.find('=') {
            Some(i) => (decode(&pair[..i]), Some(decode(&pair[i + 1..]))),
            None => (decode(&pair), None),
        };
        match query.iter_mut().find(|(k, _)| *k == key) {
            Some((_, values)) => values.push(value),
            None => query.push((key, vec![value])),
        }
    }
    query
}

/// A `<RouterLink>`'s `to`, resolved.
pub struct Link {
    /// What the anchor's `href` is.
    pub href: String,
    /// `isActive`: it points at the route the reader is on, or one the reader's route is nested in,
    /// with parameters the reader's location has too. The `router-link-active` class.
    pub active: bool,
    /// `isExactActive`: it points at exactly the reader's route, with the same parameters. The
    /// `router-link-exact-active` class, and `aria-current`.
    pub exact: bool,
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

    /// `route.query.<key>`.
    pub fn query(&self, key: &str) -> Query<'_> {
        match self.query.iter().find(|(k, _)| k == key) {
            None => Query::Absent,
            Some((_, values)) => match values.as_slice() {
                [None] => Query::Null,
                [Some(v)] => Query::One(v),
                many => Query::Many(many),
            },
        }
    }

    /// `route.fullPath`: the path, then the query and hash as they were written.
    pub fn full_path(&self) -> &str {
        &self.full_path
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
    ///
    /// # Example
    ///
    /// ```
    /// let router = ferrovue::Router::new(&["/", "/blog/:slug"]);
    /// let here = router.at("/blog/intro");
    /// let link = here.link("/blog/intro?sort=new");
    /// assert_eq!(link.href, "/blog/intro?sort=new");
    /// assert!(link.active, "the query does not change which route it is");
    /// assert!(!here.link("/").active);
    /// ```
    pub fn link(&self, to: &str) -> Link {
        let (path, full) = parse_url(to, &self.path);
        let (active, exact) = self.state(self.router.matched(&path));
        Link {
            href: format!("{}{full}", self.router.base),
            active,
            exact,
        }
    }

    /// `useLink`'s `isActive` and `isExactActive` for a link that resolved to `target`.
    fn state(&self, target: Option<(usize, Vec<String>)>) -> (bool, bool) {
        let (Some((t, link_values)), Some((c, here_values))) = (target, self.matched.as_ref())
        else {
            return (false, false);
        };
        let router = self.router;
        let link_chain = router.chain(t);
        let here_chain = router.chain(*c);
        let routed = *link_chain.last().expect("a chain holds its route");
        // `activeRecordIndex`: where the link's route sits among the reader's — or, for a link to a
        // parent through its default child, where that parent sits, unless the reader is on it.
        let mut index = here_chain.iter().position(|&r| r == routed);
        if index.is_none() && link_chain.len() > 1 {
            let parent = link_chain[link_chain.len() - 2];
            let parent_path = &router.routes[parent].path;
            let here_last = *here_chain.last().expect("a chain holds its route");
            if router.routes[routed].path == *parent_path
                && router.routes[here_last].path != *parent_path
            {
                index = here_chain.iter().position(|&r| r == parent);
            }
        }
        let Some(index) = index else {
            return (false, false);
        };
        let link_params = router.params(t, &link_values);
        let here_params = router.params(*c, here_values);
        let includes = link_params
            .iter()
            .all(|(k, v)| here_params.iter().any(|(hk, hv)| hk == k && hv == v));
        let same = includes && link_params.len() == here_params.len();
        (includes, index == here_chain.len() - 1 && same)
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
                    let value = params
                        .iter()
                        .find(|(k, _)| k == name)
                        .map_or("", |(_, v)| v);
                    // vue-router throws on an empty parameter, failing the render: a debug build
                    // fails the same way, and a release build writes the link without it.
                    debug_assert!(
                        !value.is_empty(),
                        "missing required param {name:?} for the route called {:?}",
                        route.name
                    );
                    let encoded = encode_param(value);
                    values.push(decode(&encoded));
                    path.push_str(&encoded);
                }
            }
        }
        if path.is_empty() {
            path.push('/');
        }
        let (active, exact) = self.state(Some((i, values)));
        Link {
            href: self.href(&path, search, hash),
            active,
            exact,
        }
    }

    /// Resolve `{ path, query, hash }`: the path resolved from here, as a string `to` would be,
    /// then `search` and `hash`.
    pub fn link_path(&self, path: &str, search: &str, hash: &str) -> Link {
        let (path, _) = parse_url(path, &self.path);
        let (active, exact) = self.state(self.router.matched(&path));
        Link {
            href: self.href(&path, search, hash),
            active,
            exact,
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
///
/// # Example
///
/// ```
/// let mut search = String::new();
/// ferrovue::query_into(&mut search, "q", "a b&c");
/// ferrovue::query_into(&mut search, "page", "2");
/// assert_eq!(search, "q=a+b%26c&page=2");
/// ```
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
                path: path.to_owned(),
                parent: None,
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
            path: path.to_owned(),
            parent: None,
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
