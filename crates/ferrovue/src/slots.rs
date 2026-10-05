//! Slots: `ssrRenderSlot` at a component's `<slot>` outlets, scoped slots, and holes for content
//! written later.

use crate::js_trim;

/// What a parent puts in one of a component's slots.
///
/// A generated component that renders `<slot>` has a `Slots` struct with a field per slot:
/// `Option<Slot>`, where `None` shows the slot's fallback, or a plain `Slot` for the page
/// `<RouterView>` shows. From Rust, make one with [`Slot::new`] from a closure that writes the
/// content, or with [`hole`] for content written later. It borrows the closure, and is `Copy`.
///
/// A scoped slot is not a `Slot` but a closure given the outlet's props; see [`scoped_slot_into`]
/// and [`guide::slots`](crate::guide::slots).
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
    /// [`escape_into`](crate::escape_into).
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
pub(crate) const HOLE: &str = "<fv-hole>";

fn write_hole(out: &mut String) {
    out.push_str(HOLE);
}

/// A slot whose content the caller writes itself, later: render with holes, [`split_holes`] the
/// output, and write the pieces with each hole's content between them — which is how a page streams
/// its parts in the order they are ready. A hole is content to the slot, so its fallback never
/// shows. [`guide::streaming`](crate::guide::streaming) shows a whole streamed page.
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
/// [`guide::scoped_styles`](crate::guide::scoped_styles) shows one.
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
/// Called by generated code at each scoped `<slot>` outlet; [`guide::slots`](crate::guide::slots)
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

#[cfg(test)]
mod tests;
