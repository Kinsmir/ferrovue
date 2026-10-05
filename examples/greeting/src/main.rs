//! Renders a page from two Vue components, with no JavaScript at run time.

#[rustfmt::skip]
mod generated;

use generated::{greeting, layout, route_table};

fn main() {
    let router = route_table::router();
    let route = router.at("/users/ada");

    let greeting = greeting::Props::new("Ada", 3);
    let page = |out: &mut String| greeting::island(&greeting).render_to(out);

    let mut html = String::from("<!doctype html><html><body>");
    layout::render(
        &mut html,
        &layout::Props::new("ada"),
        layout::Slots {
            router_view: ferrovue::Slot::new(&page),
        },
        &route,
    );
    html.push_str("</body></html>");
    println!("{html}");
}
