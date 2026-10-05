//! [`Html`]: a component applied to its props, and the island wrapper the client mounts on.

use serde::Serialize;

use crate::{escape_into, json};

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
    pub(crate) props: Given<'p, P>,
    pub(crate) render: F,
    /// `Some(name)` wraps the markup as a hydratable island; `None` is the markup alone.
    pub(crate) island: Option<&'static str>,
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
pub(crate) enum Given<'p, P> {
    Borrowed(&'p P),
    Owned(P),
}

impl<P> Given<'_, P> {
    #[inline]
    pub(crate) fn get(&self) -> &P {
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

#[cfg(test)]
mod tests;
