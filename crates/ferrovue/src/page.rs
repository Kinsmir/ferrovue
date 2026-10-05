use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll, Waker};

use serde::Serialize;

use crate::html::Html;
use crate::slots::{HOLE, Slot};
use crate::{json, state};

/// A page the client hydrates as one app: a layout whose slots hold components rendered from their
/// props. Each part goes into a slot as a [`Part`], made from the same [`Html`] value that writes
/// its markup, so the record of the page the client rebuilds is made from the values that rendered
/// it. `mountPage` from `ferrovue/client` reads the record back and hydrates the layout.
/// [`guide::islands_and_hydration`](crate::guide::islands_and_hydration#hydrating-a-page) shows a
/// whole page, client included.
///
/// # Example
///
/// ```
/// # mod frame {
/// #     use ferrovue as fv;
/// #     pub const NAME: &str = "Frame";
/// #     #[derive(serde::Serialize)]
/// #     pub struct Props<'a> { pub title: &'a str }
/// #     #[derive(Clone, Copy, Default)]
/// #     pub struct Slots<'s> { pub default: Option<fv::Slot<'s>> }
/// #     pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>) {
/// #         out.push_str("<main><h1>");
/// #         fv::escape_into(out, props.title);
/// #         out.push_str("</h1>");
/// #         fv::slot_into(out, fv_slots.default, None);
/// #         out.push_str("</main>");
/// #     }
/// #     pub fn html<'p, 'a>(props: &'p Props<'a>, fv_slots: Slots<'p>) -> fv::Html<'p, Props<'a>, impl Fn(&mut String, &Props<'a>) + 'p> {
/// #         fv::Html::markup(props, move |out: &mut String, props: &Props<'a>| render(out, props, fv_slots))
/// #     }
/// # }
/// # mod hello {
/// #     pub const NAME: &str = "Hello";
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
/// use ferrovue::{Page, Part};
///
/// // Frame.vue: <main><h1>{{ title }}</h1><slot /></main>; Hello.vue: <p>Hello, {{ name }}!</p>
/// let (ada, grace) = (hello::Props { name: "Ada" }, hello::Props { name: "</script>" });
/// let mut page = Page::new();
/// let greetings = page.slot(
///     "default",
///     [Part::new(hello::NAME, hello::html(&ada)), Part::new(hello::NAME, hello::html(&grace))],
/// );
///
/// let mut out = String::from(r#"<div id="app">"#);
/// let slots = frame::Slots { default: Some(greetings.slot()) };
/// let record = page.render_to(&mut out, frame::html(&frame::Props { title: "Greetings" }, slots));
/// out.push_str("</div>");
/// record.script_into(&mut out, "__fv_page");
///
/// assert_eq!(
///     out,
///     concat!(
///         r#"<div id="app"><main><h1>Greetings</h1><!--[--><p>Hello, Ada!</p><p>Hello, &lt;/script&gt;!</p><!--]--></main></div>"#,
///         r#"<script type="application/json" id="__fv_page">{"props":{"title":"Greetings"},"slots":{"default":["#,
///         r#"{"c":"Hello","p":{"name":"Ada"}},{"c":"Hello","p":{"name":"\u003c/script\u003e"}}]}}</script>"#,
///     )
/// );
/// ```
#[derive(Debug, Default)]
pub struct Page {
    record: Shared,
}

/// One component in a slot of a [`Page`]: its name, as the client's loaders know it (the generated
/// `NAME`), and its [`Html`], which writes the markup and gives the record its props.
///
/// The component is written as `html()` writes it: an `island()` given here loses its wrapper, as a
/// part of a page is hydrated with the page.
pub struct Part<'p> {
    name: &'static str,
    props: String,
    render: Box<dyn Fn(&mut String) + 'p>,
}

/// The parts of one slot of a [`Page`], ready to be given to the layout with [`slot`](Self::slot).
pub struct PageSlot<'p> {
    render: Box<SlotContent<'p>>,
}

/// A slot of a [`Page`] whose parts are rendered later, as an [`HtmlStream`](crate::HtmlStream)
/// hole is: give the layout its [`slot`](Self::slot), and [`fill`](Self::fill) it once its data is
/// ready. A hole dropped without being filled is recorded as empty, as `HtmlStream` leaves a hole
/// given no content empty.
pub struct PageHole {
    record: Shared,
    index: usize,
    open: bool,
}

/// The record of a rendered [`Page`], which the client reads back: [`script_into`](Self::script_into)
/// for a page written at once, [`script`](Self::script) for a streamed one.
#[derive(Debug)]
pub struct PageRecord {
    record: Shared,
}

/// The record's `<script>` once every [`PageHole`] of the page is filled or dropped: the content
/// of the last hole of an [`HtmlStream`](crate::HtmlStream). Made by [`PageRecord::script`].
#[derive(Debug)]
pub struct PageScript {
    record: Shared,
    id: String,
}

type Shared = Arc<Mutex<Recorded>>;

type SlotContent<'p> = dyn Fn(&mut String, &str) -> bool + 'p;

#[derive(Debug, Default)]
struct Recorded {
    props: String,
    slots: Vec<(String, Option<String>)>,
    open: usize,
    waker: Option<Waker>,
}

fn lock(record: &Shared) -> MutexGuard<'_, Recorded> {
    record.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Page {
    /// A page with no slots yet.
    pub fn new() -> Self {
        Self::default()
    }

    /// The parts of the layout's slot called `slot`, in the order they are written.
    ///
    /// # Panics
    ///
    /// If the page already has a slot called `slot`.
    pub fn slot<'p>(
        &mut self,
        slot: &str,
        parts: impl IntoIterator<Item = Part<'p>>,
    ) -> PageSlot<'p> {
        let parts: Vec<Part<'p>> = parts.into_iter().collect();
        self.add(slot, Some(parts_json(&parts)));
        PageSlot {
            render: Box::new(move |out, slot_scope_id| {
                refuse_slotted(slot_scope_id);
                for part in &parts {
                    (part.render)(out);
                }
                true
            }),
        }
    }

    /// The layout's slot called `slot`, filled later.
    ///
    /// # Panics
    ///
    /// If the page already has a slot called `slot`.
    pub fn hole(&mut self, slot: &str) -> PageHole {
        let index = self.add(slot, None);
        lock(&self.record).open += 1;
        PageHole {
            record: Arc::clone(&self.record),
            index,
            open: true,
        }
    }

    /// Write the layout, recording the props it was rendered from: the root of the app the client
    /// hydrates, so `out` should be where that app is mounted, with nothing else in it.
    pub fn render_to<P: Serialize, F: Fn(&mut String, &P)>(
        self,
        out: &mut String,
        layout: Html<'_, P, F>,
    ) -> PageRecord {
        let props = layout.props.get();
        lock(&self.record).props = json::to_string(props);
        (layout.render)(out, props);
        PageRecord {
            record: self.record,
        }
    }

    fn add(&mut self, slot: &str, parts: Option<String>) -> usize {
        let mut record = lock(&self.record);
        assert!(
            record.slots.iter().all(|(name, _)| name != slot),
            "the page already has a slot called {slot:?}"
        );
        record.slots.push((slot.to_owned(), parts));
        record.slots.len() - 1
    }
}

impl<'p> Part<'p> {
    /// The component called `name`, as `html` writes it.
    pub fn new<P: Serialize + 'p, F: Fn(&mut String, &P) + 'p>(
        name: &'static str,
        html: Html<'p, P, F>,
    ) -> Self {
        let props = json::to_string(html.props.get());
        Part {
            name,
            props,
            render: Box::new(move |out| (html.render)(out, html.props.get())),
        }
    }
}

impl PageSlot<'_> {
    /// The parts as the layout's slot content.
    ///
    /// # Panics
    ///
    /// When the layout writes it where Vue would give it a slot scope id: an outlet of a
    /// component with `:slotted()` styles, which Vue writes onto each part's root and a part's
    /// `html()` cannot.
    pub fn slot(&self) -> Slot<'_> {
        Slot::slotted(&*self.render)
    }
}

impl PageHole {
    /// The hole as the layout's slot content. Panics where [`PageSlot::slot`] does.
    pub fn slot(&self) -> Slot<'static> {
        Slot::slotted(&write_hole)
    }

    /// Record the parts and return their markup: the content of this hole.
    pub fn fill<'p>(mut self, parts: impl IntoIterator<Item = Part<'p>>) -> String {
        let parts: Vec<Part<'p>> = parts.into_iter().collect();
        let mut out = String::new();
        for part in &parts {
            (part.render)(&mut out);
        }
        self.close(parts_json(&parts));
        out
    }

    fn close(&mut self, parts: String) {
        if !std::mem::replace(&mut self.open, false) {
            return;
        }
        let mut record = lock(&self.record);
        record.slots[self.index].1 = Some(parts);
        record.open -= 1;
        if record.open == 0
            && let Some(waker) = record.waker.take()
        {
            waker.wake();
        }
    }
}

impl Drop for PageHole {
    fn drop(&mut self) {
        self.close(String::from("[]"));
    }
}

impl PageRecord {
    /// Write the record as a `<script type="application/json">` with the given `id`, escaped as
    /// [`state_script_into`](crate::state_script_into) escapes the state: `"__fv_page"` is what
    /// `mountPage` reads by default.
    ///
    /// # Panics
    ///
    /// If a [`PageHole`] of the page is neither filled nor dropped: a streamed page writes the
    /// record with [`script`](Self::script).
    pub fn script_into(&self, out: &mut String, id: &str) {
        let record = lock(&self.record);
        assert!(
            record.open == 0,
            "a hole of the page is not filled yet: write the record with `PageRecord::script`"
        );
        state::json_script_into(out, id, &record.to_json());
    }

    /// The record's `<script>`, ready once every hole of the page is filled or dropped. Leave a
    /// [`hole`](crate::hole) for it after the app's container and give it to the
    /// [`HtmlStream`](crate::HtmlStream) after the futures of the page's holes.
    pub fn script(self, id: impl Into<String>) -> PageScript {
        PageScript {
            record: self.record,
            id: id.into(),
        }
    }
}

impl Future for PageScript {
    type Output = String;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<String> {
        let mut record = lock(&self.record);
        if record.open > 0 {
            record.waker = Some(cx.waker().clone());
            return Poll::Pending;
        }
        let mut out = String::new();
        state::json_script_into(&mut out, &self.id, &record.to_json());
        Poll::Ready(out)
    }
}

impl Recorded {
    fn to_json(&self) -> String {
        let mut out = String::from("{\"props\":");
        out.push_str(&self.props);
        out.push_str(",\"slots\":{");
        for (i, (name, parts)) in self.slots.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&json::to_string(name));
            out.push(':');
            out.push_str(parts.as_deref().unwrap_or("[]"));
        }
        out.push_str("}}");
        out
    }
}

fn parts_json(parts: &[Part<'_>]) -> String {
    let mut out = String::from("[");
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"c\":");
        out.push_str(&json::to_string(part.name));
        out.push_str(",\"p\":");
        out.push_str(&part.props);
        out.push('}');
    }
    out.push(']');
    out
}

fn refuse_slotted(slot_scope_id: &str) {
    assert!(
        slot_scope_id.is_empty(),
        "a page part is written into an outlet that gives its content the slot scope id{slot_scope_id}, \
         which Vue writes onto the part's root and its `html()` cannot: fill that slot without `Page`"
    );
}

fn write_hole(out: &mut String, slot_scope_id: &str) -> bool {
    refuse_slotted(slot_scope_id);
    out.push_str(HOLE);
    true
}

impl std::fmt::Debug for Part<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Part")
            .field("name", &self.name)
            .field("props", &self.props)
            .finish_non_exhaustive()
    }
}

impl std::fmt::Debug for PageSlot<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PageSlot").finish_non_exhaustive()
    }
}

impl std::fmt::Debug for PageHole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PageHole")
            .field("index", &self.index)
            .field("open", &self.open)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests;
