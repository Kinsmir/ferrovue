use serde::Serialize;

use ferrovue_core::escape::escape_into;

use crate::{
    hydrate::Hydrate,
    json,
    refused::{Refused, rendered},
};

/// A component applied to its props, ready to be written: what a generated `html()` or `island()`
/// returns, borrowing the props, and `into_html()` or `into_island()`, holding them.
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
/// #     fv::core::escape::escape_into(out, &*props.name);
/// #     out.push_str("!</p>");
/// # }
/// # pub fn html<'p, 'a>(props: &'p Props<'a>) -> fv::html::Html<'p, Props<'a>> {
/// #     fv::html::Html::markup(props, render)
/// # }
/// # pub fn island<'p, 'a>(props: &'p Props<'a>) -> fv::html::Html<'p, Props<'a>> {
/// #     fv::html::Html::island(NAME, props, render)
/// # }
/// # pub fn into_html<'a>(props: Props<'a>) -> fv::html::Html<'a, Props<'a>> {
/// #     fv::html::Html::markup_owned(props, render)
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
/// fn greet(name: String) -> ferrovue::html::Html<'static, hello::Props<'static>> {
///     hello::into_html(hello::Props::new(name))
/// }
/// assert_eq!(greet("Grace".into()).into_string(), "<p>Hello, Grace!</p>");
/// ```
pub struct Html<'p, P, F = fn(&mut String, &P)> {
    pub(crate) props: Given<'p, P>,
    pub(crate) render: F,
    pub(crate) fallible: Option<TryRender<P>>,
    pub(crate) island: Option<&'static str>,
    pub(crate) hydrate: Option<Hydrate>,
    pub(crate) dates: &'static str,
}

type TryRender<P> = fn(&mut String, &P) -> Result<(), Refused>;

/// What writes a component's markup into an [`Html`]: a generated `render`, or a generated
/// `try_render` wrapped in [`Fallible`]. For generated code.
#[doc(hidden)]
pub trait Renderer<P: ?Sized> {
    /// Write the markup of `props` into `out`, or return the refusal.
    ///
    /// # Errors
    ///
    /// The refusal of a render that cannot write what Vue writes.
    fn try_render(&self, out: &mut String, props: &P) -> Result<(), Refused>;
}

impl<P: ?Sized, F: Fn(&mut String, &P)> Renderer<P> for F {
    #[inline]
    fn try_render(&self, out: &mut String, props: &P) -> Result<(), Refused> {
        self(out, props);
        Ok(())
    }
}

/// A renderer that returns its refusals, as a generated `try_render` does. For generated code.
#[doc(hidden)]
#[derive(Debug, Clone, Copy)]
pub struct Fallible<F>(pub F);

impl<P: ?Sized, F: Fn(&mut String, &P) -> Result<(), Refused>> Renderer<P> for Fallible<F> {
    #[inline]
    fn try_render(&self, out: &mut String, props: &P) -> Result<(), Refused> {
        (self.0)(out, props)
    }
}

impl<'p, P: Serialize> Html<'p, P> {
    /// [`Html::markup`] of a component whose `try_render` returns its refusals. For generated
    /// code, as [`Html::markup`] is.
    #[doc(hidden)]
    #[must_use]
    pub fn markup_fallible(
        props: &'p P,
        render: fn(&mut String, &P),
        try_render: TryRender<P>,
    ) -> Self {
        Html {
            fallible: Some(try_render),
            ..Html::markup(props, render)
        }
    }

    /// [`Html::island`] of a component whose `try_render` returns its refusals. For generated
    /// code, as [`Html::markup`] is.
    #[doc(hidden)]
    #[must_use]
    pub fn island_fallible(
        name: &'static str,
        props: &'p P,
        render: fn(&mut String, &P),
        try_render: TryRender<P>,
    ) -> Self {
        Html {
            fallible: Some(try_render),
            ..Html::island(name, props, render)
        }
    }

    /// [`Html::markup_owned`] of a component whose `try_render` returns its refusals. For
    /// generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    #[must_use]
    pub fn markup_owned_fallible(
        props: P,
        render: fn(&mut String, &P),
        try_render: TryRender<P>,
    ) -> Self {
        Html {
            fallible: Some(try_render),
            ..Html::markup_owned(props, render)
        }
    }

    /// [`Html::island_owned`] of a component whose `try_render` returns its refusals. For
    /// generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    #[must_use]
    pub fn island_owned_fallible(
        name: &'static str,
        props: P,
        render: fn(&mut String, &P),
        try_render: TryRender<P>,
    ) -> Self {
        Html {
            fallible: Some(try_render),
            ..Html::island_owned(name, props, render)
        }
    }
}

impl<'p, P: Serialize, F: Renderer<P>> Html<'p, P, F> {
    /// The component's markup, which the client never hydrates.
    ///
    /// `render` is trusted to escape what it writes, which only a generated renderer does.
    #[doc(hidden)]
    #[must_use]
    pub fn markup(props: &'p P, render: F) -> Self {
        Html {
            props: Given::Borrowed(props),
            render,
            fallible: None,
            island: None,
            hydrate: None,
            dates: "",
        }
    }

    /// The component as an island the client hydrates. For generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    #[must_use]
    pub fn island(name: &'static str, props: &'p P, render: F) -> Self {
        Html {
            props: Given::Borrowed(props),
            render,
            fallible: None,
            island: Some(name),
            hydrate: None,
            dates: "",
        }
    }

    /// [`Html::markup`] holding its props, for a page returned from where they were made. For
    /// generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    #[must_use]
    pub fn markup_owned(props: P, render: F) -> Self {
        Html {
            props: Given::Owned(props),
            render,
            fallible: None,
            island: None,
            hydrate: None,
            dates: "",
        }
    }

    /// [`Html::island`] holding its props. For generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    #[must_use]
    pub fn island_owned(name: &'static str, props: P, render: F) -> Self {
        Html {
            props: Given::Owned(props),
            render,
            fallible: None,
            island: Some(name),
            hydrate: None,
            dates: "",
        }
    }

    /// Hydrate the island when `when` says, fetching its code only then; an island is otherwise
    /// hydrated as soon as `mountIslands` runs. The island's markup is unchanged: its wrapper gains a
    /// `data-hydrate` attribute. A component that is not an island has no wrapper to carry it, and
    /// is written as before; so is an island given to a [`Page`](crate::page::Page) as a
    /// [`Part`](crate::page::Part).
    ///
    /// # Example
    ///
    /// ```
    /// # mod counter {
    /// #     #[derive(serde::Serialize)]
    /// #     pub struct Props { pub start: i64 }
    /// #     pub fn render(out: &mut String, props: &Props) {
    /// #         out.push_str("<button>");
    /// #         ferrovue::core::numbers::push_int(out, props.start);
    /// #         out.push_str("</button>");
    /// #     }
    /// #     pub fn island(props: &Props) -> ferrovue::html::Html<'_, Props> {
    /// #         ferrovue::html::Html::island("Counter", props, render)
    /// #     }
    /// # }
    /// use ferrovue::hydrate::Hydrate;
    ///
    /// let props = counter::Props { start: 5 };
    /// assert_eq!(
    ///     counter::island(&props).hydrate(Hydrate::Interaction).into_string(),
    ///     r#"<div data-island="Counter" data-props="{&quot;start&quot;:5}" data-hydrate="interaction"><button>5</button></div>"#
    /// );
    /// ```
    #[must_use]
    pub fn hydrate(mut self, when: Hydrate) -> Self {
        self.hydrate = Some(when);
        self
    }

    /// Where the props hold dates inside lists, dictionaries and objects, as the compiler wrote
    /// it: an island carries it in `data-dates`, and a page's record beside the props, for the
    /// client to turn each one back into a `Date`. For generated code, as [`Html::markup`] is.
    #[doc(hidden)]
    #[must_use]
    pub fn dates(mut self, plan: &'static str) -> Self {
        self.dates = plan;
        self
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
    /// #         ferrovue::core::escape::escape_into(out, props.name);
    /// #         out.push_str("!</p>");
    /// #     }
    /// #     pub fn html<'p, 'a>(props: &'p Props<'a>) -> ferrovue::html::Html<'p, Props<'a>> {
    /// #         ferrovue::html::Html::markup(props, render)
    /// #     }
    /// # }
    /// let mut page = String::from("<main>");
    /// hello::html(&hello::Props { name: "Ada" }).render_to(&mut page);
    /// page.push_str("</main>");
    /// assert_eq!(page, "<main><p>Hello, Ada!</p></main>");
    /// ```
    ///
    /// # Panics
    ///
    /// With the message of the refusal [`try_render_to`](Self::try_render_to) returns.
    pub fn render_to(&self, buf: &mut String) {
        rendered(self.write(buf));
    }

    /// [`render_to`](Self::render_to), returning the refusal of a render that cannot write what
    /// Vue writes for these props, such as a date string browsers read differently. `buf` is then
    /// left as it was.
    ///
    /// # Errors
    ///
    /// The first [`Refused`] the render met.
    pub fn try_render_to(&self, buf: &mut String) -> Result<(), Refused> {
        let start = buf.len();
        self.write(buf).inspect_err(|_| buf.truncate(start))
    }

    /// [`into_string`](Self::into_string), returning the refusal of a render that cannot write
    /// what Vue writes for these props.
    ///
    /// # Errors
    ///
    /// The first [`Refused`] the render met.
    pub fn try_into_string(self) -> Result<String, Refused> {
        let mut out = String::new();
        self.write(&mut out)?;
        Ok(out)
    }

    #[inline]
    pub(crate) fn run(&self, out: &mut String) -> Result<(), Refused> {
        let props = self.props.get();
        match self.fallible {
            Some(try_render) => try_render(out, props),
            None => self.render.try_render(out, props),
        }
    }

    fn write(&self, buf: &mut String) -> Result<(), Refused> {
        match self.island {
            None => self.run(buf),
            Some(name) => island_into(
                buf,
                name,
                self.hydrate.as_ref(),
                self.dates,
                self.props.get(),
                |out| self.run(out),
            ),
        }
    }

    /// The markup as a string of its own.
    ///
    /// # Panics
    ///
    /// With the message of the refusal [`try_into_string`](Self::try_into_string) returns.
    ///
    /// # Example
    ///
    /// ```
    /// # mod hello {
    /// #     #[derive(serde::Serialize)]
    /// #     pub struct Props<'a> { pub name: &'a str }
    /// #     pub fn render(out: &mut String, props: &Props<'_>) {
    /// #         out.push_str("<p>Hello, ");
    /// #         ferrovue::core::escape::escape_into(out, props.name);
    /// #         out.push_str("!</p>");
    /// #     }
    /// #     pub fn html<'p, 'a>(props: &'p Props<'a>) -> ferrovue::html::Html<'p, Props<'a>> {
    /// #         ferrovue::html::Html::markup(props, render)
    /// #     }
    /// # }
    /// let html: String = hello::html(&hello::Props { name: "<Ada>" }).into_string();
    /// assert_eq!(html, "<p>Hello, &lt;Ada&gt;!</p>");
    /// ```
    #[must_use]
    pub fn into_string(self) -> String {
        let mut out = String::new();
        self.render_to(&mut out);
        out
    }
}

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
/// #         ferrovue::core::numbers::push_int(out, props.start);
/// #         out.push_str("</button>");
/// #     }
/// #     pub fn island(props: &Props) -> ferrovue::html::Html<'_, Props> {
/// #         ferrovue::html::Html::island("Counter", props, render)
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
        let mut debug = f.debug_struct("Html");
        debug.field("island", &self.island);
        if let Some(hydrate) = &self.hydrate {
            debug.field("hydrate", hydrate);
        }
        debug
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
/// #         ferrovue::core::escape::escape_into(out, props.name);
/// #         out.push_str("!</p>");
/// #     }
/// #     pub fn html<'p, 'a>(props: &'p Props<'a>) -> ferrovue::html::Html<'p, Props<'a>> {
/// #         ferrovue::html::Html::markup(props, render)
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
impl<P: Serialize, F: Renderer<P>> maud::Render for Html<'_, P, F> {
    fn render_to(&self, buf: &mut String) {
        Html::render_to(self, buf);
    }
}

fn island_into<P: Serialize>(
    out: &mut String,
    name: &str,
    hydrate: Option<&Hydrate>,
    dates: &str,
    props: &P,
    render: impl FnOnce(&mut String) -> Result<(), Refused>,
) -> Result<(), Refused> {
    out.push_str("<div data-island=\"");
    escape_into(out, name);
    out.push_str("\" data-props=\"");
    json::escaped_into(out, props);
    if let Some(hydrate) = hydrate {
        out.push_str("\" data-hydrate=\"");
        escape_into(out, &hydrate.attribute());
    }
    if !dates.is_empty() {
        out.push_str("\" data-dates=\"");
        escape_into(out, dates);
    }
    out.push_str("\">");
    render(out)?;
    out.push_str("</div>");
    Ok(())
}

#[cfg(test)]
mod tests;
