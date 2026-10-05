#![doc = include_str!("../docs/crate.md")]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![warn(
    missing_docs,
    missing_debug_implementations,
    rustdoc::missing_crate_level_docs
)]

use serde::Serialize;

/// A component applied to its props, ready to be written: what a generated `html()` or `island()`
/// returns, borrowing the props, and `into_html()` or `into_island()`, holding them.
///
/// Nothing renders until it is written, and then it is written straight into the caller's buffer:
/// no buffer of its own, and no copy. `P` is the component's `Props`. `F` is the renderer: a plain
/// function for a component that needs only its props, a closure holding the slots, the route, the
/// stores, the translations or the teleports for one that takes those as well. One that holds its
/// props borrows nothing from the caller, so a function that builds the props can return it.
///
/// `Html` is the one type in this crate that writes raw bytes. Generated code is what builds it,
/// and it writes by calling a generated renderer, whose every interpolation goes through
/// [`escape_into`]. With the `maud` feature it implements `maud::Render`, so it can be spliced into
/// a `maud::html!` template; with `axum` it is an `IntoResponse`, and with `actix-web` a
/// `Responder`, so a handler can respond with it.
///
/// [`guide::generated_code`](crate::guide::generated_code#html-and-island) explains which
/// components have an `island()`.
///
/// # Example
///
/// ```
/// # mod hello {
/// # use std::borrow::Cow;
/// # use ferrovue as fv;
/// # pub const NAME: &str = "Hello";
/// # #[derive(Debug, Clone, serde::Serialize)]
/// # pub struct Props<'a> {
/// #     #[serde(rename = "name")]
/// #     pub name: Cow<'a, str>,
/// # }
/// # impl<'a> Props<'a> {
/// #     pub fn new(name: impl Into<Cow<'a, str>>) -> Self {
/// #         Props { name: name.into() }
/// #     }
/// # }
/// # pub fn render(out: &mut String, props: &Props<'_>) {
/// #     out.push_str("<p>Hello, ");
/// #     fv::escape_into(out, &*props.name);
/// #     out.push_str("!</p>");
/// # }
/// # pub fn html<'p, 'a>(props: &'p Props<'a>) -> fv::Html<'p, Props<'a>> {
/// #     fv::Html::markup(props, render)
/// # }
/// # pub fn island<'p, 'a>(props: &'p Props<'a>) -> fv::Html<'p, Props<'a>> {
/// #     fv::Html::island(NAME, props, render)
/// # }
/// # pub fn into_html<'a>(props: Props<'a>) -> fv::Html<'a, Props<'a>> {
/// #     fv::Html::markup_owned(props, render)
/// # }
/// # }
/// // `hello::html`, `hello::island` and `hello::into_html` are what the compiler writes for
/// // `Hello.vue`.
/// let props = hello::Props::new("Ada");
/// assert_eq!(hello::html(&props).into_string(), "<p>Hello, Ada!</p>");
/// assert_eq!(
///     hello::island(&props).into_string(),
///     r#"<div data-island="Hello" data-props="{&quot;name&quot;:&quot;Ada&quot;}"><p>Hello, Ada!</p></div>"#
/// );
///
/// // `into_html` holds the props, so the function that makes them can return the page.
/// fn greet(name: String) -> ferrovue::Html<'static, hello::Props<'static>> {
///     hello::into_html(hello::Props::new(name))
/// }
/// assert_eq!(greet("Grace".into()).into_string(), "<p>Hello, Grace!</p>");
/// ```
pub struct Html<'p, P, F = fn(&mut String, &P)> {
    props: Given<'p, P>,
    render: F,
    /// `Some(name)` wraps the markup as a hydratable island; `None` is the markup alone.
    island: Option<&'static str>,
}

impl<'p, P: Serialize, F: Fn(&mut String, &P)> Html<'p, P, F> {
    /// The component's markup, which the client never hydrates.
    ///
    /// Called by generated code alone: `render` is trusted to escape what it writes, which only a
    /// generated renderer does. Anything else that builds one can write any bytes it likes.
    #[doc(hidden)]
    pub fn markup(props: &'p P, render: F) -> Self {
        Html {
            props: Given::Borrowed(props),
            render,
            island: None,
        }
    }

    /// The component as an island the client hydrates. For generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    pub fn island(name: &'static str, props: &'p P, render: F) -> Self {
        Html {
            props: Given::Borrowed(props),
            render,
            island: Some(name),
        }
    }

    /// [`Html::markup`] holding its props, for a page returned from where they were made. For
    /// generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    pub fn markup_owned(props: P, render: F) -> Self {
        Html {
            props: Given::Owned(props),
            render,
            island: None,
        }
    }

    /// [`Html::island`] holding its props. For generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    pub fn island_owned(name: &'static str, props: P, render: F) -> Self {
        Html {
            props: Given::Owned(props),
            render,
            island: Some(name),
        }
    }

    /// Write the markup onto the end of `buf`, leaving what `buf` already holds as it is: how a
    /// component goes into a page being written in one buffer, or into a slot.
    ///
    /// # Example
    ///
    /// ```
    /// # mod hello {
    /// #     #[derive(serde::Serialize)]
    /// #     pub struct Props<'a> { pub name: &'a str }
    /// #     pub fn render(out: &mut String, props: &Props<'_>) {
    /// #         out.push_str("<p>Hello, ");
    /// #         ferrovue::escape_into(out, props.name);
    /// #         out.push_str("!</p>");
    /// #     }
    /// #     pub fn html<'p, 'a>(props: &'p Props<'a>) -> ferrovue::Html<'p, Props<'a>> {
    /// #         ferrovue::Html::markup(props, render)
    /// #     }
    /// # }
    /// let mut page = String::from("<main>");
    /// hello::html(&hello::Props { name: "Ada" }).render_to(&mut page);
    /// page.push_str("</main>");
    /// assert_eq!(page, "<main><p>Hello, Ada!</p></main>");
    /// ```
    pub fn render_to(&self, buf: &mut String) {
        let props = self.props.get();
        match self.island {
            None => (self.render)(buf, props),
            Some(name) => island_into(buf, name, props, &self.render),
        }
    }

    /// The markup as a string of its own.
    ///
    /// # Example
    ///
    /// ```
    /// # mod hello {
    /// #     #[derive(serde::Serialize)]
    /// #     pub struct Props<'a> { pub name: &'a str }
    /// #     pub fn render(out: &mut String, props: &Props<'_>) {
    /// #         out.push_str("<p>Hello, ");
    /// #         ferrovue::escape_into(out, props.name);
    /// #         out.push_str("!</p>");
    /// #     }
    /// #     pub fn html<'p, 'a>(props: &'p Props<'a>) -> ferrovue::Html<'p, Props<'a>> {
    /// #         ferrovue::Html::markup(props, render)
    /// #     }
    /// # }
    /// let html: String = hello::html(&hello::Props { name: "<Ada>" }).into_string();
    /// assert_eq!(html, "<p>Hello, &lt;Ada&gt;!</p>");
    /// ```
    pub fn into_string(self) -> String {
        let mut out = String::new();
        self.render_to(&mut out);
        out
    }
}

/// The props an [`Html`] renders: borrowed from the caller, or its own.
enum Given<'p, P> {
    Borrowed(&'p P),
    Owned(P),
}

impl<P> Given<'_, P> {
    #[inline]
    fn get(&self) -> &P {
        match self {
            Given::Borrowed(props) => props,
            Given::Owned(props) => props,
        }
    }
}

/// The island's name, if it is one, and the props; the renderer is a function, shown as `..`.
///
/// # Example
///
/// ```
/// # mod counter {
/// #     #[derive(Debug, serde::Serialize)]
/// #     pub struct Props { pub start: i64 }
/// #     pub fn render(out: &mut String, props: &Props) {
/// #         out.push_str("<button>");
/// #         ferrovue::push_int(out, props.start);
/// #         out.push_str("</button>");
/// #     }
/// #     pub fn island(props: &Props) -> ferrovue::Html<'_, Props> {
/// #         ferrovue::Html::island("Counter", props, render)
/// #     }
/// # }
/// let props = counter::Props { start: 5 };
/// assert_eq!(
///     format!("{:?}", counter::island(&props)),
///     r#"Html { island: Some("Counter"), props: Props { start: 5 }, .. }"#
/// );
/// ```
impl<P: std::fmt::Debug, F> std::fmt::Debug for Html<'_, P, F> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Html")
            .field("island", &self.island)
            .field("props", self.props.get())
            .finish_non_exhaustive()
    }
}

/// A component spliced into a `maud::html!` template, written straight into maud's buffer.
///
/// # Example
///
/// ```
/// # mod hello {
/// #     #[derive(serde::Serialize)]
/// #     pub struct Props<'a> { pub name: &'a str }
/// #     pub fn render(out: &mut String, props: &Props<'_>) {
/// #         out.push_str("<p>Hello, ");
/// #         ferrovue::escape_into(out, props.name);
/// #         out.push_str("!</p>");
/// #     }
/// #     pub fn html<'p, 'a>(props: &'p Props<'a>) -> ferrovue::Html<'p, Props<'a>> {
/// #         ferrovue::Html::markup(props, render)
/// #     }
/// # }
/// # #[cfg(feature = "maud")]
/// # fn main() {
/// let props = hello::Props { name: "Ada" };
/// let page = maud::html! {
///     main { (hello::html(&props)) }
/// };
/// assert_eq!(page.into_string(), "<main><p>Hello, Ada!</p></main>");
/// # }
/// # #[cfg(not(feature = "maud"))]
/// # fn main() {}
/// ```
#[cfg(feature = "maud")]
#[cfg_attr(docsrs, doc(cfg(feature = "maud")))]
impl<P: Serialize, F: Fn(&mut String, &P)> maud::Render for Html<'_, P, F> {
    fn render_to(&self, buf: &mut String) {
        Html::render_to(self, buf);
    }
}

/// What a parent puts in one of a component's slots.
///
/// A generated component that renders `<slot>` has a `Slots` struct with a field per slot:
/// `Option<Slot>`, where `None` shows the slot's fallback, or a plain `Slot` for the page
/// `<RouterView>` shows. From Rust, make one with [`Slot::new`] from a closure that writes the
/// content, or with [`hole`] for content written later. It borrows the closure, and is `Copy`.
///
/// A scoped slot is not a `Slot` but a closure given the outlet's props; see [`scoped_slot_into`]
/// and [`guide::slots`].
///
/// # Example
///
/// ```
/// use ferrovue::{slot_into, Slot};
///
/// let body = |out: &mut String| out.push_str("<p>three new messages</p>");
/// let slot = Slot::new(&body);
///
/// // What a component's `<slot>` outlet does with it: the content between fragment markers.
/// let mut out = String::new();
/// slot_into(&mut out, Some(slot), Some(&mut |out: &mut String| out.push_str("nothing here")));
/// assert_eq!(out, "<!--[--><p>three new messages</p><!--]-->");
/// ```
#[derive(Clone, Copy)]
pub struct Slot<'s> {
    body: Body<'s>,
}

#[derive(Clone, Copy)]
enum Body<'s> {
    /// Always content, whatever it writes — as a component in a slot always is to Vue.
    Content(&'s dyn Fn(&mut String)),
    /// A generated parent's markup, which reports whether it wrote anything but comments.
    Markup(&'s dyn Fn(&mut String) -> bool),
    /// As `Markup`, for a component whose outlets pass a slot scope id (`:slotted` styles): the
    /// content is given the id, ` data-v-…-s`, to write onto its elements.
    Slotted(&'s dyn Fn(&mut String, &str) -> bool),
}

impl<'s> Slot<'s> {
    /// Content for a slot: another component's render, or markup the caller already holds. The
    /// slot's fallback never replaces it, even when the closure writes nothing, as a component in
    /// a slot is always content to Vue; to show the fallback, give the slot `None`.
    ///
    /// The closure's output is written as it is, unescaped: escape any text it writes with
    /// [`escape_into`].
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::{slot_into, Slot};
    ///
    /// let name = "<Ada>";
    /// let content = |out: &mut String| {
    ///     out.push_str("<b>");
    ///     ferrovue::escape_into(out, name);
    ///     out.push_str("</b>");
    /// };
    /// let mut out = String::new();
    /// slot_into(&mut out, Some(Slot::new(&content)), None);
    /// assert_eq!(out, "<!--[--><b>&lt;Ada&gt;</b><!--]-->");
    ///
    /// // Empty content is still content: the fallback does not show.
    /// let nothing = |_: &mut String| {};
    /// out.clear();
    /// slot_into(&mut out, Some(Slot::new(&nothing)), Some(&mut |out: &mut String| out.push_str("fallback")));
    /// assert_eq!(out, "<!--[--><!--]-->");
    /// ```
    pub fn new(render: &'s dyn Fn(&mut String)) -> Self {
        Slot {
            body: Body::Content(render),
        }
    }

    /// A generated parent's slot content, returning whether it pushed anything but a comment.
    ///
    /// Called by generated code: content from a template that turns out to be only comments gives
    /// way to the fallback, as in Vue.
    #[doc(hidden)]
    pub fn markup(render: &'s dyn Fn(&mut String) -> bool) -> Self {
        Slot {
            body: Body::Markup(render),
        }
    }

    /// A generated parent's slot content for a component whose outlets pass a slot scope id: given
    /// the id, returning whether it pushed anything but a comment.
    #[doc(hidden)]
    pub fn slotted(render: &'s dyn Fn(&mut String, &str) -> bool) -> Self {
        Slot {
            body: Body::Slotted(render),
        }
    }

    /// Write the content alone, without fragment markers, as `<RouterView>` does with the page it
    /// shows. Generated code calls it for a component's `router_view` slot.
    ///
    /// # Example
    ///
    /// ```
    /// let page = |out: &mut String| out.push_str("<h1>Home</h1>");
    /// let mut out = String::from("<main>");
    /// ferrovue::Slot::new(&page).render_to(&mut out);
    /// out.push_str("</main>");
    /// assert_eq!(out, "<main><h1>Home</h1></main>");
    /// ```
    pub fn render_to(&self, out: &mut String) {
        match self.body {
            Body::Content(f) => f(out),
            Body::Markup(f) => {
                f(out);
            }
            Body::Slotted(f) => {
                f(out, "");
            }
        }
    }
}

/// `Slot { .. }`: its content is a closure, which only writing it shows.
impl std::fmt::Debug for Slot<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Slot").finish_non_exhaustive()
    }
}

/// What a [`hole`] writes. Every interpolated value has its `<` escaped, so only a template's own
/// markup could spell this, and no template writes an element called `fv-hole`.
const HOLE: &str = "<fv-hole>";

fn write_hole(out: &mut String) {
    out.push_str(HOLE);
}

/// A slot whose content the caller writes itself, later: render with holes, [`split_holes`] the
/// output, and write the pieces with each hole's content between them — which is how a page streams
/// its parts in the order they are ready. A hole is content to the slot, so its fallback never
/// shows. [`guide::streaming`] shows a whole streamed page.
///
/// # Example
///
/// ```
/// use ferrovue::{hole, slot_into, split_holes};
///
/// // A layout rendered with a hole where the page goes, then sent in two pieces.
/// let mut layout = String::from("<main>");
/// slot_into(&mut layout, Some(hole()), None);
/// layout.push_str("</main>");
///
/// let pieces = split_holes(&layout);
/// assert_eq!(pieces, ["<main><!--[-->", "<!--]--></main>"]);
/// // Write pieces[0], then the page when it is ready, then pieces[1].
/// ```
pub fn hole() -> Slot<'static> {
    Slot::new(&write_hole)
}

/// The pieces of a render between its holes, in order: one more than there were holes. The pieces
/// borrow from `rendered`.
///
/// # Example
///
/// ```
/// use ferrovue::{hole, slot_into, split_holes};
///
/// let mut page = String::from("<h1>Dune</h1>");
/// slot_into(&mut page, Some(hole()), None); // the reviews, written later
/// page.push_str("<aside>");
/// slot_into(&mut page, Some(hole()), None); // related books, written later
/// page.push_str("</aside>");
///
/// let pieces = split_holes(&page);
/// assert_eq!(pieces, ["<h1>Dune</h1><!--[-->", "<!--]--><aside><!--[-->", "<!--]--></aside>"]);
/// // Without holes, the render is one piece.
/// assert_eq!(split_holes("<p>all at once</p>"), ["<p>all at once</p>"]);
/// ```
pub fn split_holes(rendered: &str) -> Vec<&str> {
    rendered.split(HOLE).collect()
}

/// `ssrRenderSlot`: the slot's content between fragment markers, or its fallback when it was given
/// none — or only comments, which is what Vue reads as nothing.
///
/// Returns whether the slot's own content wrote anything but comments, which is what decides
/// whether slot content that forwards this slot is itself empty. The fallback reports for itself.
///
/// Called by generated code at each `<slot>` outlet, with the component's `Slots` field and the
/// slot's fallback, if it has one.
///
/// # Example
///
/// ```
/// use ferrovue::{slot_into, Slot};
///
/// let content = |out: &mut String| out.push_str("<p>given</p>");
/// let mut out = String::new();
/// slot_into(&mut out, Some(Slot::new(&content)), None);
/// assert_eq!(out, "<!--[--><p>given</p><!--]-->");
///
/// out.clear();
/// slot_into(&mut out, None, Some(&mut |out: &mut String| out.push_str("fallback")));
/// assert_eq!(out, "<!--[-->fallback<!--]-->");
/// ```
pub fn slot_into(
    out: &mut String,
    slot: Option<Slot<'_>>,
    fallback: Option<&mut dyn FnMut(&mut String)>,
) -> bool {
    slot_into_slotted(out, slot, "", fallback)
}

/// [`slot_into`] for an outlet that passes a slot scope id, as Vue's `ssrRenderSlot` takes it:
/// `data-v-…-s` from a component with `:slotted` styles, followed by the id its own slot content
/// was given when the outlet forwards a slot; `""` for none. Generated content is given the id after
/// a space; other content ignores it, as static markup does in Vue.
///
/// Called by generated code at each `<slot>` outlet of a component whose styles use `:slotted()`;
/// [`guide::scoped_styles`] shows one.
///
/// # Example
///
/// ```
/// use ferrovue::{slot_into_slotted, Slot};
///
/// // Content from Rust is not given the id, as static markup is not in Vue.
/// let content = |out: &mut String| out.push_str("<p>given</p>");
/// let mut out = String::new();
/// slot_into_slotted(&mut out, Some(Slot::new(&content)), "data-v-421eaec8-s", None);
/// assert_eq!(out, "<!--[--><p>given</p><!--]-->");
///
/// // A fallback is the component's own markup, with its own id.
/// out.clear();
/// slot_into_slotted(&mut out, None, "data-v-421eaec8-s", Some(&mut |out: &mut String| {
///     out.push_str("<i data-v-421eaec8>none</i>");
/// }));
/// assert_eq!(out, "<!--[--><i data-v-421eaec8>none</i><!--]-->");
/// ```
pub fn slot_into_slotted(
    out: &mut String,
    slot: Option<Slot<'_>>,
    slot_scope_id: &str,
    fallback: Option<&mut dyn FnMut(&mut String)>,
) -> bool {
    out.push_str("<!--[-->");
    let start = out.len();
    let filled = match slot.map(|s| s.body) {
        Some(Body::Content(f)) => {
            f(out);
            true
        }
        Some(Body::Markup(f)) => f(out),
        Some(Body::Slotted(f)) => f(out, &content_scope_id(slot_scope_id)),
        None => false,
    };
    // Vue drops content of comments alone whether or not there is a fallback to show instead.
    if !filled {
        out.truncate(start);
        if let Some(fallback) = fallback {
            fallback(out);
        }
    }
    out.push_str("<!--]-->");
    filled
}

/// What `ssrRenderSlotInner` hands slot content for an outlet's slot scope id: the id after a
/// space, or nothing.
fn content_scope_id(slot_scope_id: &str) -> std::borrow::Cow<'_, str> {
    if slot_scope_id.is_empty() {
        std::borrow::Cow::Borrowed("")
    } else {
        std::borrow::Cow::Owned(format!(" {slot_scope_id}"))
    }
}

/// `isComment` in `@vue/server-renderer`, which `ssrRenderSlot` asks of each string slot content
/// pushes: whether it is comments alone, with nothing between them but whitespace. Slot content
/// that pushed nothing else gives way to the fallback.
///
/// Called by generated code on what one push of slot content wrote, when that depends on the
/// values it interpolates: `${of1}<!--[-->` is a comment when `of1` writes nothing.
#[doc(hidden)]
pub fn is_comment(chunk: &str) -> bool {
    // `/^<!--[\s\S]*-->$/`: the opening and closing markers do not overlap.
    if chunk.len() < 7 || !chunk.starts_with("<!--") || !chunk.ends_with("-->") {
        return false;
    }
    // `!chunk.replace(/<!--[^]*?-->/gm, "").trim()`: each comment ends at the first `-->` after it
    // opens, and what is left is whitespace.
    let mut rest = chunk;
    while let Some(open) = rest.find("<!--") {
        if !js_trim(&rest[..open]).is_empty() {
            return false;
        }
        match rest[open + 4..].find("-->") {
            Some(close) => rest = &rest[open + 4 + close + 3..],
            // An unclosed `<!--` is text.
            None => return false,
        }
    }
    js_trim(rest).is_empty()
}

/// `ssrRenderSlot` for a scoped slot: the content, given the props the outlet passes it, between
/// fragment markers — or the fallback when there is no content, or the content wrote only comments.
///
/// `slot` is a component's `Slots` field for a scoped slot, a closure taking the slot's props and
/// returning whether it wrote anything but comments; one written by hand returns `true`, or
/// `false` to discard what it wrote and show the fallback. Returns whether the content was filled,
/// as [`slot_into`] does.
///
/// Called by generated code at each scoped `<slot>` outlet; [`guide::slots`]
/// shows the generated types a parent's closure takes.
///
/// # Example
///
/// ```
/// use ferrovue::scoped_slot_into;
///
/// /// What a component's outlet passes; generated code writes one such struct per scoped slot.
/// struct RowProps<'v> {
///     label: &'v str,
/// }
///
/// let row = |out: &mut String, p: &RowProps<'_>| {
///     ferrovue::escape_into(out, p.label);
///     true
/// };
/// let slot: &dyn for<'v> Fn(&mut String, &RowProps<'v>) -> bool = &row;
/// let mut out = String::new();
/// scoped_slot_into(&mut out, Some(slot), &RowProps { label: "a<b" }, None);
/// assert_eq!(out, "<!--[-->a&lt;b<!--]-->");
/// ```
pub fn scoped_slot_into<P: ?Sized, F: Fn(&mut String, &P) -> bool + ?Sized>(
    out: &mut String,
    slot: Option<&F>,
    props: &P,
    fallback: Option<&mut dyn FnMut(&mut String)>,
) -> bool {
    out.push_str("<!--[-->");
    let start = out.len();
    let filled = slot.is_some_and(|f| f(out, props));
    if !filled {
        // Vue drops content of comments alone, and shows the fallback in its place.
        out.truncate(start);
        if let Some(fallback) = fallback {
            fallback(out);
        }
    }
    out.push_str("<!--]-->");
    filled
}

/// [`scoped_slot_into`] for an outlet that passes a slot scope id, as [`slot_into_slotted`] does:
/// the content is given the props and the id, after a space.
///
/// Called by generated code at each scoped `<slot>` outlet of a component whose styles use
/// `:slotted()`; a parent's closure takes the id as its third parameter, and may write it onto its
/// elements.
///
/// # Example
///
/// ```
/// use ferrovue::scoped_slot_into_slotted;
///
/// /// What a component's outlet passes; generated code writes one such struct per scoped slot.
/// struct FooterProps {
///     count: i64,
/// }
///
/// let footer = |out: &mut String, p: &FooterProps, slot_scope_id: &str| {
///     out.push_str("<small");
///     out.push_str(slot_scope_id);
///     out.push('>');
///     ferrovue::push_int(out, p.count);
///     out.push_str("</small>");
///     true
/// };
/// let slot: &dyn Fn(&mut String, &FooterProps, &str) -> bool = &footer;
/// let mut out = String::new();
/// scoped_slot_into_slotted(&mut out, Some(slot), &FooterProps { count: 2 }, "data-v-421eaec8-s", None);
/// assert_eq!(out, "<!--[--><small data-v-421eaec8-s>2</small><!--]-->");
/// ```
pub fn scoped_slot_into_slotted<P: ?Sized, F: Fn(&mut String, &P, &str) -> bool + ?Sized>(
    out: &mut String,
    slot: Option<&F>,
    props: &P,
    slot_scope_id: &str,
    fallback: Option<&mut dyn FnMut(&mut String)>,
) -> bool {
    let id = content_scope_id(slot_scope_id);
    let content = slot.map(|f| move |out: &mut String, p: &P| f(out, p, &id));
    scoped_slot_into(out, content.as_ref(), props, fallback)
}

/// The scope ids a component's root carries, written as `ssrRenderAttrs` writes them: ` data-v-…`
/// each. Vue builds them as the keys of the component's `attrs` object, so an id already there keeps
/// its place: first those the parent passes on when this component is its root, then the parent's
/// own id (`own`, `""` when it has no scoped styles), then the slot scope ids it is rendered inside
/// (`slotted`, as the slot content was given them).
///
/// Called by generated code for the root of a child component or of a `<RouterLink>`, when the ids
/// it is handed are known only at run time.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::scope_attrs(" data-v-a", "data-v-b", ""), " data-v-a data-v-b");
/// assert_eq!(ferrovue::scope_attrs("", "data-v-a", " data-v-a data-v-c-s"), " data-v-a data-v-c-s");
/// ```
pub fn scope_attrs(inherited: &str, own: &str, slotted: &str) -> String {
    // `inherited` is itself written this way: each key after one space.
    let mut keys: Vec<&str> = inherited.split(' ').filter(|k| !k.is_empty()).collect();
    // Two spaces in a row in a slot scope id make an empty key, which `ssrRenderAttrs` skips.
    for key in std::iter::once(own).chain(js_trim(slotted).split(' ')) {
        if !key.is_empty() && !keys.contains(&key) {
            keys.push(key);
        }
    }
    let mut out = String::with_capacity(keys.iter().map(|k| k.len() + 1).sum());
    for key in keys {
        out.push(' ');
        out.push_str(key);
    }
    out
}

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

/// `escapeHtml`: `"`, `&`, `'`, `<` and `>`, and nothing else.
///
/// Appends `s` to `out` with those five characters written as entities, which makes it safe as
/// text and as a quoted attribute value. Generated code writes every interpolated value through
/// it; use it for any text your own code writes into a page or a slot.
/// [`guide::escaping`] covers what escaping does and does not protect.
///
/// # Example
///
/// ```
/// let mut out = String::from("<p>");
/// ferrovue::escape_into(&mut out, r#"<a href="x">Tom & 'Jerry'</a>"#);
/// assert_eq!(out, "<p>&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
/// ```
pub fn escape_into(out: &mut String, s: &str) {
    // Most strings need nothing escaped, and are then written in one copy.
    if !needs_escape(s.as_bytes()) {
        out.push_str(s);
        return;
    }
    let mut last = 0;
    for (i, b) in s.bytes().enumerate() {
        let rep = match b {
            b'"' => "&quot;",
            b'&' => "&amp;",
            b'\'' => "&#39;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            _ => continue,
        };
        out.push_str(&s[last..i]);
        out.push_str(rep);
        last = i + 1;
    }
    out.push_str(&s[last..]);
}

/// Whether any byte of `s` is one `escapeHtml` replaces, read eight bytes at a time as a `u64`. A
/// byte equal to `c` is the one that `x ^ cccccccc` makes zero, and subtracting 1 from every byte
/// borrows through a zero byte into its top bit; `!t` keeps only the borrows that began there.
fn needs_escape(s: &[u8]) -> bool {
    const ONES: u64 = u64::from_ne_bytes([0x01; 8]);
    const TOPS: u64 = u64::from_ne_bytes([0x80; 8]);
    let special = |word: u64| {
        let zero = |c: u8| {
            let t = word ^ (ONES * u64::from(c));
            t.wrapping_sub(ONES) & !t & TOPS
        };
        (zero(b'"') | zero(b'&') | zero(b'\'') | zero(b'<') | zero(b'>')) != 0
    };
    let Some(last) = s.last_chunk::<8>() else {
        return s
            .iter()
            .any(|b| matches!(b, b'"' | b'&' | b'\'' | b'<' | b'>'));
    };
    // Whole words, then the last eight bytes, which overlap the words already read.
    let (words, _) = s.as_chunks::<8>();
    words.iter().any(|w| special(u64::from_ne_bytes(*w))) || special(u64::from_ne_bytes(*last))
}

/// The largest integer a JavaScript number holds exactly: 2⁵³ − 1.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Two decimal digits for each number below 100, which halves the divisions writing a number takes.
const DIGIT_PAIRS: &[u8; 200] = b"\
    0001020304050607080910111213141516171819\
    2021222324252627282930313233343536373839\
    4041424344454647484950515253545556575859\
    6061626364656667686970717273747576777879\
    8081828384858687888990919293949596979899";

/// The decimal digits of `n`, at the end of `buf`: returns where they start.
fn decimal(buf: &mut [u8; 20], mut n: u64) -> usize {
    let mut i = buf.len();
    while n >= 100 {
        let pair = (n % 100) as usize * 2;
        n /= 100;
        i -= 2;
        buf[i..i + 2].copy_from_slice(&DIGIT_PAIRS[pair..pair + 2]);
    }
    if n >= 10 {
        let pair = n as usize * 2;
        i -= 2;
        buf[i..i + 2].copy_from_slice(&DIGIT_PAIRS[pair..pair + 2]);
    } else {
        i -= 1;
        buf[i] = b'0' + n as u8;
    }
    i
}

/// `n` in decimal. Pushed a character at a time: for the few digits of a number that is quicker
/// than checking them as UTF-8 to push them as a `str`.
fn push_decimal(out: &mut String, n: u64) {
    if n < 10 {
        out.push(char::from(b'0' + n as u8));
        return;
    }
    let mut buf = [0; 20];
    let start = decimal(&mut buf, n);
    out.reserve(buf.len() - start);
    for &b in &buf[start..] {
        out.push(char::from(b));
    }
}

/// `String(n)` for an integer, which is what `toDisplayString` and `escapeHtml` make of a number.
///
/// Exact within ±(2⁵³ − 1). Beyond that a JavaScript number has already lost precision — the
/// browser rounds the value it reads from the island's props — so it is written as JavaScript
/// writes the rounded number, or the page would not hydrate.
///
/// Called by generated code for every interpolated `number` (an `i64`);
/// [`guide::numbers`] explains how numbers are computed and written.
///
/// # Example
///
/// ```
/// let mut out = String::new();
/// ferrovue::push_int(&mut out, 42);
/// out.push(' ');
/// // Beyond 2⁵³ the browser has the rounded number, so that is what is written.
/// ferrovue::push_int(&mut out, 9_007_199_254_740_993);
/// assert_eq!(out, "42 9007199254740992");
/// ```
pub fn push_int(out: &mut String, n: i64) {
    if n.unsigned_abs() <= MAX_SAFE_INTEGER {
        if n < 0 {
            out.push('-');
        }
        push_decimal(out, n.unsigned_abs());
    } else {
        push_number(out, n as f64);
    }
}

/// Up to 32 bytes of formatted text, on the stack: what `{:e}` writes of a double.
struct Short {
    buf: [u8; 32],
    len: usize,
}

impl std::fmt::Write for Short {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        let end = self.len + s.len();
        self.buf
            .get_mut(self.len..end)
            .ok_or(std::fmt::Error)?
            .copy_from_slice(s.as_bytes());
        self.len = end;
        Ok(())
    }
}

/// `Number.prototype.toString()`: JavaScript's shortest round-trip digits, laid out as ECMAScript
/// lays them out — `0.30000000000000004`, `1e+21`, `1.5e-7`, `NaN`, `-Infinity`.
///
/// Called by generated code for every interpolated `Float` (an `f64`) and every fractional
/// result, such as an integer divided by another.
///
/// # Example
///
/// ```
/// let written = |x: f64| {
///     let mut out = String::new();
///     ferrovue::push_number(&mut out, x);
///     out
/// };
/// assert_eq!(written(0.1 + 0.2), "0.30000000000000004");
/// assert_eq!(written(1e21), "1e+21");
/// assert_eq!(written(-0.0), "0");
/// assert_eq!(written(f64::NAN), "NaN");
/// ```
pub fn push_number(out: &mut String, x: f64) {
    use std::fmt::Write;
    if x.is_nan() {
        out.push_str("NaN");
        return;
    }
    if x == 0.0 {
        // Negative zero too: `String(-0)` is `"0"`.
        out.push('0');
        return;
    }
    if x.is_infinite() {
        out.push_str(if x < 0.0 { "-Infinity" } else { "Infinity" });
        return;
    }
    if x < 0.0 {
        out.push('-');
    }
    let x = x.abs();
    // A whole number a double holds exactly is its own shortest spelling, written as an integer.
    if x.fract() == 0.0 && x <= MAX_SAFE_INTEGER as f64 {
        push_decimal(out, x as u64);
        return;
    }
    // `{:e}` writes the shortest digits that round-trip, as JavaScript chooses them: `d.ddde±N`.
    let mut sci = Short {
        buf: [0; 32],
        len: 0,
    };
    let _ = write!(sci, "{x:e}");
    let sci = std::str::from_utf8(&sci.buf[..sci.len]).expect("`{:e}` writes ASCII");
    let (mantissa, exp) = sci.split_once('e').expect("`{:e}` writes an exponent");
    let exp: i32 = exp.parse().expect("`{:e}` writes an integer exponent");
    let mut digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    // ECMAScript breaks a tie between two shortest spellings — the number exactly halfway between
    // them — toward the even digit, where Rust's shortest formatting may round the other way.
    if let Some((exact, exact_exp)) = few_exact_digits(x)
        && exact_exp == exp
    {
        let k = digits.len();
        if exact.len() == k + 1 && exact.ends_with('5') {
            let lower = &exact[..k];
            let upper = increment_digits(lower);
            let even = |d: &str| {
                d.bytes()
                    .last()
                    .is_some_and(|b| (b - b'0').is_multiple_of(2))
            };
            if upper.len() == k && (digits == lower || digits == upper) {
                digits = if even(lower) { lower.to_owned() } else { upper };
            }
        }
    }
    let k = digits.len() as i32;
    // The position of the decimal point relative to the digits, as the specification's `n`.
    let n = exp + 1;
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let e = n - 1;
        let _ = write!(out, "e{}{}", if e < 0 { '-' } else { '+' }, e.abs());
    }
}

/// The significant digits of a positive, finite `x`'s exact decimal value, and the exponent of the
/// first, when there are few enough of them for `x` to be a tie between two shortest spellings:
/// those have at most 17 digits, so the tie at most 18. `None` when there are more.
///
/// `x` is `m × 2^e` with `m` odd. With `e < 0` that is `m × 5^-e × 10^e`, whose digits are those
/// of `m × 5^-e`, an odd number: more than 18 of them once `-e` reaches 26. With `e ≥ 0` it is the
/// integer `m × 2^e`, whose digits are counted without the zeros it ends with; a tie of at most 18
/// digits times `10^z` is divisible by `5^z`, so `m` is, which caps `z` at 22 and `e` at
/// `log2(10^18) + 22 < 82`.
fn few_exact_digits(x: f64) -> Option<(String, i32)> {
    let bits = x.to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1 << 52) - 1);
    let (m, e) = if biased == 0 {
        (fraction, -1074)
    } else {
        (fraction | 1 << 52, biased - 1075)
    };
    let shift = m.trailing_zeros();
    let (m, e) = (m >> shift, e + shift as i32);
    let (value, scale) = if e < 0 {
        if -e >= 26 {
            return None;
        }
        (u128::from(m) * 5u128.pow(e.unsigned_abs()), e)
    } else if e <= 74 {
        (u128::from(m) << e, 0)
    } else if e < 82 {
        // Beyond `u128`, below 2¹³⁴: 41 digits write it exactly.
        use std::fmt::Write;
        let mut s = String::new();
        let _ = write!(s, "{x:.40e}");
        let (mantissa, exp) = s.split_once('e')?;
        let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
        let digits = digits.trim_end_matches('0');
        let exp = exp.parse().ok()?;
        return (digits.len() <= 18).then(|| (digits.to_owned(), exp));
    } else {
        return None;
    };
    let all = value.to_string();
    let digits = all.trim_end_matches('0');
    (digits.len() <= 18).then(|| (digits.to_owned(), all.len() as i32 - 1 + scale))
}

/// `Math.round`: the nearest integer, a half rounding up toward +∞ — `-2.5` to `-2`, where Rust's
/// `f64::round` gives `-3` — and `-0` from `-0.5` up to zero, which `1 / Math.round(x)` shows.
///
/// # Example
///
/// ```
/// use ferrovue::js_round;
///
/// assert_eq!(js_round(2.5), 3.0);
/// assert_eq!(js_round(-2.5), -2.0); // `f64::round` gives -3
/// assert_eq!(js_round(-2.6), -3.0);
/// assert!(js_round(-0.2).is_sign_negative()); // -0, as JavaScript gives
/// assert!(js_round(f64::NAN).is_nan());
/// ```
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    let r = if x - f >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 && x.is_sign_negative() {
        -0.0
    } else {
        r
    }
}

/// `Math.max` of two numbers: `NaN` if either is, where Rust's `f64::max` ignores a `NaN`.
///
/// `+0` is larger than `-0`, as in JavaScript.
///
/// # Example
///
/// ```
/// use ferrovue::js_max;
///
/// assert_eq!(js_max(2.0, 3.5), 3.5);
/// assert!(js_max(1.0, f64::NAN).is_nan()); // `f64::max` gives 1
/// assert!(js_max(-0.0, 0.0).is_sign_positive());
/// ```
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b || (a == b && b.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `Math.min` of two numbers: `NaN` if either is, where Rust's `f64::min` ignores a `NaN`.
///
/// `-0` is smaller than `+0`, as in JavaScript.
///
/// # Example
///
/// ```
/// use ferrovue::js_min;
///
/// assert_eq!(js_min(2.0, 3.5), 2.0);
/// assert!(js_min(1.0, f64::NAN).is_nan()); // `f64::min` gives 1
/// assert!(js_min(0.0, -0.0).is_sign_negative());
/// ```
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b || (a == b && a.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `Number.prototype.toFixed(digits)`: the number rounded to `digits` places, from its exact binary
/// value. An exact tie rounds away from zero, where Rust's formatting rounds it to even; at 10²¹ and
/// beyond, JavaScript writes the number as `String(x)` does.
///
/// # Example
///
/// ```
/// use ferrovue::js_to_fixed;
///
/// assert_eq!(js_to_fixed(2.5, 0), "3"); // an exact tie, away from zero; Rust's `{:.0}` gives "2"
/// assert_eq!(js_to_fixed(1.005, 2), "1.00"); // 1.005 is a little less as a double
/// assert_eq!(js_to_fixed(-0.04, 1), "-0.0");
/// assert_eq!(js_to_fixed(1e21, 2), "1e+21");
/// ```
pub fn js_to_fixed(x: f64, digits: u32) -> String {
    use std::fmt::Write;
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x.abs() >= 1e21 || x.is_infinite() {
        let mut s = String::new();
        push_number(&mut s, x);
        return s;
    }
    let d = digits as usize;
    let mut out = String::new();
    let _ = write!(out, "{:.*}", d, x.abs());
    // Rust rounds from the exact value too, and differs only on an exact tie: a value whose exact
    // decimal expansion ends with a 5 one place past the last digit kept.
    let mut exact = String::new();
    let _ = write!(exact, "{:.1100}", x.abs());
    let exact = exact.trim_end_matches('0');
    let fraction = exact.split_once('.').map_or("", |(_, f)| f);
    if fraction.len() == d + 1 && fraction.ends_with('5') {
        out = round_up_magnitude(&exact[..exact.len() - 1]);
    }
    // `-0.toFixed(1)` is "0.0", and a negative that rounds to zero keeps its sign: "-0.0".
    if x < 0.0 {
        out.insert(0, '-');
    }
    out
}

/// A decimal string's last digit plus one, carrying: `"2."` to `"3"`, `"1.99"` to `"2.00"`.
fn round_up_magnitude(digits: &str) -> String {
    let digits = digits.trim_end_matches('.');
    let mut bytes: Vec<u8> = digits.bytes().collect();
    let mut i = bytes.len();
    loop {
        if i == 0 {
            bytes.insert(0, b'1');
            break;
        }
        i -= 1;
        match bytes[i] {
            b'.' => continue,
            b'9' => bytes[i] = b'0',
            d => {
                bytes[i] = d + 1;
                break;
            }
        }
    }
    String::from_utf8(bytes).expect("ASCII digits")
}

/// A string of decimal digits plus one in its last place, carrying: `"129"` to `"130"`.
fn increment_digits(digits: &str) -> String {
    let mut bytes: Vec<u8> = digits.bytes().collect();
    for b in bytes.iter_mut().rev() {
        if *b == b'9' {
            *b = b'0';
        } else {
            *b += 1;
            return String::from_utf8(bytes).expect("ASCII digits");
        }
    }
    bytes.insert(0, b'1');
    String::from_utf8(bytes).expect("ASCII digits")
}

/// A number written as JavaScript writes it, for `format!` in generated code: `${n}` in a template
/// literal, `"#" + n`, `n.toString()`.
///
/// `Display` is implemented for `Js<i64>`, written as [`push_int`] writes it, and `Js<f64>`,
/// written as [`push_number`] writes it.
///
/// # Example
///
/// ```
/// use ferrovue::Js;
///
/// assert_eq!(format!("{} items", Js(3_i64)), "3 items");
/// assert_eq!(format!("{}", Js(1.5e-7_f64)), "1.5e-7");
/// ```
#[derive(Debug, Clone, Copy)]
pub struct Js<T>(pub T);

impl std::fmt::Display for Js<i64> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.0.unsigned_abs() > MAX_SAFE_INTEGER {
            return Js(self.0 as f64).fmt(f);
        }
        let mut buf = [0; 20];
        let start = decimal(&mut buf, self.0.unsigned_abs());
        if self.0 < 0 {
            f.write_str("-")?;
        }
        f.write_str(std::str::from_utf8(&buf[start..]).expect("ASCII digits"))
    }
}

impl std::fmt::Display for Js<f64> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut s = String::new();
        push_number(&mut s, self.0);
        f.write_str(&s)
    }
}

/// `String.prototype.length`: UTF-16 code units, which is what a template's `.length` counts — not
/// the UTF-8 bytes of `str::len`, nor the scalar values of `chars().count()`.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_length("café"), 4);
/// assert_eq!(ferrovue::js_length("🦀"), 2); // two UTF-16 code units, as JavaScript counts
/// ```
pub fn js_length(s: &str) -> i64 {
    // Each scalar value is one code unit, or two when it is outside the Basic Multilingual Plane —
    // exactly the four-byte UTF-8 sequences. Most strings are ASCII, where it is the length.
    if s.is_ascii() {
        return s.len() as i64;
    }
    s.chars().map(char::len_utf16).sum::<usize>() as i64
}

/// `String.prototype.trim`: ECMAScript's WhiteSpace and LineTerminator sets, which are not Rust's
/// `char::is_whitespace` — JavaScript trims U+FEFF and keeps U+0085.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_trim("\u{feff} a \u{3000}"), "a");
/// assert_eq!(ferrovue::js_trim("\u{85}a"), "\u{85}a"); // JavaScript keeps U+0085
/// ```
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `String.prototype.trimStart`: [`js_trim`] at the start alone.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_trim_start("\u{a0} a "), "a ");
/// ```
pub fn js_trim_start(s: &str) -> &str {
    s.trim_start_matches(is_js_space)
}

/// `String.prototype.trimEnd`: [`js_trim`] at the end alone.
///
/// # Example
///
/// ```
/// assert_eq!(ferrovue::js_trim_end(" a \u{feff}"), " a");
/// ```
pub fn js_trim_end(s: &str) -> &str {
    s.trim_end_matches(is_js_space)
}

fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{A}' | '\u{B}' | '\u{C}' | '\u{D}' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `escapeHtml(normalizeClass([...]))` for a list of strings: each one trimmed, the empty ones
/// dropped, the rest joined with one space. `after` says a class has already been written, so the
/// first item written here needs a separator too.
///
/// Called by generated code for a bound `:class`, inside the attribute's quotes, and for the
/// classes of a `<RouterLink>`.
///
/// # Example
///
/// ```
/// let mut out = String::from("card");
/// ferrovue::class_into(&mut out, true, &[" big ", "", "x<y"]);
/// assert_eq!(out, "card big x&lt;y");
/// ```
pub fn class_into(out: &mut String, after: bool, items: &[&str]) {
    let mut sep = after;
    for item in items {
        let item = js_trim(item);
        if item.is_empty() {
            continue;
        }
        if sep {
            out.push(' ');
        }
        escape_into(out, item);
        sep = true;
    }
}

/// `normalizeClass` of an object: the names whose condition holds, each followed by a space, the
/// whole trimmed once — so a name's own surrounding spaces survive between its neighbours, as in
/// Vue. Generated code uses it for an object with computed names, which may hold any text.
///
/// # Example
///
/// ```
/// // `{ active: true, [" wide "]: true, hidden: false }`
/// assert_eq!(ferrovue::class_object(&[(true, "active"), (true, " wide "), (false, "hidden")]), "active  wide");
/// ```
pub fn class_object(entries: &[(bool, &str)]) -> String {
    // A JavaScript object: a name given twice is one name, where it first appeared, with the last
    // condition given; and names that are array indices — `"0"`, `"12"` — come first, in numeric
    // order, before the others in the order they were added.
    let mut names: Vec<(&str, bool)> = Vec::new();
    for (on, name) in entries {
        match names.iter_mut().find(|(n, _)| n == name) {
            Some(entry) => entry.1 = *on,
            None => names.push((name, *on)),
        }
    }
    let mut ordered: Vec<(Option<u32>, &str, bool)> = names
        .into_iter()
        .map(|(n, on)| (record::array_index(n), n, on))
        .collect();
    // Stable: the indices sorted among themselves, the other names kept as they came.
    ordered.sort_by_key(|(i, _, _)| i.map_or((1, 0), |i| (0, i)));
    let mut s = String::new();
    for (_, name, on) in ordered {
        if on {
            s.push_str(name);
            s.push(' ');
        }
    }
    js_trim(&s).to_owned()
}

/// The stores' state as the client reads it back before it hydrates: a `<script type="application/json">`,
/// which a `script-src 'self'` policy does not run, so the page needs no nonce for it. `<`, `>`, `&`
/// and the two line separators are written as JSON escapes, so no value can end the element or be
/// read as markup inside it.
///
/// `id` is the element's `id`, which the client looks the state up by: `"__pinia"` is what
/// `hydrateState` from `ferrovue/client` reads by default. `state` is usually the generated
/// `stores::Stores`; see [`guide::pinia`].
///
/// # Example
///
/// ```
/// let state = serde_json::json!({ "prefs": { "theme": "</script>" } });
/// let mut page = String::new();
/// ferrovue::state_script_into(&mut page, "__pinia", &state);
/// assert_eq!(
///     page,
///     r#"<script type="application/json" id="__pinia">{"prefs":{"theme":"\u003c/script\u003e"}}</script>"#
/// );
/// ```
pub fn state_script_into(out: &mut String, id: &str, state: &impl Serialize) {
    out.push_str("<script type=\"application/json\" id=\"");
    escape_into(out, id);
    out.push_str("\">");
    // As in `island_into`: a struct of strings, numbers and lists cannot fail to serialise, and if it
    // somehow did the client would find no state and render from its own. `NaN` and the infinities
    // are written as JavaScript writes them, which `hydrateState` reads back.
    let json = json::to_string(state);
    json_escaped_into(out, &json);
    out.push_str("</script>");
}

/// JSON with `<`, `>`, `&`, U+2028 and U+2029 written as escapes. The runs between them are copied
/// whole: every byte matched is the first of its character, so each cut is at a char boundary.
fn json_escaped_into(out: &mut String, json: &str) {
    out.reserve(json.len());
    let bytes = json.as_bytes();
    let (mut last, mut i) = (0, 0);
    while i < bytes.len() {
        let (rep, width) = match bytes[i] {
            b'<' => ("\\u003c", 1),
            b'>' => ("\\u003e", 1),
            b'&' => ("\\u0026", 1),
            // U+2028 and U+2029 are E2 80 A8 and E2 80 A9.
            0xE2 if bytes.get(i + 1) == Some(&0x80) && bytes.get(i + 2) == Some(&0xA8) => {
                ("\\u2028", 3)
            }
            0xE2 if bytes.get(i + 1) == Some(&0x80) && bytes.get(i + 2) == Some(&0xA9) => {
                ("\\u2029", 3)
            }
            _ => {
                i += 1;
                continue;
            }
        };
        out.push_str(&json[last..i]);
        out.push_str(rep);
        i += width;
        last = i;
    }
    out.push_str(&json[last..]);
}

/// The island wrapper: the component's own markup inside the element the client mounts on, with
/// the props it was rendered from as JSON in an attribute — never a `<script>`, so a page with a
/// `script-src 'self'` policy needs no nonce for it.
fn island_into<P: Serialize>(
    out: &mut String,
    name: &str,
    props: &P,
    render: &impl Fn(&mut String, &P),
) {
    out.push_str("<div data-island=\"");
    escape_into(out, name);
    out.push_str("\" data-props=\"");
    // A struct of strings, numbers and lists cannot fail to serialise; if it somehow did, the client
    // finds malformed props and leaves the server's markup as it is. `NaN` and the infinities are
    // written as JavaScript writes them, which `mountIslands` reads back, where `serde_json` alone
    // would write `null`. Serialised whole and then escaped: `serde_json` writes in many small
    // pieces, and escaping each one costs more than the one extra buffer.
    let json = json::to_string(props);
    escape_into(out, &json);
    out.push_str("\">");
    render(out, props);
    out.push_str("</div>");
}

mod attrs;
#[cfg(any(doc, doctest))]
pub mod guide;
pub mod i18n;
mod json;
mod record;
mod router;
mod strings;
mod teleport;
pub use attrs::{
    Attr, Attrs, attrs_into, class_names, merge_props, passed_attrs_into, style_text_into,
};
pub use i18n::I18n;
pub use record::Record;
pub use router::{Link, Query, Route, RouteDef, Router, query_into};
pub use strings::{
    js_at, js_char_at, js_cmp, js_index_of, js_json_number, js_json_string, js_last_index_of,
    js_number, js_pad_end, js_pad_start, js_parse_float, js_parse_int, js_repeat, js_replace,
    js_replace_all, js_slice, js_slice_items, js_slice_range, js_split, js_substring,
};
pub use teleport::{Teleports, teleport_into};
#[cfg(feature = "stream")]
mod web;
#[cfg(feature = "stream")]
pub use web::HtmlStream;

#[cfg(test)]
mod tests;
