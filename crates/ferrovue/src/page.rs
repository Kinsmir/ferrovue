use crate::html::{Html, Renderer};
use crate::json;
use crate::render::{Refused, Slot, first};
use ferrovue_core::escape_into;
use serde::Deserialize;
use serde::Serialize;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll, Waker};

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
/// #     pub struct Slots<'s> { pub default: Option<fv::render::Slot<'s>> }
/// #     pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>) {
/// #         out.push_str("<main><h1>");
/// #         fv::core::escape_into(out, props.title);
/// #         out.push_str("</h1>");
/// #         fv::render::slot_into(out, fv_slots.default, None);
/// #         out.push_str("</main>");
/// #     }
/// #     pub fn html<'p, 'a>(props: &'p Props<'a>, fv_slots: Slots<'p>) -> fv::html::Html<'p, Props<'a>, impl Fn(&mut String, &Props<'a>) + 'p> {
/// #         fv::html::Html::markup(props, move |out: &mut String, props: &Props<'a>| render(out, props, fv_slots))
/// #     }
/// # }
/// # mod hello {
/// #     pub const NAME: &str = "Hello";
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
/// use ferrovue::page::{Page, Part};
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
    dates: &'static str,
    render: Box<PartRender<'p>>,
}

/// The parts of one slot of a [`Page`], ready to be given to the layout with [`slot`](Self::slot).
pub struct PageSlot<'p> {
    render: Box<SlotContent<'p>>,
}

/// A slot of a [`Page`] whose parts are rendered later, as an `HtmlStream` (the `stream` feature)
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
/// of the last hole of an `HtmlStream` (the `stream` feature). Made by [`PageRecord::script`].
#[derive(Debug)]
pub struct PageScript {
    record: Shared,
    id: String,
}

type Shared = Arc<Mutex<Recorded>>;

type SlotContent<'p> = dyn Fn(&mut String, &str) -> bool + 'p;

type PartRender<'p> = dyn Fn(&mut String) -> Result<(), Refused> + 'p;

#[derive(Debug, Default)]
struct Recorded {
    props: String,
    dates: &'static str,
    names: Vec<&'static str>,
    slots: Vec<(String, Option<String>)>,
    open: usize,
    waker: Option<Waker>,
    refused: Option<Refused>,
}

fn lock(record: &Shared) -> MutexGuard<'_, Recorded> {
    record.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Page {
    /// A page with no slots yet.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The parts of the layout's slot called `slot`, in the order they are written.
    ///
    /// # Panics
    ///
    /// If the page already has a slot called `slot`.
    #[must_use]
    pub fn slot<'p>(
        &mut self,
        slot: &str,
        parts: impl IntoIterator<Item = Part<'p>>,
    ) -> PageSlot<'p> {
        let parts: Vec<Part<'p>> = parts.into_iter().collect();
        self.add(slot, Some(parts_json(&parts)));
        lock(&self.record).name(&parts);
        let record = Arc::clone(&self.record);
        PageSlot {
            render: Box::new(move |out, slot_scope_id| {
                refuse_slotted(slot_scope_id);
                for part in &parts {
                    if let Err(refused) = (part.render)(out) {
                        lock(&record).hold(refused);
                    }
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
    ///
    /// # Panics
    ///
    /// With the message of the refusal [`try_render_to`](Self::try_render_to) returns.
    pub fn render_to<P: Serialize, F: Renderer<P>>(
        self,
        out: &mut String,
        layout: Html<'_, P, F>,
    ) -> PageRecord {
        self.try_render_to(out, layout)
            .unwrap_or_else(|refused| panic!("{refused}"))
    }

    /// [`render_to`](Self::render_to), returning the refusal of a render, the layout's or a
    /// part's, that cannot write what Vue writes for its props. `out` is then left as it was.
    ///
    /// # Errors
    ///
    /// The first [`Refused`] the render met.
    pub fn try_render_to<P: Serialize, F: Renderer<P>>(
        self,
        out: &mut String,
        layout: Html<'_, P, F>,
    ) -> Result<PageRecord, Refused> {
        let start = out.len();
        let mut record = lock(&self.record);
        record.props = json::to_string_or_null(layout.props.get());
        record.dates = layout.dates;
        drop(record);
        let wrote = layout.run(out);
        let held = lock(&self.record).refused.take();
        match first(held, wrote) {
            Ok(()) => Ok(PageRecord {
                record: self.record,
            }),
            Err(refused) => {
                out.truncate(start);
                Err(refused)
            }
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
    #[must_use]
    pub fn new<P: Serialize + 'p, F: Renderer<P> + 'p>(
        name: &'static str,
        html: Html<'p, P, F>,
    ) -> Self {
        let props = json::to_string_or_null(html.props.get());
        Part {
            name,
            props,
            dates: html.dates,
            render: Box::new(move |out| html.run(out)),
        }
    }

    /// The component's name, as it was given.
    #[must_use]
    pub fn name(&self) -> &'static str {
        self.name
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
    #[must_use]
    pub fn slot(&self) -> Slot<'_> {
        Slot::slotted(&*self.render)
    }
}

impl PageHole {
    /// The hole as the layout's slot content. Panics where [`PageSlot::slot`] does.
    #[must_use]
    pub fn slot(&self) -> Slot<'static> {
        Slot::slotted(&write_hole)
    }

    /// Record the parts and return their markup: the content of this hole.
    ///
    /// # Panics
    ///
    /// With the message of the refusal [`try_fill`](Self::try_fill) returns.
    #[must_use]
    pub fn fill<'p>(self, parts: impl IntoIterator<Item = Part<'p>>) -> String {
        self.try_fill(parts)
            .unwrap_or_else(|refused| panic!("{refused}"))
    }

    /// [`fill`](Self::fill), returning the refusal of a part's render that cannot write what Vue
    /// writes for its props. The hole is then recorded as empty, as one dropped is.
    ///
    /// # Errors
    ///
    /// The first [`Refused`] a part's render met.
    pub fn try_fill<'p>(
        mut self,
        parts: impl IntoIterator<Item = Part<'p>>,
    ) -> Result<String, Refused> {
        let parts: Vec<Part<'p>> = parts.into_iter().collect();
        let mut out = String::new();
        for part in &parts {
            (part.render)(&mut out)?;
        }
        lock(&self.record).name(&parts);
        self.close(parts_json(&parts));
        Ok(out)
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
    /// The names of the components the record holds so far, each once, in the order they were
    /// given: those of every slot, and of each hole filled by now. The client loads each from
    /// `ferrovue/islands`, so [`Chunks::for_islands`](crate::page::Chunks::for_islands) says which
    /// scripts to preload for them.
    #[must_use]
    pub fn island_names(&self) -> Vec<&'static str> {
        lock(&self.record).names.clone()
    }

    /// Write the record as a `<script type="application/json">` with the given `id`, escaped as
    /// [`state_script_into`] escapes the state: `"__fv_page"` is what
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
        json_script_into(out, id, &record.to_json());
    }

    /// The record's `<script>`, ready once every hole of the page is filled or dropped. Leave a
    /// [`hole`] for it after the app's container and give it to the
    /// `HtmlStream` (the `stream` feature) after the futures of the page's holes.
    #[must_use]
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
        json_script_into(&mut out, &self.id, &record.to_json());
        Poll::Ready(out)
    }
}

impl Recorded {
    fn hold(&mut self, refused: Refused) {
        let held = self.refused.take();
        self.refused = first(held, Err(refused)).err();
    }

    fn name(&mut self, parts: &[Part<'_>]) {
        for part in parts {
            if !self.names.contains(&part.name) {
                self.names.push(part.name);
            }
        }
    }

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
        out.push('}');
        if !self.dates.is_empty() {
            out.push_str(",\"dates\":");
            out.push_str(self.dates);
        }
        out.push('}');
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
        if !part.dates.is_empty() {
            out.push_str(",\"d\":");
            out.push_str(part.dates);
        }
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

/// The chunks of a client build, read from Vite's manifest (`.vite/manifest.json`, written by
/// `vite build` with `build.manifest: true`): which scripts an island needs, so the page can name
/// them up front with `<link rel="modulepreload">` in place of the browser finding them one import
/// at a time once the client runs.
///
/// An island is found by its `NAME` through `.vite/ferrovue-islands.json`, which the Vite plugin
/// writes beside the manifest: the file of the chunk that holds each island. That is not always a
/// chunk of the island's own: one another chunk also imports is bundled into a chunk they share,
/// which the manifest does not key by the island's source. What a chunk needs is its own file
/// and, transitively, the chunks it imports statically; never an entry chunk, which the page's
/// `<script>` already loads, and not the chunks it imports dynamically, which it loads only when
/// it asks for them.
///
/// [`guide::islands_and_hydration`](crate::guide::islands_and_hydration#preloading-the-islands)
/// says where the links go.
///
/// # Example
///
/// ```
/// let manifest = r#"{
///     "client/main.ts": { "file": "assets/main.js", "isEntry": true, "imports": ["_vue.js"], "dynamicImports": ["client/components/Counter.vue"] },
///     "client/components/Counter.vue": { "file": "assets/Counter.js", "imports": ["_vue.js", "client/main.ts"] },
///     "_vue.js": { "file": "assets/vue.js" }
/// }"#;
/// let islands = r#"{ "Counter": "assets/Counter.js" }"#;
/// let chunks = ferrovue::page::Chunks::from_manifest(manifest, islands)?;
/// assert_eq!(chunks.for_islands(["Counter"]), ["/assets/Counter.js", "/assets/vue.js"]);
///
/// let mut preloads = chunks.preloads();
/// let mut out = String::new();
/// preloads.islands_into(&mut out, ["Counter"]);
/// preloads.islands_into(&mut out, ["Counter"]);
/// assert_eq!(
///     out,
///     r#"<link rel="modulepreload" href="/assets/Counter.js"><link rel="modulepreload" href="/assets/vue.js">"#
/// );
/// # Ok::<(), ferrovue::page::ManifestError>(())
/// ```
#[derive(Debug, Clone)]
pub struct Chunks {
    chunks: HashMap<String, Chunk>,
    islands: HashMap<String, String>,
    base: String,
}

/// The `<link rel="modulepreload">`s of one page, each URL written once however many islands
/// need it. Made by [`Chunks::preloads`].
#[derive(Debug)]
pub struct Preloads<'c> {
    chunks: &'c Chunks,
    linked: HashSet<&'c str>,
}

/// A manifest or a list of islands [`Chunks::from_manifest`] cannot read.
#[derive(Debug)]
pub struct ManifestError {
    what: &'static str,
    error: serde_json::Error,
}

#[derive(Debug, Clone, Deserialize)]
struct Chunk {
    file: String,
    #[serde(default)]
    imports: Vec<String>,
    #[serde(default, rename = "isEntry")]
    is_entry: bool,
}

impl Chunks {
    /// Read the texts of Vite's manifest (`.vite/manifest.json`) and of the islands the Vite
    /// plugin writes beside it (`.vite/ferrovue-islands.json`). URLs are the manifest's files
    /// under `/`; see [`with_base`](Self::with_base).
    ///
    /// # Errors
    ///
    /// When `manifest` is not a manifest (not JSON, or a chunk without its `file`), or `islands`
    /// is not an object of strings.
    pub fn from_manifest(manifest: &str, islands: &str) -> Result<Self, ManifestError> {
        let chunks: HashMap<String, Chunk> =
            serde_json::from_str(manifest).map_err(|error| ManifestError {
                what: "a Vite manifest",
                error,
            })?;
        let files: HashMap<String, String> =
            serde_json::from_str(islands).map_err(|error| ManifestError {
                what: "ferrovue's islands",
                error,
            })?;
        let keys: HashMap<&str, &str> = chunks
            .iter()
            .map(|(key, chunk)| (chunk.file.as_str(), key.as_str()))
            .collect();
        let islands = files
            .into_iter()
            .filter_map(|(name, file)| Some((name, (*keys.get(file.as_str())?).to_owned())))
            .collect();
        Ok(Chunks {
            chunks,
            islands,
            base: String::from("/"),
        })
    }

    /// Serve the files under `base`, Vite's `base`, ending in `/` (`"/static/"`,
    /// `"https://cdn.example.com/"`), in place of `/`. A link's URL is read against the page's, so
    /// a relative base such as `"./"` names the files under each page's own path: give the path or
    /// URL the build is served from.
    #[must_use]
    pub fn with_base(mut self, base: impl Into<String>) -> Self {
        self.base = base.into();
        self
    }

    /// The URLs the islands called `names` need, each once: an island's own chunk, then those
    /// it imports. A name that is no island of the build, or an island the manifest lacks, needs
    /// nothing.
    #[must_use]
    pub fn for_islands<'n>(&self, names: impl IntoIterator<Item = &'n str>) -> Vec<String> {
        let mut seen = HashSet::new();
        names
            .into_iter()
            .filter_map(|name| self.islands.get(name))
            .flat_map(|key| self.needed(key, &mut seen))
            .map(|file| self.url(file))
            .collect()
    }

    /// The URLs the chunk of the manifest's key `key` needs (a module the entry imports
    /// dynamically, such as `"client/app.ts"`): its own and those it imports, each once.
    #[must_use]
    pub fn for_source(&self, key: &str) -> Vec<String> {
        let Some((key, _)) = self.chunks.get_key_value(key) else {
            return Vec::new();
        };
        self.needed(key, &mut HashSet::new())
            .into_iter()
            .map(|file| self.url(file))
            .collect()
    }

    /// A page's links, which write each URL once.
    #[must_use]
    pub fn preloads(&self) -> Preloads<'_> {
        Preloads {
            chunks: self,
            linked: HashSet::new(),
        }
    }

    fn needed<'c>(&'c self, key: &'c str, seen: &mut HashSet<&'c str>) -> Vec<&'c str> {
        let mut files = Vec::new();
        let mut stack = vec![key];
        while let Some(key) = stack.pop() {
            if !seen.insert(key) {
                continue;
            }
            let Some(chunk) = self.chunks.get(key) else {
                continue;
            };
            if chunk.is_entry {
                continue;
            }
            files.push(chunk.file.as_str());
            stack.extend(chunk.imports.iter().rev().map(String::as_str));
        }
        files
    }

    fn url(&self, file: &str) -> String {
        format!("{}{file}", self.base)
    }
}

impl<'c> Preloads<'c> {
    /// Write a `<link rel="modulepreload">` for each chunk the islands called `names` need that
    /// this page has not linked yet.
    pub fn islands_into<'n>(&mut self, out: &mut String, names: impl IntoIterator<Item = &'n str>) {
        let chunks = self.chunks;
        for name in names {
            if let Some(key) = chunks.islands.get(name) {
                self.key_into(out, key);
            }
        }
    }

    /// Write a `<link rel="modulepreload">` for each chunk the manifest's key `key` needs that
    /// this page has not linked yet.
    pub fn source_into(&mut self, out: &mut String, key: &str) {
        if let Some((key, _)) = self.chunks.chunks.get_key_value(key) {
            self.key_into(out, key);
        }
    }

    fn key_into(&mut self, out: &mut String, key: &'c str) {
        let chunks = self.chunks;
        for file in chunks.needed(key, &mut HashSet::new()) {
            if self.linked.insert(file) {
                out.push_str("<link rel=\"modulepreload\" href=\"");
                ferrovue_core::escape_into(out, &chunks.url(file));
                out.push_str("\">");
            }
        }
    }
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "not {}: {}", self.what, self.error)
    }
}

impl std::error::Error for ManifestError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

/// The teleported content of one render, by target, in the order Vue collects it.
///
/// It is not `Sync`: give each render its own.
///
/// # Example
///
/// ```
/// use ferrovue::page::{teleport_into, Teleports};
///
/// let teleports = Teleports::new();
/// let mut body = String::new();
/// // What a generated component writes for `<Teleport to="#modals"><p>hi</p></Teleport>`.
/// teleport_into(&mut body, &teleports, "#modals", false, &|out: &mut String| out.push_str("<p>hi</p>"));
///
/// assert_eq!(body, "<!--teleport start--><!--teleport end-->");
/// let modals = teleports.get("#modals").unwrap_or_default();
/// assert_eq!(modals, "<!--teleport start anchor--><p>hi</p><!--teleport anchor-->");
/// // The page then writes `<div id="modals">{modals}</div>`.
/// ```
#[derive(Debug, Default)]
pub struct Teleports {
    targets: RefCell<Vec<(String, Vec<String>)>>,
}

impl Teleports {
    /// An empty collector: one per page render.
    ///
    /// # Example
    ///
    /// ```
    /// let teleports = ferrovue::page::Teleports::new();
    /// assert_eq!(teleports.get("#modals"), None);
    /// ```
    #[must_use]
    pub fn new() -> Teleports {
        Teleports::default()
    }

    /// What was teleported to `target` (`"body"`, `"#modals"`), to write inside that element;
    /// `None` when nothing was. `target` is the `to` exactly as the template wrote it.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::page::{teleport_into, Teleports};
    ///
    /// let teleports = Teleports::new();
    /// let mut body = String::new();
    /// teleport_into(&mut body, &teleports, "#modals", false, &|out: &mut String| out.push_str("a"));
    /// teleport_into(&mut body, &teleports, "#modals", false, &|out: &mut String| out.push_str("b"));
    /// // Both, in the order they rendered.
    /// assert_eq!(
    ///     teleports.get("#modals").unwrap(),
    ///     "<!--teleport start anchor-->a<!--teleport anchor--><!--teleport start anchor-->b<!--teleport anchor-->"
    /// );
    /// assert_eq!(teleports.get("#other"), None);
    /// ```
    #[must_use]
    pub fn get(&self, target: &str) -> Option<String> {
        self.targets
            .borrow()
            .iter()
            .find(|(t, _)| t == target)
            .map(|(_, parts)| parts.concat())
    }

    /// Every target and what was teleported to it, in the order the targets were first used.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::page::{teleport_into, Teleports};
    ///
    /// let teleports = Teleports::new();
    /// let mut body = String::new();
    /// teleport_into(&mut body, &teleports, "#overlay", false, &|out: &mut String| out.push_str("o"));
    /// teleport_into(&mut body, &teleports, "#modals", false, &|out: &mut String| out.push_str("m"));
    ///
    /// let targets: Vec<String> = teleports.into_targets().into_iter().map(|(target, _)| target).collect();
    /// assert_eq!(targets, ["#overlay", "#modals"]);
    /// ```
    #[must_use]
    pub fn into_targets(self) -> Vec<(String, String)> {
        self.targets
            .into_inner()
            .into_iter()
            .map(|(t, parts)| (t, parts.concat()))
            .collect()
    }

    fn reserve(&self, target: &str) -> usize {
        let mut targets = self.targets.borrow_mut();
        let parts = match targets.iter().position(|(t, _)| t == target) {
            Some(i) => &mut targets[i].1,
            None => {
                targets.push((target.to_owned(), Vec::new()));
                &mut targets.last_mut().expect("just pushed").1
            }
        };
        parts.push(String::new());
        parts.len() - 1
    }

    fn fill(&self, target: &str, index: usize, content: String) {
        let mut targets = self.targets.borrow_mut();
        if let Some((_, parts)) = targets.iter_mut().find(|(t, _)| t == target) {
            parts[index] = content;
        }
    }
}

/// `ssrRenderTeleport`: the markers in place and the content in the target's buffer, or, when
/// disabled, the content in place and empty anchors in the target.
///
/// # Example
///
/// ```
/// use ferrovue::page::{teleport_into, Teleports};
///
/// let teleports = Teleports::new();
/// let mut out = String::new();
/// // `<Teleport to="#modals" disabled>`: the content stays where it is.
/// teleport_into(&mut out, &teleports, "#modals", true, &|out: &mut String| out.push_str("<p>here</p>"));
/// assert_eq!(out, "<!--teleport start--><p>here</p><!--teleport end-->");
/// assert_eq!(
///     teleports.get("#modals").unwrap(),
///     "<!--teleport start anchor--><!--teleport anchor-->"
/// );
/// ```
#[doc(hidden)]
pub fn teleport_into(
    out: &mut String,
    teleports: &Teleports,
    target: &str,
    disabled: bool,
    content: &dyn Fn(&mut String),
) {
    out.push_str("<!--teleport start-->");
    let index = teleports.reserve(target);
    if disabled {
        content(out);
        teleports.fill(
            target,
            index,
            "<!--teleport start anchor--><!--teleport anchor-->".to_owned(),
        );
    } else {
        let mut moved = String::from("<!--teleport start anchor-->");
        content(&mut moved);
        moved.push_str("<!--teleport anchor-->");
        teleports.fill(target, index, moved);
    }
    out.push_str("<!--teleport end-->");
}

/// The stores' state as the client reads it back before it hydrates: a `<script type="application/json">`,
/// which a `script-src 'self'` policy does not run, so the page needs no nonce for it. `<`, `>`, `&`
/// and the two line separators are written as JSON escapes, so no value can end the element or be
/// read as markup inside it.
///
/// `id` is the element's `id`, which the client looks the state up by: `"__pinia"` is what
/// `hydrateState` from `ferrovue/client` reads by default.
///
/// # Example
///
/// ```
/// let state = serde_json::json!({ "prefs": { "theme": "</script>" } });
/// let mut page = String::new();
/// ferrovue::page::state_script_into(&mut page, "__pinia", &state);
/// assert_eq!(
///     page,
///     r#"<script type="application/json" id="__pinia">{"prefs":{"theme":"\u003c/script\u003e"}}</script>"#
/// );
/// ```
pub fn state_script_into(out: &mut String, id: &str, state: &impl Serialize) {
    json_script_into(out, id, &json::to_string(state));
}

pub(crate) fn json_script_into(out: &mut String, id: &str, json: &str) {
    out.push_str("<script type=\"application/json\" id=\"");
    escape_into(out, id);
    out.push_str("\">");
    json_escaped_into(out, json);
    out.push_str("</script>");
}

pub(crate) fn json_escaped_into(out: &mut String, json: &str) {
    out.reserve(json.len());
    let bytes = json.as_bytes();
    let (mut last, mut i) = (0, 0);
    while i < bytes.len() {
        let (rep, width) = match bytes[i] {
            b'<' => ("\\u003c", 1),
            b'>' => ("\\u003e", 1),
            b'&' => ("\\u0026", 1),
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

pub(crate) const HOLE: &str = "<fv-hole\"</script</style</noscript>";

fn write_open_hole(out: &mut String) {
    out.push_str(HOLE);
}

/// A slot whose content the caller writes itself, later: render with holes, [`split_holes`] the
/// output, and write the pieces with each hole's content between them, which is how a page streams
/// its parts in the order they are ready. A hole is content to the slot, so its fallback never
/// shows. [`guide::streaming`](crate::guide::streaming) shows a whole streamed page.
///
/// # Example
///
/// ```
/// use ferrovue::{page::{hole, split_holes}, render::slot_into};
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
#[must_use]
pub fn hole() -> Slot<'static> {
    Slot::new(&write_open_hole)
}

/// The pieces of a render between its holes, in order: one more than there were holes. The pieces
/// borrow from `rendered`.
///
/// # Example
///
/// ```
/// use ferrovue::{page::{hole, split_holes}, render::slot_into};
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
#[must_use]
pub fn split_holes(rendered: &str) -> Vec<&str> {
    rendered.split(HOLE).collect()
}

#[cfg(test)]
mod tests;
