use crate::{
    json,
    render::{Refused, rendered},
};
use ferrovue_core::escape_into;
use serde::{Deserialize, Deserializer, Serialize};
use std::borrow::Cow;

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
/// #     fv::core::escape_into(out, &*props.name);
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
    /// #         ferrovue::core::push_int(out, props.start);
    /// #         out.push_str("</button>");
    /// #     }
    /// #     pub fn island(props: &Props) -> ferrovue::html::Html<'_, Props> {
    /// #         ferrovue::html::Html::island("Counter", props, render)
    /// #     }
    /// # }
    /// use ferrovue::html::Hydrate;
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
    /// #         ferrovue::core::escape_into(out, props.name);
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
    /// #         ferrovue::core::escape_into(out, props.name);
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
/// #         ferrovue::core::push_int(out, props.start);
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

/// When the client hydrates an island, and so when it fetches the island's code: what
/// [`Html::hydrate`](crate::html::Html::hydrate) writes as the island's `data-hydrate`. An island without
/// one is hydrated as soon as `mountIslands` runs.
///
/// # Example
///
/// ```
/// # mod counter {
/// #     #[derive(serde::Serialize)]
/// #     pub struct Props { pub start: i64 }
/// #     pub fn render(out: &mut String, props: &Props) {
/// #         out.push_str("<button>");
/// #         ferrovue::core::push_int(out, props.start);
/// #         out.push_str("</button>");
/// #     }
/// #     pub fn island(props: &Props) -> ferrovue::html::Html<'_, Props> {
/// #         ferrovue::html::Html::island("Counter", props, render)
/// #     }
/// # }
/// use ferrovue::html::Hydrate;
///
/// let props = counter::Props { start: 5 };
/// assert_eq!(
///     counter::island(&props).hydrate(Hydrate::Visible).into_string(),
///     r#"<div data-island="Counter" data-props="{&quot;start&quot;:5}" data-hydrate="visible"><button>5</button></div>"#
/// );
/// assert_eq!(
///     counter::island(&props).hydrate(Hydrate::media("(min-width: 40rem)")).into_string(),
///     r#"<div data-island="Counter" data-props="{&quot;start&quot;:5}" data-hydrate="media:(min-width: 40rem)"><button>5</button></div>"#
/// );
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Hydrate {
    /// Once any part of the island is in the viewport, as Vue's `hydrateOnVisible` does.
    Visible,
    /// [`Hydrate::Visible`] with this root margin: `"200px"` hydrates the island once it is within
    /// 200 pixels of the viewport, as Vue's `hydrateOnVisible({ rootMargin })` does. The margin is
    /// CSS's, as `IntersectionObserver` reads it; one the browser rejects hydrates the island at
    /// once, and `mountIslands` reports it.
    VisibleWith(Cow<'static, str>),
    /// Once the browser is idle, as Vue's `hydrateOnIdle` does.
    Idle,
    /// On the first `pointerenter`, `click` or `focus` within the island. The events that arrive
    /// before the island has hydrated are dispatched again once it has, so the click that woke it
    /// reaches its handler.
    Interaction,
    /// [`Hydrate::Interaction`] on these events instead. No events means the default ones.
    InteractionOn(&'static [&'static str]),
    /// Once the media query matches, as Vue's `hydrateOnMediaQuery` does.
    Media(Cow<'static, str>),
}

impl Hydrate {
    /// [`Hydrate::VisibleWith`] for this root margin.
    #[must_use]
    pub fn visible_with(root_margin: impl Into<Cow<'static, str>>) -> Hydrate {
        Hydrate::VisibleWith(root_margin.into())
    }

    /// [`Hydrate::Media`] for this query.
    #[must_use]
    pub fn media(query: impl Into<Cow<'static, str>>) -> Hydrate {
        Hydrate::Media(query.into())
    }

    /// The value of `data-hydrate`, before escaping.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::html::Hydrate;
    ///
    /// assert_eq!(Hydrate::Idle.attribute(), "idle");
    /// assert_eq!(Hydrate::visible_with("200px 0px").attribute(), "visible:200px 0px");
    /// assert_eq!(Hydrate::InteractionOn(&["click", "keydown"]).attribute(), "interaction:click keydown");
    /// assert_eq!(Hydrate::media("print").attribute(), "media:print");
    /// ```
    #[must_use]
    pub fn attribute(&self) -> Cow<'static, str> {
        match self {
            Hydrate::Visible => Cow::Borrowed("visible"),
            Hydrate::VisibleWith(margin) => Cow::Owned(format!("visible:{margin}")),
            Hydrate::Idle => Cow::Borrowed("idle"),
            Hydrate::Interaction | Hydrate::InteractionOn([]) => Cow::Borrowed("interaction"),
            Hydrate::InteractionOn(events) => {
                Cow::Owned(format!("interaction:{}", events.join(" ")))
            }
            Hydrate::Media(query) => Cow::Owned(format!("media:{query}")),
        }
    }
}

/// Untrusted text with a few formatting tags: a [`TrustedHtml`] for `v-html` that needs no
/// sanitiser.
///
/// [`BasicHtml::new`] never parses the input as HTML. It escapes every character, as
/// [`escape_into`] does, except for these tags written exactly so, in lower case and with no
/// attributes or spaces: `<b>`, `<i>`, `<em>`, `<strong>`, `<code>`, `<br>`, `<p>`, `<ul>`, `<ol>`
/// and `<li>`, and their end tags (`<br>` has none). Those it writes as tags, kept in an order a
/// browser reads back as written:
///
/// - an element left open is closed where its parent ends, or at the end;
/// - an end tag with no open element of its name is left out;
/// - `<p>`, `<ul>` and `<ol>` close an open `<p>` and the formatting elements around them first;
/// - `<li>` closes what is open inside the nearest list, and stays text outside a list;
/// - past 32 elements deep, a start tag stays text.
///
/// Character references (`&amp;`, `&#60;`, `&eacute;`) are kept: they only ever write text. A
/// lone `&` is escaped, NUL characters are left out, and `\r\n` and `\r` become `\n`, as a browser
/// reads them. Building again from the result gives the same result, so deserialising one, which
/// builds it again with [`BasicHtml::new`], reads back what was serialised.
///
/// It serialises as the string, so an island's `data-props` carries exactly the HTML the server
/// wrote. Name it as the `trustedHtml` type in `ferrovue.config.json`:
///
/// ```json
/// { "trustedHtml": "ferrovue::html::BasicHtml" }
/// ```
///
/// # Example
///
/// ```
/// use ferrovue::html::BasicHtml;
///
/// let html = BasicHtml::new(r#"<b>Bold</b>, <B>not</B>, <b onclick="x()">nor this</b><p>open"#);
/// assert_eq!(
///     html.as_str(),
///     "<b>Bold</b>, &lt;B&gt;not&lt;/B&gt;, &lt;b onclick=&quot;x()&quot;&gt;nor this<p>open</p>"
/// );
///
/// let text = BasicHtml::from_text("Dear <you>,\nhello.\n\nBye & thanks");
/// assert_eq!(text.as_str(), "<p>Dear &lt;you&gt;,<br>hello.</p><p>Bye &amp; thanks</p>");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct BasicHtml(String);

impl BasicHtml {
    /// The tags [`BasicHtml::new`] writes as tags.
    pub const TAGS: [&str; 10] = [
        "b", "i", "em", "strong", "code", "br", "p", "ul", "ol", "li",
    ];

    /// `untrusted`, escaped but for the tags in [`BasicHtml::TAGS`], balanced.
    #[must_use]
    pub fn new(untrusted: &str) -> Self {
        BasicHtml(build(untrusted, false))
    }

    /// Plain text: everything escaped, blank lines between paragraphs, each paragraph a `<p>` and
    /// each line break within one a `<br>`.
    #[must_use]
    pub fn from_text(text: &str) -> Self {
        let text = text
            .replace('\0', "")
            .replace("\r\n", "\n")
            .replace('\r', "\n");
        let mut out = String::with_capacity(text.len());
        let mut in_paragraph = false;
        for line in text.split('\n') {
            if line.trim().is_empty() {
                if in_paragraph {
                    out.push_str("</p>");
                    in_paragraph = false;
                }
                continue;
            }
            out.push_str(if in_paragraph { "<br>" } else { "<p>" });
            in_paragraph = true;
            escape_into(&mut out, line);
        }
        if in_paragraph {
            out.push_str("</p>");
        }
        BasicHtml(out)
    }

    /// The HTML.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The HTML, as an owned string.
    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }
}

impl TrustedHtml for BasicHtml {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for BasicHtml {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let untrusted = String::deserialize(deserializer)?;
        Ok(BasicHtml::new(&untrusted))
    }
}

/// Untrusted text with a few inline formatting tags: a [`TrustedHtml`] that `v-html` may write
/// inside a `<p>`.
///
/// [`InlineHtml::new`] builds it as [`BasicHtml::new`] does, keeping as tags only `<b>`, `<i>`,
/// `<em>`, `<strong>`, `<code>` and `<br>`. Every other tag stays text, `<p>`, `<ul>`, `<ol>` and
/// `<li>` and their end tags included, so the HTML holds nothing that closes the paragraph it is
/// written into. Character references are kept, a lone `&` is escaped, NUL characters are left
/// out, and `\r\n` and `\r` become `\n`; building again from the result gives the same result.
///
/// A prop typed `InlineHtml` from `ferrovue/types` is this type on the server, whatever
/// `trustedHtml` names in `ferrovue.config.json`. It serialises as the string, and deserialising
/// builds it again with [`InlineHtml::new`].
///
/// # Example
///
/// ```
/// use ferrovue::html::InlineHtml;
///
/// let html = InlineHtml::new("<b>Bold</b><br>and <p>no paragraph</p> <i>open");
/// assert_eq!(
///     html.as_str(),
///     "<b>Bold</b><br>and &lt;p&gt;no paragraph&lt;/p&gt; <i>open</i>"
/// );
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct InlineHtml(String);

impl InlineHtml {
    /// The tags [`InlineHtml::new`] writes as tags.
    pub const TAGS: [&str; 6] = ["b", "i", "em", "strong", "code", "br"];

    /// `untrusted`, escaped but for the tags in [`InlineHtml::TAGS`], balanced.
    #[must_use]
    pub fn new(untrusted: &str) -> Self {
        InlineHtml(build(untrusted, true))
    }

    /// The HTML.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The HTML, as an owned string.
    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }
}

impl TrustedHtml for InlineHtml {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for InlineHtml {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let untrusted = String::deserialize(deserializer)?;
        Ok(InlineHtml::new(&untrusted))
    }
}

fn build(untrusted: &str, inline: bool) -> String {
    let mut html = Builder {
        inline,
        ..Builder::default()
    };
    let mut rest = untrusted;
    while let Some(at) = rest.find(['<', '&', '\0', '\r']) {
        escape_into(&mut html.out, &rest[..at]);
        rest = &rest[at..];
        let taken = match rest.as_bytes()[0] {
            b'<' => html.tag(rest),
            b'&' => html.reference(rest),
            b'\r' => html.line_break(rest),
            _ => 1,
        };
        rest = &rest[taken..];
    }
    escape_into(&mut html.out, rest);
    html.finish()
}

const MAX_DEPTH: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tag {
    B,
    I,
    Em,
    Strong,
    Code,
    Br,
    P,
    Ul,
    Ol,
    Li,
}

impl Tag {
    fn named(name: &[u8]) -> Option<Tag> {
        Some(match name {
            b"b" => Tag::B,
            b"i" => Tag::I,
            b"em" => Tag::Em,
            b"strong" => Tag::Strong,
            b"code" => Tag::Code,
            b"br" => Tag::Br,
            b"p" => Tag::P,
            b"ul" => Tag::Ul,
            b"ol" => Tag::Ol,
            b"li" => Tag::Li,
            _ => return None,
        })
    }

    fn name(self) -> &'static str {
        match self {
            Tag::B => "b",
            Tag::I => "i",
            Tag::Em => "em",
            Tag::Strong => "strong",
            Tag::Code => "code",
            Tag::Br => "br",
            Tag::P => "p",
            Tag::Ul => "ul",
            Tag::Ol => "ol",
            Tag::Li => "li",
        }
    }

    fn is_formatting(self) -> bool {
        matches!(self, Tag::B | Tag::I | Tag::Em | Tag::Strong | Tag::Code)
    }

    fn is_inline(self) -> bool {
        self.is_formatting() || self == Tag::Br
    }

    fn is_list(self) -> bool {
        matches!(self, Tag::Ul | Tag::Ol)
    }
}

#[derive(Default)]
struct Builder {
    out: String,
    open: Vec<Tag>,
    inline: bool,
}

impl Builder {
    fn tag(&mut self, rest: &str) -> usize {
        let bytes = rest.as_bytes();
        let closing = bytes.get(1) == Some(&b'/');
        let name_at = if closing { 2 } else { 1 };
        let tag = bytes[name_at..]
            .iter()
            .take(7)
            .position(|&b| b == b'>')
            .and_then(|len| {
                Some((
                    Tag::named(&bytes[name_at..name_at + len])?,
                    name_at + len + 1,
                ))
            })
            .filter(|&(tag, _)| !self.inline || tag.is_inline());
        match tag {
            Some((tag, len)) if closing && tag != Tag::Br => {
                self.end(tag);
                len
            }
            Some((tag, len)) if !closing && self.start(tag) => len,
            _ => {
                self.out.push_str("&lt;");
                1
            }
        }
    }

    fn reference(&mut self, rest: &str) -> usize {
        let len = reference_len(rest.as_bytes());
        match len {
            Some(len) => self.out.push_str(&rest[..len]),
            None => self.out.push_str("&amp;"),
        }
        len.unwrap_or(1)
    }

    fn line_break(&mut self, rest: &str) -> usize {
        self.out.push('\n');
        if rest.as_bytes().get(1) == Some(&b'\n') {
            2
        } else {
            1
        }
    }

    fn start(&mut self, tag: Tag) -> bool {
        match tag {
            Tag::Br => {
                self.out.push_str("<br>");
                return true;
            }
            Tag::P | Tag::Ul | Tag::Ol => self.close_while(|t| t.is_formatting() || t == Tag::P),
            Tag::Li if self.open.iter().any(|t| t.is_list()) => {
                self.close_while(|t| !t.is_list());
            }
            Tag::Li => return false,
            _ => {}
        }
        if self.open.len() >= MAX_DEPTH {
            return false;
        }
        self.open.push(tag);
        self.out.push('<');
        self.out.push_str(tag.name());
        self.out.push('>');
        true
    }

    fn end(&mut self, tag: Tag) {
        if self.open.contains(&tag) {
            self.close_while(|t| t != tag);
            self.close_top();
        }
    }

    fn close_while(&mut self, keep_closing: impl Fn(Tag) -> bool) {
        while self.open.last().is_some_and(|&t| keep_closing(t)) {
            self.close_top();
        }
    }

    fn close_top(&mut self) {
        if let Some(tag) = self.open.pop() {
            self.out.push_str("</");
            self.out.push_str(tag.name());
            self.out.push('>');
        }
    }

    fn finish(mut self) -> String {
        self.close_while(|_| true);
        self.out
    }
}

fn reference_len(bytes: &[u8]) -> Option<usize> {
    let (start, max, allowed): (usize, usize, fn(&u8) -> bool) = match bytes.get(1..3) {
        Some([b'#', b'x' | b'X']) => (3, 6, u8::is_ascii_hexdigit),
        Some([b'#', _]) => (2, 7, u8::is_ascii_digit),
        _ if bytes.get(1).is_some_and(u8::is_ascii_alphabetic) => {
            (1, 32, u8::is_ascii_alphanumeric)
        }
        _ => return None,
    };
    let len = bytes
        .get(start..)?
        .iter()
        .take(max + 1)
        .take_while(|b| allowed(b))
        .count();
    (1..=max).contains(&len).then_some(())?;
    (bytes.get(start + len) == Some(&b';')).then_some(start + len + 1)
}

/// HTML that is safe to write into a page as it is: what `v-html` may render.
///
/// Implement it only for a type whose every value has already been made safe: the output of a
/// sanitiser, never a string that merely looks fine. [`BasicHtml`] and, with the
/// `ammonia` feature, `Sanitised` implement it; the guide's `escaping` page says how to choose.
///
/// # Example
///
/// ```
/// use ferrovue::html::{trusted_into, TrustedHtml};
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
#[doc(hidden)]
pub fn trusted_into(out: &mut String, html: &impl TrustedHtml) {
    out.push_str(html.trusted_html());
}

/// HTML cleaned by [ammonia](https://docs.rs/ammonia): a [`TrustedHtml`] for `v-html`, with the
/// `ammonia` feature.
///
/// The only ways to make one run the sanitiser: [`Sanitised::new`] with ammonia's default policy,
/// [`Sanitised::with`] with a policy of your own, and deserialising, which cleans the string with
/// the default policy. Name it as the `trustedHtml` type in `ferrovue.config.json`:
///
/// ```json
/// { "trustedHtml": "ferrovue::html::Sanitised" }
/// ```
///
/// It serialises as the cleaned string, so an island's `data-props` carries exactly the HTML the
/// server rendered, and the client's `v-html` writes the same string.
///
/// # Example
///
/// ```
/// use ferrovue::{html::Sanitised, html::trusted_into};
///
/// let body = Sanitised::new(r#"<p onclick="steal()">Hi <script>alert(1)</script><a href="javascript:x()">you</a></p>"#);
/// assert_eq!(body.as_str(), r#"<p>Hi <a rel="noopener noreferrer">you</a></p>"#);
///
/// let mut out = String::new();
/// trusted_into(&mut out, &body);
/// assert_eq!(out, body.as_str());
/// assert_eq!(serde_json::to_string(&body).unwrap(), r#""<p>Hi <a rel=\"noopener noreferrer\">you</a></p>""#);
///
/// let mut policy = ammonia::Builder::empty();
/// policy.add_tags(["em"]);
/// assert_eq!(Sanitised::with(&policy, "<p><em>only</em> this</p>").as_str(), "<em>only</em> this");
/// ```
#[cfg(feature = "ammonia")]
#[cfg_attr(docsrs, doc(cfg(feature = "ammonia")))]
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct Sanitised(String);

#[cfg(feature = "ammonia")]
impl Sanitised {
    /// `untrusted`, cleaned with ammonia's default policy.
    #[must_use]
    pub fn new(untrusted: &str) -> Self {
        Sanitised(ammonia::clean(untrusted))
    }

    /// `untrusted`, cleaned with `policy`.
    #[must_use]
    pub fn with(policy: &ammonia::Builder<'_>, untrusted: &str) -> Self {
        Sanitised(policy.clean(untrusted).to_string())
    }

    /// The cleaned HTML.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The cleaned HTML, as an owned string.
    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }
}

#[cfg(feature = "ammonia")]
impl TrustedHtml for Sanitised {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

#[cfg(feature = "ammonia")]
impl<'de> Deserialize<'de> for Sanitised {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let untrusted = String::deserialize(deserializer)?;
        Ok(Sanitised::new(&untrusted))
    }
}

#[cfg(test)]
mod tests;
