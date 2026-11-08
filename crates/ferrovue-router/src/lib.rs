//! Vue Router's location matching, for `<RouterLink>` and `useRoute()` on the server: part of
//! [ferrovue](https://docs.rs/ferrovue)'s runtime.
//!
//! # Example
//!
//! ```
//! # mod ferrovue { pub use ferrovue_router as router; }
//! let router = ferrovue::router::Router::new(&["/", "/blog/:slug"]);
//! let route = router.at("/blog/hello");
//! let link = route.link("/blog/hello");
//! assert_eq!((link.href.as_str(), link.active, link.exact), ("/blog/hello", true, true));
//! assert!(!route.link("/").active);
//! ```
#![warn(rustdoc::missing_crate_level_docs)]

mod debug_map;
mod matching;
mod url;

#[cfg(test)]
mod tests;

use debug_map::DebugMap;
use matching::{Pattern, SPANS, Token, Values, compare};
use url::{Part, decode, encode_param, encode_url, parse_query, parse_url, split_url};

/// The routes, in the order vue-router tries them.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_router as router; }
/// use ferrovue::router::Router;
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
    most: usize,
}

/// The base, and each route's full path with its name, in the order vue-router tries them.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_router as router; }
/// let router = ferrovue::router::Router::named(&[("/", Some("home")), ("/users/:id", None)]).with_base("/app/");
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

impl Router {
    /// A router over these paths, written as vue-router writes them: `/users/:id`, `/:lang?/about`,
    /// `/docs/:section/:page(.*)`.
    ///
    /// # Panics
    ///
    /// On a path that does not start with `/`, a parameter that is not `:name`, `:name?` or
    /// `:name(.*)`, a `(.*)` anywhere but the last segment, or a static segment that is not plain
    /// ASCII text. The paths are part of the program, so this is a programming error, found the
    /// first time the router is built.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let router = ferrovue::router::Router::new(&["/", "/users/:id"]);
    /// assert_eq!(router.at("/users/7").param("id"), Some("7"));
    /// assert_eq!(router.at("/nowhere").param("id"), None);
    /// ```
    #[must_use]
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
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// use ferrovue::router::Router;
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
    #[must_use]
    pub fn named(routes: &[(&str, Option<&str>)]) -> Router {
        let defs: Vec<RouteDef<'_>> = routes
            .iter()
            .map(|(path, name)| RouteDef {
                name: *name,
                ..RouteDef::new(path)
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
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// use ferrovue::router::{RouteDef, Router};
    ///
    /// let router = Router::tree(&[RouteDef::new("/users/:id")
    ///     .with_name("user")
    ///     .with_children(&[RouteDef::new("posts").with_name("user-posts")])]);
    /// let here = router.at("/users/7/posts");
    /// let parent = here.link("/users/7");
    /// // The parent is active on its child's page, but not exactly.
    /// assert!(parent.active && !parent.exact);
    /// ```
    #[must_use]
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
                pattern.matchable = d.view || d.name.is_some();
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
        for i in (0..records.len()).filter(|&i| records[i].matchable) {
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
                if records[a].matchable
                    && compare(&records[i].score, &records[a].score) == std::cmp::Ordering::Equal
                {
                    if let Some(at) = order[..upper].iter().rposition(|&x| x == a) {
                        upper = at;
                    }
                    break;
                }
                ancestor = records[a].parent;
            }
            order.insert(upper, i);
        }
        order.extend((0..records.len()).filter(|&i| !records[i].matchable));
        let mut position = vec![0; records.len()];
        for (at, &i) in order.iter().enumerate() {
            position[i] = at;
        }
        let mut slots: Vec<Option<Pattern>> = records.into_iter().map(Some).collect();
        let routes: Vec<Pattern> = order
            .iter()
            .map(|&i| {
                let mut p = slots[i].take().expect("each record once");
                p.parent = p.parent.map(|parent| position[parent]);
                p
            })
            .collect();
        let most = routes.iter().map(|r| r.names().count()).max().unwrap_or(0);
        Router {
            routes,
            base: String::new(),
            most,
        }
    }

    /// The same routes under a base path, as `createWebHistory(base)` serves them: every `href`
    /// starts with it. `/app/` and `app` both mean `/app`.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let router = ferrovue::router::Router::new(&["/", "/blog/:slug"]).with_base("/app/");
    /// // A request for /app/blog/intro, with the base taken off.
    /// let route = router.at("/blog/intro");
    /// let link = route.link("/blog/intro");
    /// assert_eq!(link.href, "/app/blog/intro");
    /// assert!(link.exact);
    /// ```
    #[must_use]
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
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let router = ferrovue::router::Router::new(&["/", "/search"]);
    /// let route = router.at("/search?q=caf%C3%A9&page=2#results");
    /// assert_eq!(route.path(), "/search");
    /// assert_eq!(route.query("q").attr_value(), Some("café"));
    /// assert_eq!(route.hash(), "#results");
    /// ```
    #[must_use]
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
}

/// A route as the routes file lists it: a path, its name if it has one, whether it shows a
/// component, and the routes nested in it, rendered by the `<RouterView>` in its component.
///
/// Build one with [`RouteDef::new`] and its `with_` methods, which are `const`, so a route table
/// can be a `const` or a `static`.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_router as router; }
/// use ferrovue::router::{RouteDef, Router};
///
/// const ROUTES: &[RouteDef<'static>] = &[
///     RouteDef::new("/").with_name("home"),
///     RouteDef::new("/books").with_view(false).with_children(&[
///         RouteDef::new(":id").with_name("book"),
///     ]),
/// ];
///
/// let router = Router::tree(ROUTES);
/// assert_eq!(router.at("/books/dune").name(), Some("book"));
/// assert_eq!(router.at("/books").name(), None);
/// ```
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub struct RouteDef<'a> {
    /// The path, relative to the parent's unless it starts with `/`; empty for a default child.
    pub path: &'a str,
    /// The route's name.
    pub name: Option<&'a str>,
    /// Whether it shows a component. A route with neither a view nor a name only groups the routes
    /// nested in it, as a folder of file-based routes does, and vue-router never matches it.
    pub view: bool,
    /// The routes nested in it.
    pub children: &'a [RouteDef<'a>],
}

impl<'a> RouteDef<'a> {
    /// A route at `path` that shows a component, with no name and no nested routes.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let def = ferrovue::router::RouteDef::new("/about");
    /// assert_eq!(def.path, "/about");
    /// assert_eq!(def.name, None);
    /// assert!(def.view && def.children.is_empty());
    /// ```
    #[must_use]
    pub const fn new(path: &'a str) -> RouteDef<'a> {
        RouteDef {
            path,
            name: None,
            view: true,
            children: &[],
        }
    }

    /// The route, named `name`.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let def = ferrovue::router::RouteDef::new("/users/:id").with_name("user");
    /// assert_eq!(def.name, Some("user"));
    /// ```
    #[must_use]
    pub const fn with_name(self, name: &'a str) -> RouteDef<'a> {
        RouteDef {
            name: Some(name),
            ..self
        }
    }

    /// The route, showing a component when `view` is true. A route with neither a view nor a name
    /// only groups the routes nested in it.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let def = ferrovue::router::RouteDef::new("/books").with_view(false);
    /// assert!(!def.view);
    /// ```
    #[must_use]
    pub const fn with_view(self, view: bool) -> RouteDef<'a> {
        RouteDef { view, ..self }
    }

    /// The route, with `children` nested in it.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// use ferrovue::router::RouteDef;
    ///
    /// const USER: RouteDef<'static> = RouteDef::new("/users/:id").with_children(&[
    ///     RouteDef::new(""),
    ///     RouteDef::new("posts"),
    /// ]);
    /// assert_eq!(USER.children[1].path, "posts");
    /// ```
    #[must_use]
    pub const fn with_children(self, children: &'a [RouteDef<'a>]) -> RouteDef<'a> {
        RouteDef { children, ..self }
    }
}

/// Where the reader is, which is what every link on the page is compared with.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_router as router; }
/// let router = ferrovue::router::Router::named(&[("/", Some("home")), ("/blog/:slug", Some("post"))]);
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
    matched: Option<(usize, Values)>,
    query: Vec<(String, Vec<Option<String>>)>,
    full_path: String,
}

/// One value of `route.query`, as vue-router parses it: a key may be absent, given without a value
/// (`?flag`, which is `null`), given once, or given more than once, which makes an array.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_router as router; }
/// use ferrovue::router::{Query, Router};
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
#[non_exhaustive]
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
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let router = ferrovue::router::Router::new(&["/search"]);
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
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// use ferrovue::router::Query;
    ///
    /// assert!(Query::One("x").truthy());
    /// assert!(!Query::One("").truthy());
    /// assert!(!Query::Null.truthy() && !Query::Absent.truthy());
    /// ```
    #[must_use]
    pub fn truthy(&self) -> bool {
        match self {
            Query::One(s) => !s.is_empty(),
            Query::Many(_) => true,
            Query::Absent | Query::Null => false,
        }
    }

    /// `route.query.q === text`: only a single value can equal a string.
    #[must_use]
    pub fn is(&self, text: &str) -> bool {
        matches!(self, Query::One(s) if *s == text)
    }

    /// `route.query.q === undefined`.
    #[must_use]
    pub fn is_undefined(&self) -> bool {
        matches!(self, Query::Absent)
    }

    /// `Array.isArray(route.query.q)`.
    #[must_use]
    pub fn is_array(&self) -> bool {
        matches!(self, Query::Many(_))
    }

    /// `route.query.q ?? fallback`: the fallback for `undefined` and `null`.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// use ferrovue::router::Query;
    ///
    /// assert_eq!(Query::Absent.or("none"), Query::One("none"));
    /// assert_eq!(Query::One("").or("none"), Query::One("")); // `??` keeps the empty string
    /// ```
    #[must_use]
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
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// use ferrovue::router::Query;
    ///
    /// assert_eq!(Query::One("rust").attr_value(), Some("rust"));
    /// assert_eq!(Query::Null.attr_value(), None);
    /// ```
    #[must_use]
    pub fn attr_value(&self) -> Option<&'r str> {
        match self {
            Query::One(s) => Some(s),
            _ => None,
        }
    }
}

/// A `<RouterLink>`'s `to`, resolved: what [`Route::link`], [`Route::link_named`] and
/// [`Route::link_path`] return.
///
/// The `href` is not escaped.
///
/// # Example
///
/// ```
/// # mod ferrovue { pub use ferrovue_router as router; }
/// let router = ferrovue::router::Router::new(&["/", "/blog/:slug"]);
/// let link = router.at("/blog/intro").link("/blog/intro#top");
/// assert_eq!(link.href, "/blog/intro#top");
/// assert!(link.active && link.exact);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
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
/// # mod ferrovue { pub use ferrovue_router as router; }
/// let router = ferrovue::router::Router::named(&[("/blog/:slug", Some("post"))]);
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
    #[must_use]
    pub fn path(&self) -> &str {
        &self.path
    }

    /// `route.hash`: the location's hash, with its `#`, decoded; empty when there is none.
    #[must_use]
    pub fn hash(&self) -> &str {
        &self.hash
    }

    /// `route.query.<key>`.
    #[must_use]
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
    #[must_use]
    pub fn full_path(&self) -> &str {
        &self.full_path
    }

    /// `route.name`: the name of the route the location matched, if it has one.
    #[must_use]
    pub fn name(&self) -> Option<&str> {
        let (i, _) = self.matched.as_ref()?;
        self.router.routes[*i].name.as_deref()
    }

    /// `route.params.<name>`: that parameter of the route the location matched, decoded; `None`
    /// when the route has no such parameter, an optional one the location leaves out, or the
    /// location matched no route.
    #[must_use]
    pub fn param(&self, name: &str) -> Option<&str> {
        let (i, values) = self.matched.as_ref()?;
        let at = self.router.routes[*i].names().position(|n| n == name)?;
        values.get(at)?.as_deref()
    }

    /// Resolve a link from here: a string `to`, absolute or relative to the current path, with any
    /// query and hash, which are kept as written.
    ///
    /// # Example
    ///
    /// ```
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let router = ferrovue::router::Router::new(&["/", "/blog/:slug"]);
    /// let here = router.at("/blog/intro");
    /// let link = here.link("/blog/intro?sort=new");
    /// assert_eq!(link.href, "/blog/intro?sort=new");
    /// assert!(link.active, "the query does not change which route it is");
    /// assert!(!here.link("/").active);
    /// ```
    #[must_use]
    pub fn link(&self, to: &str) -> Link {
        let (path, full) = parse_url(to, &self.path);
        let matched = self.router.matched(&path);
        let (active, exact) = self.state(matched.as_ref().map(|(i, v)| (*i, v.as_slice())));
        Link {
            href: format!("{}{full}", self.router.base),
            active,
            exact,
        }
    }

    /// What `<RouterLink :to>` writes from here: ` aria-current="{current}"` when the link is exact
    /// and ` href="…"` escaped, into `out`. Returns `(active, exact)`.
    #[doc(hidden)]
    pub fn link_into(&self, out: &mut String, to: &str, current: &str) -> (bool, bool) {
        let router = self.router;
        let (path, search, hash) = split_url(to, &self.path);
        let (active, exact) = if router.most > SPANS {
            let matched = router.matched(&path);
            self.state(matched.as_ref().map(|(i, v)| (*i, v.as_slice())))
        } else {
            let matched = router.matched_spans(&path);
            self.state(matched.as_ref().map(|(i, s)| (*i, &s.at[..s.len])))
        };
        if exact {
            out.push_str(" aria-current=\"");
            out.push_str(current);
            out.push('"');
        }
        out.push_str(" href=\"");
        ferrovue_core::escape_into(out, &router.base);
        ferrovue_core::escape_into(out, &path);
        ferrovue_core::escape_into(out, search);
        ferrovue_core::escape_into(out, hash);
        out.push('"');
        (active, exact)
    }

    /// Resolve `{ name, params, query, hash }`: the named route's path with each parameter
    /// encoded, then `search` (a query [`query_into`] built, without its `?`) and `hash`.
    ///
    /// An optional parameter left out of `params` is left out of the path, unless the route is
    /// nested in one that has it optional and the current location gives it, which vue-router
    /// then keeps.
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
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let router = ferrovue::router::Router::named(&[("/", Some("home")), ("/books/:id", Some("book"))]);
    /// let route = router.at("/books/dune");
    ///
    /// // <RouterLink :to="{ name: 'book', params: { id: 'dune' }, query: { tab: 'reviews' }, hash: '#top' }">
    /// let mut search = String::new();
    /// ferrovue::router::query_into(&mut search, "tab", "reviews");
    /// let link = route.link_named("book", &[("id", "dune")], &search, "#top");
    /// assert_eq!(link.href, "/books/dune?tab=reviews#top");
    /// assert!(link.active && link.exact);
    ///
    /// // Parameters are encoded as vue-router encodes them.
    /// assert_eq!(route.link_named("book", &[("id", "a/b c")], "", "").href, "/books/a%2Fb%20c");
    /// ```
    #[must_use]
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
        let router = self.router;
        let route = &router.routes[i];
        let current = match &self.matched {
            Some((c, values)) => router.params(*c, values),
            None => Vec::new(),
        };
        let inherited: Vec<&str> = route.parent.map_or_else(Vec::new, |p| {
            router.routes[p]
                .tokens
                .iter()
                .filter_map(|t| match t {
                    Token::Param {
                        name,
                        optional: true,
                        ..
                    } => Some(name.as_str()),
                    _ => None,
                })
                .collect()
        });
        let mut path = String::new();
        let mut values = Vec::new();
        for token in &route.tokens {
            path.push('/');
            match token {
                Token::Static(text) => path.push_str(text),
                Token::Param { name, optional, .. } => {
                    let given = params.iter().find(|(k, _)| k == name).map(|(_, v)| *v);
                    let value = given.or_else(|| {
                        let pick = !optional || inherited.contains(&name.as_str());
                        pick.then(|| current.iter().find(|(k, _)| k == name).map(|(_, v)| *v))
                            .flatten()
                    });
                    let text = value.unwrap_or("");
                    if text.is_empty() && *optional {
                        path.pop();
                    }
                    debug_assert!(
                        *optional || !text.is_empty(),
                        "missing required param {name:?} for the route called {:?}",
                        route.name
                    );
                    let encoded = encode_param(text);
                    values.push(value.map(|_| decode(&encoded)));
                    path.push_str(&encoded);
                }
            }
        }
        if path.is_empty() {
            path.push('/');
        }
        let (active, exact) = self.state(Some((i, values.as_slice())));
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
    /// # mod ferrovue { pub use ferrovue_router as router; }
    /// let router = ferrovue::router::Router::new(&["/", "/search"]);
    /// let route = router.at("/");
    ///
    /// // <RouterLink :to="{ path: '/search', query: { q: 'a b' } }">
    /// let mut search = String::new();
    /// ferrovue::router::query_into(&mut search, "q", "a b");
    /// let link = route.link_path("/search", &search, "");
    /// assert_eq!(link.href, "/search?q=a+b");
    /// assert!(!link.active);
    /// ```
    #[must_use]
    pub fn link_path(&self, path: &str, search: &str, hash: &str) -> Link {
        let (path, _) = parse_url(path, &self.path);
        let matched = self.router.matched(&path);
        let (active, exact) = self.state(matched.as_ref().map(|(i, v)| (*i, v.as_slice())));
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
/// # mod ferrovue { pub use ferrovue_router as router; }
/// let mut search = String::new();
/// ferrovue::router::query_into(&mut search, "q", "a b&c");
/// ferrovue::router::query_into(&mut search, "page", "2");
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
