use std::time::Duration;

use ferrovue::{Head, Hydrate, PageHole, PageScript, Part, Route, Router, Slot};

use crate::assets::Assets;
use crate::catalogue;
use crate::generated::stores::{BasketState, Stores};
use crate::generated::{
    add_to_basket, books_id, index, layout, missing, pick, picks, reviews, route_table,
};

const SHOP: &str = "Ferrovue Books";

/// A rendered page, ready to stream: `html` with each of `holes` filled.
pub struct Page {
    /// The HTTP status.
    pub status: u16,
    /// The markup, with a [`ferrovue::hole`] where each of `holes` goes.
    pub html: String,
    /// What goes in each hole, in order.
    pub holes: Vec<Hole>,
}

/// A part of a page that is written after the rest, once its data is ready.
#[derive(Debug)]
pub enum Hole {
    /// The reviews of the book with this id.
    Reviews(String),
    /// The reviews of the book with this id, as a part of a page hydrated whole.
    PageReviews(String, PageHole),
    /// The record of a page hydrated whole, once its other holes are filled.
    Record(PageScript),
}

/// What every request shares: the routes, the client's assets, and how slow the reviews are.
pub struct Site {
    router: Router,
    assets: Assets,
    review_delay: Duration,
}

impl Site {
    /// A site loading the client from `assets`, whose reviews take `review_delay` to look up.
    pub fn new(assets: Assets, review_delay: Duration) -> Site {
        Site {
            router: route_table::router(),
            assets,
            review_delay,
        }
    }

    /// The page at `location` (a path), rendered up to its holes.
    pub fn page(&self, location: &str) -> Page {
        let route = self.router.at(location);
        let stores = Stores::new(BasketState::new("guest", ["solaris"]));
        match (route.name(), route.param("id")) {
            (Some("/"), _) => self.home(&route, &stores),
            (Some("/picks"), _) => self.picks(&route, &stores),
            (Some("/books/[id]"), Some(id)) => match catalogue::book(id) {
                Some(book) => self.book(&route, &stores, book),
                None => self.not_found(&route, &stores, location),
            },
            _ => self.not_found(&route, &stores, location),
        }
    }

    /// The content of one hole: the slow part of a page, as an island the client hydrates.
    pub async fn fill(&self, hole: Hole) -> String {
        match hole {
            Hole::Reviews(id) => self.reviews(&id).await.into_string(),
            Hole::PageReviews(id, hole) => {
                let list = catalogue::reviews(&id, self.review_delay).await;
                hole.fill([Part::new(
                    reviews::NAME,
                    reviews::into_html(reviews::Props::new(list)),
                )])
            }
            Hole::Record(script) => script.await,
        }
    }

    /// A book's reviews, as the island the client hydrates once it is scrolled into view: what
    /// fills the book page's hole, and a response of its own. It holds its props, so it outlives
    /// this call.
    pub async fn reviews(&self, id: &str) -> ferrovue::Html<'static, reviews::Props<'static>> {
        let list = catalogue::reviews(id, self.review_delay).await;
        reviews::into_island(reviews::Props::new(list)).hydrate(Hydrate::Visible)
    }

    /// The whole page at once, every hole filled: what a client that can't stream would get.
    pub async fn render_to_string(&self, location: &str) -> (u16, String) {
        let Page {
            status,
            html,
            holes,
        } = self.page(location);
        let mut out = String::new();
        let mut holes = holes.into_iter();
        for piece in ferrovue::split_holes(&html) {
            out.push_str(piece);
            if let Some(hole) = holes.next() {
                out.push_str(&self.fill(hole).await);
            }
        }
        (status, out)
    }

    fn home(&self, route: &Route<'_>, stores: &Stores<'_>) -> Page {
        let head = Head::new();
        let props = index::Props::new(catalogue::books());
        let actions = |out: &mut String, slot: &index::ActionsSlotProps<'_>| {
            add_to_basket::island(&add_to_basket::Props::new(slot.id, slot.title))
                .hydrate(Hydrate::Interaction)
                .render_to(out);
            true
        };
        let view = |out: &mut String| {
            let slots = index::Slots {
                actions: Some(&actions),
            };
            index::render(out, &props, slots, route, &head);
        };
        let islands = [add_to_basket::NAME];
        let body = in_layout(&head, route, stores, &view);
        self.finish(200, &head, &body, stores, &islands, Vec::new())
    }

    fn book(
        &self,
        route: &Route<'_>,
        stores: &Stores<'_>,
        book: crate::generated::types::Book<'static>,
    ) -> Page {
        let head = Head::new();
        let id = book.id.clone();
        let add = add_to_basket::Props::new(id.clone(), book.title.clone());
        let props = books_id::Props::new(book);
        let actions = |out: &mut String| add_to_basket::island(&add).render_to(out);
        let view = |out: &mut String| {
            let slots = books_id::Slots {
                actions: Some(Slot::new(&actions)),
                reviews: Some(ferrovue::hole()),
            };
            books_id::render(out, &props, slots, route, &head);
        };
        let holes = vec![Hole::Reviews(id.into_owned())];
        let islands = [add_to_basket::NAME, reviews::NAME];
        let body = in_layout(&head, route, stores, &view);
        self.finish(200, &head, &body, stores, &islands, holes)
    }

    fn picks(&self, route: &Route<'_>, stores: &Stores<'_>) -> Page {
        let notes = [
            ("dune", "The desert planet, and the politics of water."),
            (
                "left-hand",
                "A winter journey that changes how you read gender.",
            ),
        ];
        let picks: Vec<pick::Props<'static>> = notes
            .into_iter()
            .filter_map(|(id, note)| Some(pick::Props::new(catalogue::book(id)?, note)))
            .collect();
        let asked = route.query("featured").attr_value();
        let featured = picks
            .iter()
            .find(|pick| Some(&*pick.book.id) == asked)
            .map_or(&picks[0].book, |pick| &pick.book);
        let mut page = ferrovue::Page::new();
        let parts = page.slot(
            "default",
            picks
                .iter()
                .map(|props| Part::new(pick::NAME, pick::html(props))),
        );
        let reviews = page.hole("reviews");
        let books = picks
            .iter()
            .map(|pick| pick.book.clone())
            .collect::<Vec<_>>();
        let props = picks::Props::new(SHOP, featured.title.clone(), books);
        let head = Head::new();
        let mut body = String::from("<div id=\"app\">");
        let slots = picks::Slots {
            default: Some(parts.slot()),
            reviews: Some(reviews.slot()),
        };
        let record = page.render_to(&mut body, picks::html(&props, slots, route, &head));
        body.push_str("</div>");
        ferrovue::hole().render_to(&mut body);
        let mut islands = record.island_names();
        islands.push(reviews::NAME);
        let holes = vec![
            Hole::PageReviews(featured.id.clone().into_owned(), reviews),
            Hole::Record(record.script("__fv_page")),
        ];
        self.finish(200, &head, &body, stores, &islands, holes)
    }

    fn not_found(&self, route: &Route<'_>, stores: &Stores<'_>, location: &str) -> Page {
        let head = Head::new();
        let props = missing::Props::new(location);
        let view = |out: &mut String| missing::render(out, &props, route, &head);
        let body = in_layout(&head, route, stores, &view);
        self.finish(404, &head, &body, stores, &[], Vec::new())
    }

    /// The document around `body`, once it is rendered: the head its components asked for with
    /// `useHead`, as unhead's server renderer writes it, and the client's assets, with the chunks
    /// of the `islands` the page hydrates preloaded. The head is written once the body is, so it
    /// can name every island, those of the holes included.
    fn finish(
        &self,
        status: u16,
        head: &Head,
        body: &str,
        stores: &Stores<'_>,
        islands: &[&str],
        holes: Vec<Hole>,
    ) -> Page {
        let tags = head.render();
        let mut out = format!("<!doctype html><html{}><head>", tags.html_attrs);
        out.push_str(&tags.head_tags);
        self.assets.styles_into(&mut out);
        self.assets.preloads_into(&mut out, islands.iter().copied());
        out.push_str(&format!("</head><body{}>", tags.body_attrs));
        out.push_str(&tags.body_tags_open);
        out.push_str(body);
        out.push_str(&tags.body_tags);
        ferrovue::state_script_into(&mut out, "__pinia", stores);
        self.assets.scripts_into(&mut out);
        out.push_str("</body></html>");
        assert_eq!(
            ferrovue::split_holes(&out).len(),
            holes.len() + 1,
            "one hole filled per hole left"
        );
        Page {
            status,
            html: out,
            holes,
        }
    }
}

/// The body of a page whose `view` goes in the layout's `<RouterView>`.
fn in_layout(
    head: &Head,
    route: &Route<'_>,
    stores: &Stores<'_>,
    view: &dyn Fn(&mut String),
) -> String {
    let mut body = String::new();
    let slots = layout::Slots {
        router_view: Slot::new(view),
    };
    layout::render(
        &mut body,
        &layout::Props::new(SHOP),
        slots,
        route,
        stores,
        head,
    );
    body
}
