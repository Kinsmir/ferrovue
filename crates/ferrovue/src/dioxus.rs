//! Components and islands as [Dioxus](https://dioxuslabs.com) elements, for a page that Dioxus
//! renders on the server (`dioxus-ssr`, or a fullstack app). Dioxus 0.7.
//!
//! [`Html::to_element`] makes a component a `dioxus_core::Element`, and `Html` is an
//! `IntoDynNode`, so it goes straight into `rsx!` as `{greeting::island(&props)}`. An island is
//! the `<div data-island data-props>` element itself, with the component's markup inside it as
//! `dangerous_inner_html`: Dioxus writes that markup exactly as it is, and adds no hydration marker
//! inside it. [`state_script`] is [`state_script_into`](crate::state_script_into) as an element.
//!
//! [`guide::dioxus`](crate::guide::dioxus) shows a whole page, and what Dioxus writes differently.
//!
//! # Example
//!
//! ```
//! # mod counter {
//! #     #[derive(serde::Serialize)]
//! #     pub struct Props { pub start: i64 }
//! #     pub fn render(out: &mut String, props: &Props) {
//! #         out.push_str("<button>");
//! #         ferrovue::push_int(out, props.start);
//! #         out.push_str("</button>");
//! #     }
//! #     pub fn island(props: &Props) -> ferrovue::Html<'_, Props> {
//! #         ferrovue::Html::island("Counter", props, render)
//! #     }
//! # }
//! let props = counter::Props { start: 5 };
//! let html = dioxus_ssr::render_element(counter::island(&props).to_element());
//! // The same element, attribute values and markup as `island().into_string()`; Dioxus spells
//! // the quotes in `data-props` as `&#34;` where Vue writes `&quot;`.
//! assert_eq!(
//!     html,
//!     r#"<div data-island="Counter" data-props="{&#34;start&#34;:5}"><button>5</button></div>"#
//! );
//! ```

use dioxus_core::{
    Attribute, DynamicNode, Element, IntoDynNode, Template, TemplateAttribute, TemplateNode, VNode,
};
use serde::Serialize;

use crate::Html;

/// `<div>`, its attributes all in the vnode's one group of dynamic attributes.
static DIV: Template = Template {
    roots: &[TemplateNode::Element {
        tag: "div",
        namespace: None,
        attrs: &[TemplateAttribute::Dynamic { id: 0 }],
        children: &[],
    }],
    node_paths: &[],
    attr_paths: &[&[0]],
};

/// `<script type="application/json">`, its `id` and content in the one group of dynamic attributes.
static STATE_SCRIPT: Template = Template {
    roots: &[TemplateNode::Element {
        tag: "script",
        namespace: None,
        attrs: &[
            TemplateAttribute::Static {
                name: "type",
                value: "application/json",
                namespace: None,
            },
            TemplateAttribute::Dynamic { id: 0 },
        ],
        children: &[],
    }],
    node_paths: &[],
    attr_paths: &[&[0]],
};

/// The attribute that Dioxus writes as an element's content, unescaped: `innerHTML` in a browser.
const INNER_HTML: &str = "dangerous_inner_html";

fn element(template: Template, attrs: Vec<Attribute>) -> Element {
    Ok(VNode::new(
        None,
        template,
        Box::new([]),
        Box::new([attrs.into_boxed_slice()]),
    ))
}

impl<P: Serialize, F: Fn(&mut String, &P)> Html<'_, P, F> {
    /// The component as a Dioxus element.
    ///
    /// An island is its own `<div data-island data-props>`, with the component's markup inside it as
    /// `dangerous_inner_html`, so the markup the client hydrates is exactly what
    /// [`Html::into_string`] writes inside the island, and Dioxus adds nothing inside it. Dioxus
    /// writes the attributes itself: the same values, which the browser reads back as the same
    /// props, with `"` spelled `&#34;` rather than `&quot;` (and `&`, `<`, `>` likewise as numeric
    /// references), and a fullstack render adds its `data-node-hydration` attribute.
    ///
    /// Markup that is not an island has no element of its own, so it is put in a `<div>` with no
    /// attributes. To put it straight into an element of the page's own, give that element
    /// `dangerous_inner_html: greeting::html(&props).into_string()`, which is also how an island is
    /// written byte for byte as [`Html::into_string`] writes it.
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
    /// #     pub fn island<'p, 'a>(props: &'p Props<'a>) -> ferrovue::Html<'p, Props<'a>> {
    /// #         ferrovue::Html::island("Hello", props, render)
    /// #     }
    /// # }
    /// let props = hello::Props { name: "<Ada>" };
    ///
    /// let island = dioxus_ssr::render_element(hello::island(&props).to_element());
    /// assert_eq!(
    ///     island,
    ///     r#"<div data-island="Hello" data-props="{&#34;name&#34;:&#34;&#60;Ada&#62;&#34;}"><p>Hello, &lt;Ada&gt;!</p></div>"#
    /// );
    ///
    /// let markup = dioxus_ssr::render_element(hello::html(&props).to_element());
    /// assert_eq!(markup, "<div><p>Hello, &lt;Ada&gt;!</p></div>");
    /// ```
    pub fn to_element(&self) -> Element {
        let mut markup = String::new();
        (self.render)(&mut markup, self.props.get());
        let mut attrs = Vec::with_capacity(3);
        if let Some(name) = self.island {
            attrs.push(Attribute::new("data-island", name, None, false));
            // As `island_into` serialises them, non-finite floats included, but unescaped: Dioxus
            // escapes attribute values.
            let json = crate::json::to_string(self.props.get());
            attrs.push(Attribute::new("data-props", json, None, false));
        }
        attrs.push(Attribute::new(INNER_HTML, markup, None, false));
        element(DIV, attrs)
    }
}

/// A component in `rsx!`, as `{greeting::island(&props)}`: [`Html::to_element`].
impl<P: Serialize, F: Fn(&mut String, &P)> IntoDynNode for Html<'_, P, F> {
    fn into_dyn_node(self) -> DynamicNode {
        self.to_element().into_dyn_node()
    }
}

/// [`state_script_into`](crate::state_script_into) as a Dioxus element: the stores' state in a
/// `<script type="application/json">` with the given `id`, its content escaped the same way.
///
/// The content is the same bytes `state_script_into` writes. A fullstack render adds Dioxus's
/// `data-node-hydration` attribute, and an `id` with characters to escape is spelled as Dioxus
/// spells them; `hydrateState` from `ferrovue/client` finds the element by `id` all the same.
///
/// # Example
///
/// ```
/// let state = serde_json::json!({ "prefs": { "theme": "</script>" } });
/// let html = dioxus_ssr::render_element(ferrovue::dioxus::state_script("__pinia", &state));
///
/// let mut written = String::new();
/// ferrovue::state_script_into(&mut written, "__pinia", &state);
/// assert_eq!(html, written);
/// assert_eq!(
///     html,
///     r#"<script type="application/json" id="__pinia">{"prefs":{"theme":"\u003c/script\u003e"}}</script>"#
/// );
/// ```
pub fn state_script(id: &str, state: &impl Serialize) -> Element {
    // As in `state_script_into`.
    let json = crate::json::to_string(state);
    let mut content = String::with_capacity(json.len());
    crate::json_escaped_into(&mut content, &json);
    element(
        STATE_SCRIPT,
        vec![
            Attribute::new("id", id, None, false),
            Attribute::new(INNER_HTML, content, None, false),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use dioxus_ssr::Renderer;

    #[derive(Serialize)]
    struct Label<'a> {
        label: &'a str,
    }

    fn label(out: &mut String, props: &Label<'_>) {
        out.push_str("<b>");
        crate::escape_into(out, props.label);
        out.push_str("</b><!--[--><i>x</i><!--]-->");
    }

    /// `<main><h1>Page</h1>{child}</main>`: a page with an element of its own around the child.
    static PAGE: Template = Template {
        roots: &[TemplateNode::Element {
            tag: "main",
            namespace: None,
            attrs: &[],
            children: &[
                TemplateNode::Element {
                    tag: "h1",
                    namespace: None,
                    attrs: &[],
                    children: &[TemplateNode::Text { text: "Page" }],
                },
                TemplateNode::Dynamic { id: 0 },
            ],
        }],
        node_paths: &[&[0, 1]],
        attr_paths: &[],
    };

    fn page(child: impl IntoDynNode) -> Element {
        Ok(VNode::new(
            None,
            PAGE,
            Box::new([child.into_dyn_node()]),
            Box::new([]),
        ))
    }

    /// The page as `dioxus-ssr` writes it, and as a fullstack server does, with hydration ids.
    fn rendered(element: impl Fn() -> Element) -> [String; 2] {
        let mut pre_render = Renderer::new();
        pre_render.pre_render = true;
        [
            Renderer::new().render_element(element()),
            pre_render.render_element(element()),
        ]
    }

    #[test]
    fn an_island_in_a_page_holds_exactly_the_components_markup() {
        let props = Label {
            label: "\"Tom\" & 'Jerry' <3",
        };
        let mut markup = String::new();
        label(&mut markup, &props);
        let [plain, hydratable] = rendered(|| page(Html::island("Label", &props, label)));
        let json = r#"{&#34;label&#34;:&#34;\&#34;Tom\&#34; &#38; &#39;Jerry&#39; &#60;3&#34;}"#;
        let attrs = format!(r#"data-island="Label" data-props="{json}""#);
        assert_eq!(
            plain,
            format!("<main><h1>Page</h1><div {attrs}>{markup}</div></main>")
        );
        assert_eq!(
            hydratable,
            format!(
                r#"<main data-node-hydration="0"><h1>Page</h1><div {attrs} data-node-hydration="1">{markup}</div></main>"#
            )
        );
    }

    #[test]
    fn markup_is_written_into_a_div_or_the_pages_own_element() {
        let props = Label { label: "<x>" };
        let [plain, _] = rendered(|| page(Html::markup(&props, label)));
        assert_eq!(
            plain,
            "<main><h1>Page</h1><div><b>&lt;x&gt;</b><!--[--><i>x</i><!--]--></div></main>"
        );
    }

    #[test]
    fn the_state_script_is_state_script_into() {
        let state = serde_json::json!({ "a": "<&>\u{2028}\u{2029}", "b": [1, 2] });
        let mut want = String::new();
        crate::state_script_into(&mut want, "__pinia", &state);
        let [plain, hydratable] = rendered(|| state_script("__pinia", &state));
        assert_eq!(plain, want);
        assert_eq!(
            hydratable,
            want.replacen(
                r#"id="__pinia""#,
                r#"id="__pinia" data-node-hydration="0""#,
                1
            )
        );
    }
}
