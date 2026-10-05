//! Vue Router's location matching, for `<RouterLink>` and `useRoute()` on the server: part of
//! [ferrovue](https://docs.rs/ferrovue)'s runtime.
//!
//! # Example
//!
//! ```
//! # use ferrovue_router as ferrovue;
//! let router = ferrovue::Router::new(&["/", "/blog/:slug"]);
//! let route = router.at("/blog/hello");
//! let link = route.link("/blog/hello");
//! assert_eq!((link.href.as_str(), link.active, link.exact), ("/blog/hello", true, true));
//! assert!(!route.link("/").active);
//! ```
#![warn(missing_debug_implementations, rustdoc::missing_crate_level_docs)]

/// The routes, in the order vue-router tries them.
///
/// # Example
///
/// ```
/// # use ferrovue_router as ferrovue;
/// use ferrovue::Router;
///
/// let router = Router::new(&["/", "/blog/:slug", "/docs/:path(.*)"]);
/// let route = router.at("/docs/guide/routing");
/// assert_eq!(route.param("path"), Some("guide/routing"));
///
/// // One router serves every request, from any thread.
/// fn shared<T: Send + Sync>(_: &T) {}
/// shared(&router);
/// ```
pub struct Router {
    routes: Vec<Pattern>,
    base: String,
}

/// The base, and each route's full path with its name, in the order vue-router tries them.
///
/// # Example
///
/// ```
/// # use ferrovue_router as ferrovue;
/// let router = ferrovue::Router::named(&[("/", Some("home")), ("/users/:id", None)]).with_base("/app/");
/// assert_eq!(
///     format!("{router:?}"),
///     r#"Router { base: "/app", routes: {"/": Some("home"), "/users/:id": None} }"#
/// );
/// ```
impl std::fmt::Debug for Router {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let routes = self.routes.iter().map(|r| (&r.path, &r.name));
        f.debug_struct("Router")
            .field("base", &self.base)
            .field("routes", &DebugMap(routes))
            .finish()
    }
}

struct DebugMap<I>(I);

impl<K: std::fmt::Debug, V: std::fmt::Debug, I: Iterator<Item = (K, V)> + Clone> std::fmt::Debug
    for DebugMap<I>
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_map().entries(self.0.clone()).finish()
    }
}

struct Pattern {
    path: String,
    parent: Option<usize>,
    tokens: Vec<Token>,
    score: Vec<i32>,
    name: Option<String>,
}

enum Token {
    Static(String),
    Param { name: String, wildcard: bool },
}

const ROOT: i32 = 90;
const STATIC: i32 = 80;
const PARAM: i32 = 60;
const WILDCARD: i32 = 20;

impl Router {
    /// A router over these paths, written as vue-router writes them: `/users/:id`,
    /// `/docs/:section/:page(.*)`.
    ///
    /// # Panics
    ///
    /// On a path that does not start with `/`, a parameter that is not `:name` or `:name(.*)`, a
    /// `(.*)` anywhere but the last segment, or a static segment that is not plain ASCII text. The
    /// paths are part of the program, so this is a programming error, found the first time the
    /// router is built.
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
    /// let router = ferrovue::Router::new(&["/", "/users/:id"]);
    /// assert_eq!(router.at("/users/7").param("id"), Some("7"));
    /// assert_eq!(router.at("/nowhere").param("id"), None);
    /// ```
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
    /// # use ferrovue_router as ferrovue;
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
    /// # use ferrovue_router as ferrovue;
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

    fn chain(&self, mut i: usize) -> Vec<usize> {
        let mut chain = vec![i];
        while let Some(p) = self.routes[i].parent {
            chain.push(p);
            i = p;
        }
        chain.reverse();
        chain
    }

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
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
    /// let router = ferrovue::Router::new(&["/", "/blog/:slug"]).with_base("/app/");
    /// // A request for /app/blog/intro, with the base taken off.
    /// let route = router.at("/blog/intro");
    /// let link = route.link("/blog/intro");
    /// assert_eq!(link.href, "/app/blog/intro");
    /// assert!(link.exact);
    /// ```
    pub fn with_base(mut self, base: &str) -> Router {
        let mut b = if base.is_empty() || base.starts_with('/') || base.starts_with('#') {
            base.to_owned()
        } else {
            format!("/{base}")
        };
        if b.ends_with('/') {
            b.pop();
        }
        if let Some(i) = b.find('#')
            && i > 0
        {
            b = b[i..].to_owned();
        }
        self.base = b;
        self
    }

    /// The reader's location: a path, with any query and hash, and without the history's base.
    ///
    /// Pass the request's path and query as they arrived, percent-encoding included. A location
    /// that matches no route still gives a [`Route`], whose [`Route::name`] and [`Route::param`]
    /// are `None` and whose links are never active.
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
    /// let router = ferrovue::Router::new(&["/", "/search"]);
    /// let route = router.at("/search?q=caf%C3%A9&page=2#results");
    /// assert_eq!(route.path(), "/search");
    /// assert_eq!(route.query("q").attr_value(), Some("café"));
    /// assert_eq!(route.hash(), "#results");
    /// ```
    pub fn at(&self, location: &str) -> Route<'_> {
        let (path, full_path) = parse_url(location, "/");
        let hash_pos = location.find('#');
        let hash = hash_pos.map_or_else(String::new, |h| decode(&location[h..]));
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
///
/// # Example
///
/// ```
/// # use ferrovue_router as ferrovue;
/// let router = ferrovue::Router::named(&[("/", Some("home")), ("/blog/:slug", Some("post"))]);
/// let route = router.at("/blog/intro?sort=new#comments");
///
/// assert_eq!(route.name(), Some("post"));
/// assert_eq!(route.param("slug"), Some("intro"));
/// assert_eq!(route.path(), "/blog/intro");
/// assert_eq!(route.full_path(), "/blog/intro?sort=new#comments");
/// assert!(route.query("sort").is("new"));
/// assert_eq!(route.hash(), "#comments");
///
/// // What `<RouterLink to="/">` writes from here.
/// let home = route.link("/");
/// assert_eq!(home.href, "/");
/// assert!(!home.active);
/// ```
pub struct Route<'r> {
    router: &'r Router,
    path: String,
    hash: String,
    matched: Option<(usize, Vec<String>)>,
    query: Vec<(String, Vec<Option<String>>)>,
    full_path: String,
}

/// One value of `route.query`, as vue-router parses it: a key may be absent, given without a value
/// (`?flag`, which is `null`), given once, or given more than once, which makes an array.
///
/// # Example
///
/// ```
/// # use ferrovue_router as ferrovue;
/// use ferrovue::{Query, Router};
///
/// let router = Router::new(&["/search"]);
/// let route = router.at("/search?q=rust&tag=a&tag=b&flag");
///
/// assert_eq!(route.query("q"), Query::One("rust"));
/// assert_eq!(route.query("flag"), Query::Null);
/// assert_eq!(route.query("nothing"), Query::Absent);
/// assert!(route.query("tag").is_array());
/// ```
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
    /// and an array as `toDisplayString` writes one: `JSON.stringify(value, null, 2)`.
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
    /// let router = ferrovue::Router::new(&["/search"]);
    /// let route = router.at("/search?q=a%3Cb&tag=x&tag=y");
    ///
    /// let mut out = String::new();
    /// route.query("q").write_display(&mut out);
    /// assert_eq!(out, "a&lt;b");
    ///
    /// out.clear();
    /// route.query("tag").write_display(&mut out);
    /// assert_eq!(out, "[\n  &quot;x&quot;,\n  &quot;y&quot;\n]");
    /// ```
    pub fn write_display(&self, out: &mut String) {
        match self {
            Query::Absent | Query::Null => {}
            Query::One(s) => ferrovue_core::escape_into(out, s),
            Query::Many(values) => {
                let mut json = String::from("[\n");
                for (i, v) in values.iter().enumerate() {
                    if i > 0 {
                        json.push_str(",\n");
                    }
                    json.push_str("  ");
                    match v {
                        Some(s) => json.push_str(&serde_json::to_string(s).unwrap_or_default()),
                        None => json.push_str("null"),
                    }
                }
                json.push_str("\n]");
                ferrovue_core::escape_into(out, &json);
            }
        }
    }

    /// JavaScript's truthiness: a non-empty string or an array.
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
    /// use ferrovue::Query;
    ///
    /// assert!(Query::One("x").truthy());
    /// assert!(!Query::One("").truthy());
    /// assert!(!Query::Null.truthy() && !Query::Absent.truthy());
    /// ```
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
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
    /// use ferrovue::Query;
    ///
    /// assert_eq!(Query::Absent.or("none"), Query::One("none"));
    /// assert_eq!(Query::One("").or("none"), Query::One("")); // `??` keeps the empty string
    /// ```
    pub fn or<'a>(self, fallback: &'a str) -> Query<'a>
    where
        'r: 'a,
    {
        match self {
            Query::Absent | Query::Null => Query::One(fallback),
            other => other,
        }
    }

    /// The single string, when the value is one: `typeof route.query.q === "string"`, which narrows
    /// it to what an attribute can be bound to. `null`, `undefined` and an array are `None`.
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
    /// use ferrovue::Query;
    ///
    /// assert_eq!(Query::One("rust").attr_value(), Some("rust"));
    /// assert_eq!(Query::Null.attr_value(), None);
    /// ```
    pub fn attr_value(&self) -> Option<&'r str> {
        match self {
            Query::One(s) => Some(s),
            _ => None,
        }
    }
}

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

/// A `<RouterLink>`'s `to`, resolved: what [`Route::link`], [`Route::link_named`] and
/// [`Route::link_path`] return.
///
/// The `href` is not escaped.
///
/// # Example
///
/// ```
/// # use ferrovue_router as ferrovue;
/// let router = ferrovue::Router::new(&["/", "/blog/:slug"]);
/// let link = router.at("/blog/intro").link("/blog/intro#top");
/// assert_eq!(link.href, "/blog/intro#top");
/// assert!(link.active && link.exact);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
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

/// The location as written, and the route it matched with its parameters; the router it borrows
/// is left out.
///
/// # Example
///
/// ```
/// # use ferrovue_router as ferrovue;
/// let router = ferrovue::Router::named(&[("/blog/:slug", Some("post"))]);
/// assert_eq!(
///     format!("{:?}", router.at("/blog/intro?sort=new#comments")),
///     r#"Route { full_path: "/blog/intro?sort=new#comments", name: Some("post"), params: {"slug": "intro"}, .. }"#
/// );
/// assert_eq!(
///     format!("{:?}", router.at("/nowhere")),
///     r#"Route { full_path: "/nowhere", name: None, params: {}, .. }"#
/// );
/// ```
impl std::fmt::Debug for Route<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let params = match &self.matched {
            Some((i, values)) => self.router.params(*i, values),
            None => Vec::new(),
        };
        f.debug_struct("Route")
            .field("full_path", &self.full_path)
            .field("name", &self.name())
            .field("params", &DebugMap(params.into_iter()))
            .finish_non_exhaustive()
    }
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

    /// Resolve a link from here: a string `to`, absolute or relative to the current path, with any
    /// query and hash, which are kept as written.
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
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

    fn state(&self, target: Option<(usize, Vec<String>)>) -> (bool, bool) {
        let (Some((t, link_values)), Some((c, here_values))) = (target, self.matched.as_ref())
        else {
            return (false, false);
        };
        let router = self.router;
        let link_chain = router.chain(t);
        let here_chain = router.chain(*c);
        let routed = *link_chain.last().expect("a chain holds its route");
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
    /// A debug build also panics on a required parameter that is missing or empty, as vue-router
    /// throws on one; a release build writes the link without it.
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
    /// let router = ferrovue::Router::named(&[("/", Some("home")), ("/books/:id", Some("book"))]);
    /// let route = router.at("/books/dune");
    ///
    /// // <RouterLink :to="{ name: 'book', params: { id: 'dune' }, query: { tab: 'reviews' }, hash: '#top' }">
    /// let mut search = String::new();
    /// ferrovue::query_into(&mut search, "tab", "reviews");
    /// let link = route.link_named("book", &[("id", "dune")], &search, "#top");
    /// assert_eq!(link.href, "/books/dune?tab=reviews#top");
    /// assert!(link.active && link.exact);
    ///
    /// // Parameters are encoded as vue-router encodes them.
    /// assert_eq!(route.link_named("book", &[("id", "a/b c")], "", "").href, "/books/a%2Fb%20c");
    /// ```
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
    ///
    /// # Example
    ///
    /// ```
    /// # use ferrovue_router as ferrovue;
    /// let router = ferrovue::Router::new(&["/", "/search"]);
    /// let route = router.at("/");
    ///
    /// // <RouterLink :to="{ path: '/search', query: { q: 'a b' } }">
    /// let mut search = String::new();
    /// ferrovue::query_into(&mut search, "q", "a b");
    /// let link = route.link_path("/search", &search, "");
    /// assert_eq!(link.href, "/search?q=a+b");
    /// assert!(!link.active);
    /// ```
    pub fn link_path(&self, path: &str, search: &str, hash: &str) -> Link {
        let (path, _) = parse_url(path, &self.path);
        let (active, exact) = self.state(self.router.matched(&path));
        Link {
            href: self.href(&path, search, hash),
            active,
            exact,
        }
    }

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
/// # use ferrovue_router as ferrovue;
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

#[derive(Clone, Copy, PartialEq)]
enum Part {
    Param,
    QueryValue,
    QueryKey,
    Hash,
}

fn encode_param(text: &str) -> String {
    encode_url(text, Part::Param)
}

fn encode_url(text: &str, part: Part) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
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

fn compare(a: &[i32], b: &[i32]) -> std::cmp::Ordering {
    for (x, y) in a.iter().zip(b) {
        if x != y {
            return y.cmp(x);
        }
    }
    b.len().cmp(&a.len())
}

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
        path = Some(path.filter(|p| !p.is_empty()).unwrap_or(&location[..h]));
        hash = &location[h..];
    }
    let path = resolve_relative_path(path.unwrap_or(location), current);
    let full = format!("{path}{search}{hash}");
    (path, full)
}

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
