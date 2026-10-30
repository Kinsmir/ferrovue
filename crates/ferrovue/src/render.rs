use crate::date::JsTime;
use crate::strings::js_trim;
use std::cell::Cell;
use std::fmt;

/// A render that cannot write what Vue's `renderToString` writes for these props: a date string
/// browsers read differently, an integer beyond the range of `i64` where the template needs one,
/// a string longer than JavaScript allows. A generated `try_render` returns it, so a server can
/// answer `400 Bad Request`; `render` panics with its message.
///
/// It carries the error code, the component and the place in its file where the template asks for
/// the value, and a message saying what was refused and what to do.
/// [`errors_and_limits`](crate::guide::errors_and_limits#refused-at-render-time) shows a handler
/// answering with it.
///
/// # Example
///
/// ```
/// # mod published {
/// #     use ferrovue as fv;
/// #     pub const NAME: &str = "Published";
/// #     pub struct Props<'a> { pub on: &'a str }
/// #     pub fn render(out: &mut String, props: &Props<'_>) {
/// #         fv::render::rendered(try_render(out, props));
/// #     }
/// #     pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::render::Refused> {
/// #         let fv_refusals = fv::render::Refusals::new(NAME, "components/Published.vue");
/// #         out.push_str("<time>");
/// #         fv::core::escape_into(out, &fv_refusals.keep(fv::date::try_to_iso_string(fv_refusals.keep(fv::date::try_date_parse(props.on), 3, 25)), 3, 9));
/// #         out.push_str("</time>");
/// #         fv_refusals.check(Ok(()))
/// #     }
/// # }
/// // Published.vue: <time>{{ new Date(on).toISOString() }}</time>
/// let mut out = String::new();
/// published::try_render(&mut out, &published::Props { on: "2024-05-01" })?;
/// assert_eq!(out, "<time>2024-05-01T00:00:00.000Z</time>");
///
/// let refused = published::try_render(&mut String::new(), &published::Props { on: "May 1" })
///     .unwrap_err();
/// assert_eq!(refused.code(), "FV1803");
/// assert_eq!(refused.component(), Some("Published"));
/// assert_eq!(refused.file(), Some("components/Published.vue"));
/// assert_eq!((refused.line(), refused.column()), (Some(3), Some(25)));
/// assert!(refused.to_string().starts_with("error[FV1803]: components/Published.vue:3:25: "));
/// # Ok::<(), ferrovue::render::Refused>(())
/// ```
#[non_exhaustive]
#[derive(Clone)]
pub struct Refused(Box<Inner>);

#[derive(Debug, Clone)]
struct Inner {
    code: &'static str,
    message: String,
    component: Option<&'static str>,
    file: Option<&'static str>,
    line: u32,
    column: u32,
    seq: u64,
}

thread_local! {
    static SEQ: Cell<u64> = const { Cell::new(0) };
}

impl Refused {
    /// A refusal with its error code and message, not yet located. For the runtime and generated
    /// code.
    #[doc(hidden)]
    #[must_use]
    #[cold]
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        let seq = SEQ.with(|s| {
            let n = s.get().wrapping_add(1);
            s.set(n);
            n
        });
        Refused(Box::new(Inner {
            code,
            message: message.into(),
            component: None,
            file: None,
            line: 0,
            column: 0,
            seq,
        }))
    }

    /// The error code, such as `"FV1803"`, which
    /// [`error_codes`](crate::guide::error_codes) explains.
    #[must_use]
    pub fn code(&self) -> &'static str {
        self.0.code
    }

    /// What was refused, and what to do.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.0.message
    }

    /// The name of the component whose template asks for the value, as its `NAME` holds it.
    #[must_use]
    pub fn component(&self) -> Option<&'static str> {
        self.0.component
    }

    /// The component's file, as the compiler named it.
    #[must_use]
    pub fn file(&self) -> Option<&'static str> {
        self.0.file
    }

    /// The line of the file where the template or the script asks for the value, from 1.
    #[must_use]
    pub fn line(&self) -> Option<u32> {
        (self.0.line > 0).then_some(self.0.line)
    }

    /// The column of that line, from 1.
    #[must_use]
    pub fn column(&self) -> Option<u32> {
        (self.0.line > 0 && self.0.column > 0).then_some(self.0.column)
    }

    #[cold]
    fn located(
        mut self,
        component: &'static str,
        file: &'static str,
        line: u32,
        column: u32,
    ) -> Self {
        if self.0.component.is_none() {
            self.0.component = Some(component);
            self.0.file = Some(file);
            self.0.line = line;
            self.0.column = column;
        }
        self
    }
}

impl fmt::Display for Refused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "error[{}]: ", self.0.code)?;
        if let Some(file) = self.0.file {
            f.write_str(file)?;
            if let Some(line) = self.line() {
                write!(f, ":{line}")?;
                if let Some(column) = self.column() {
                    write!(f, ":{column}")?;
                }
            }
            f.write_str(": ")?;
        }
        f.write_str(&self.0.message)
    }
}

impl fmt::Debug for Refused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Refused")
            .field("code", &self.0.code)
            .field("message", &self.0.message)
            .field("component", &self.0.component)
            .field("file", &self.0.file)
            .field("line", &self.line())
            .field("column", &self.column())
            .finish()
    }
}

impl std::error::Error for Refused {}

/// The refusals of one component's render: the first in the order the render met them, which
/// it returns. Generated code keeps each fallible value with [`keep`](Self::keep), where a
/// refusal is held and the render goes on with a placeholder, and returns with
/// [`check`](Self::check).
#[doc(hidden)]
pub struct Refusals {
    first: Cell<Option<Refused>>,
    component: &'static str,
    file: &'static str,
}

impl Refusals {
    /// No refusal yet, in the component called `component`, written in `file`.
    #[must_use]
    #[inline]
    pub const fn new(component: &'static str, file: &'static str) -> Self {
        Refusals {
            first: Cell::new(None),
            component,
            file,
        }
    }

    /// The value, or its type's default once the refusal, located at `line` and `column` of the
    /// component's file, is held.
    #[inline]
    pub fn keep<T: Default>(&self, value: Result<T, Refused>, line: u32, column: u32) -> T {
        match value {
            Ok(v) => v,
            Err(refused) => {
                self.hold(refused.located(self.component, self.file, line, column));
                T::default()
            }
        }
    }

    /// The date `t` as a child's `Date` prop of type `T`, or the epoch once the refusal is held
    /// where `T` cannot hold `t`.
    ///
    /// # Panics
    ///
    /// With the refusal's message where `T` cannot hold the epoch either.
    #[inline]
    pub fn date<T: JsTime>(&self, t: f64, line: u32, column: u32) -> T {
        if let Some(date) = T::from_time_value(t) {
            return date;
        }
        let refused = crate::date::date_refused(t).located(self.component, self.file, line, column);
        let Some(epoch) = T::from_time_value(0.0) else {
            panic!("{refused}");
        };
        self.hold(refused);
        epoch
    }

    /// Hold what a child's render returned.
    #[inline]
    pub fn join(&self, rendered: Result<(), Refused>) {
        if let Err(refused) = rendered {
            self.hold(refused);
        }
    }

    /// The first refusal, of those held and `rendered`'s; `rendered` when none is held.
    #[inline]
    pub fn check(&self, rendered: Result<(), Refused>) -> Result<(), Refused> {
        first(self.first.take(), rendered)
    }

    #[cold]
    fn hold(&self, refused: Refused) {
        let held = self.first.take();
        self.first.set(first(held, Err(refused)).err());
    }
}

pub(crate) fn first(held: Option<Refused>, rendered: Result<(), Refused>) -> Result<(), Refused> {
    match (held, rendered) {
        (None, rendered) => rendered,
        (Some(held), Err(other)) if other.0.seq < held.0.seq => Err(other),
        (Some(held), _) => Err(held),
    }
}

impl fmt::Debug for Refusals {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Refusals")
            .field("component", &self.component)
            .field("file", &self.file)
            .finish_non_exhaustive()
    }
}

/// What a generated `render` does with its `try_render`: nothing when it rendered.
///
/// # Panics
///
/// With the refusal's message.
#[doc(hidden)]
#[inline]
#[track_caller]
pub fn rendered(result: Result<(), Refused>) {
    if let Err(refused) = result {
        refuse(&refused);
    }
}

#[cold]
#[inline(never)]
#[track_caller]
fn refuse(refused: &Refused) -> ! {
    panic!("{refused}")
}

const I64_LIMIT: f64 = 9_223_372_036_854_775_808.0;

/// An integer the template computed as JavaScript does, as a double, held as an `i64`: a child's
/// `number` prop, an index, a range's count, or an integer a `computed`, a variable, a list or a
/// callback keeps.
///
/// # Errors
///
/// FV0724 where `x` is not an integer within the range of `i64`, which the `i64` cannot hold.
#[doc(hidden)]
#[inline]
pub fn try_int(x: f64) -> Result<i64, Refused> {
    if (-I64_LIMIT..I64_LIMIT).contains(&x) && x.fract() == 0.0 {
        Ok(x as i64)
    } else {
        Err(int_refused(x))
    }
}

#[cold]
fn int_refused(x: f64) -> Refused {
    let mut shown = String::new();
    ferrovue_core::push_number(&mut shown, x);
    Refused::new(
        "FV0724",
        format!(
            "the number {shown} is beyond the range of i64, where the generated code holds an integer \
             as an i64 (a child's `number` prop, an index, a range's count, or an integer a \
             `computed`, a variable, a list or a callback such as `.reduce()`'s keeps): check the \
             props before rendering and keep them within ±2⁵³, where JavaScript's integers are \
             exact, or type the numbers it is computed from `Float`"
        ),
    )
}

/// What a parent puts in one of a component's slots.
///
/// # Example
///
/// ```
/// use ferrovue::render::{slot_into, Slot};
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
    Content(&'s dyn Fn(&mut String)),
    Markup(&'s dyn Fn(&mut String) -> bool),
    Slotted(&'s dyn Fn(&mut String, &str) -> bool),
}

impl<'s> Slot<'s> {
    /// Content for a slot: another component's render, or markup the caller already holds. The
    /// slot's fallback never replaces it, even when the closure writes nothing, as a component in
    /// a slot is always content to Vue; to show the fallback, give the slot `None`.
    ///
    /// The closure's output is written as it is, unescaped: escape any text it writes with
    /// [`escape_into`](crate::core::escape_into).
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::render::{slot_into, Slot};
    ///
    /// let name = "<Ada>";
    /// let content = |out: &mut String| {
    ///     out.push_str("<b>");
    ///     ferrovue::core::escape_into(out, name);
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
    #[must_use]
    pub fn new(render: &'s dyn Fn(&mut String)) -> Self {
        Slot {
            body: Body::Content(render),
        }
    }

    /// A generated parent's slot content, returning whether it pushed anything but a comment.
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
    /// ferrovue::render::Slot::new(&page).render_to(&mut out);
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

impl std::fmt::Debug for Slot<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Slot").finish_non_exhaustive()
    }
}

/// `ssrRenderSlot`: the slot's content between fragment markers, or its fallback when it was given
/// none, or only comments, which is what Vue reads as nothing.
///
/// Returns whether the slot's own content wrote anything but comments.
///
/// # Example
///
/// ```
/// use ferrovue::render::{slot_into, Slot};
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
/// # Example
///
/// ```
/// use ferrovue::render::{slot_into_slotted, Slot};
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
#[doc(hidden)]
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
    if !filled {
        out.truncate(start);
        if let Some(fallback) = fallback {
            fallback(out);
        }
    }
    out.push_str("<!--]-->");
    filled
}

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
#[doc(hidden)]
#[must_use]
pub fn is_comment(chunk: &str) -> bool {
    if chunk.len() < 7 || !chunk.starts_with("<!--") || !chunk.ends_with("-->") {
        return false;
    }
    let mut rest = chunk;
    while let Some(open) = rest.find("<!--") {
        if !js_trim(&rest[..open]).is_empty() {
            return false;
        }
        match rest[open + 4..].find("-->") {
            Some(close) => rest = &rest[open + 4 + close + 3..],
            None => return false,
        }
    }
    js_trim(rest).is_empty()
}

/// `ssrRenderSlot` for a scoped slot: the content, given the props the outlet passes it, between
/// fragment markers, or the fallback when there is no content, or the content wrote only comments.
///
/// `slot` is a closure taking the slot's props and returning whether it wrote anything but
/// comments; one written by hand returns `true`, or `false` to discard what it wrote and show the
/// fallback. Returns whether the content was filled, as [`slot_into`] does.
///
/// # Example
///
/// ```
/// use ferrovue::render::scoped_slot_into;
///
/// /// What a component's outlet passes; generated code writes one such struct per scoped slot.
/// struct RowProps<'v> {
///     label: &'v str,
/// }
///
/// let row = |out: &mut String, p: &RowProps<'_>| {
///     ferrovue::core::escape_into(out, p.label);
///     true
/// };
/// let slot: &dyn for<'v> Fn(&mut String, &RowProps<'v>) -> bool = &row;
/// let mut out = String::new();
/// scoped_slot_into(&mut out, Some(slot), &RowProps { label: "a<b" }, None);
/// assert_eq!(out, "<!--[-->a&lt;b<!--]-->");
/// ```
#[doc(hidden)]
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
/// # Example
///
/// ```
/// use ferrovue::render::scoped_slot_into_slotted;
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
///     ferrovue::core::push_int(out, p.count);
///     out.push_str("</small>");
///     true
/// };
/// let slot: &dyn Fn(&mut String, &FooterProps, &str) -> bool = &footer;
/// let mut out = String::new();
/// scoped_slot_into_slotted(&mut out, Some(slot), &FooterProps { count: 2 }, "data-v-421eaec8-s", None);
/// assert_eq!(out, "<!--[--><small data-v-421eaec8-s>2</small><!--]-->");
/// ```
#[doc(hidden)]
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
