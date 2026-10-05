use std::borrow::Cow;

/// When the client hydrates an island, and so when it fetches the island's code: what
/// [`Html::hydrate`](crate::Html::hydrate) writes as the island's `data-hydrate`. An island without
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
/// #         ferrovue::push_int(out, props.start);
/// #         out.push_str("</button>");
/// #     }
/// #     pub fn island(props: &Props) -> ferrovue::Html<'_, Props> {
/// #         ferrovue::Html::island("Counter", props, render)
/// #     }
/// # }
/// use ferrovue::Hydrate;
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
    /// [`Hydrate::Media`] for this query.
    pub fn media(query: impl Into<Cow<'static, str>>) -> Hydrate {
        Hydrate::Media(query.into())
    }

    /// The value of `data-hydrate`, before escaping.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::Hydrate;
    ///
    /// assert_eq!(Hydrate::Idle.attribute(), "idle");
    /// assert_eq!(Hydrate::InteractionOn(&["click", "keydown"]).attribute(), "interaction:click keydown");
    /// assert_eq!(Hydrate::media("print").attribute(), "media:print");
    /// ```
    pub fn attribute(&self) -> Cow<'static, str> {
        match self {
            Hydrate::Visible => Cow::Borrowed("visible"),
            Hydrate::Idle => Cow::Borrowed("idle"),
            Hydrate::Interaction | Hydrate::InteractionOn([]) => Cow::Borrowed("interaction"),
            Hydrate::InteractionOn(events) => {
                Cow::Owned(format!("interaction:{}", events.join(" ")))
            }
            Hydrate::Media(query) => Cow::Owned(format!("media:{query}")),
        }
    }
}
