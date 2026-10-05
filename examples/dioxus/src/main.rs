//! A page that Dioxus renders on the server, with a Vue island in it that the browser hydrates.

#[rustfmt::skip]
mod generated;

use dioxus::prelude::*;
use generated::counter;

#[component]
fn Page(title: String, start: i64) -> Element {
    let clicks = counter::Props::new("Clicks", start);
    let total = counter::Props::new("Total", start * 2);
    rsx! {
        main {
            h1 { "{title}" }
            {counter::island(&clicks)}
            section { dangerous_inner_html: counter::island(&total).into_string() }
        }
        script { r#type: "module", src: "/assets/main.js" }
    }
}

fn render(title: &str, start: i64) -> String {
    let mut dom = VirtualDom::new_with_props(
        Page,
        PageProps {
            title: title.to_owned(),
            start,
        },
    );
    dom.rebuild_in_place();
    dioxus_ssr::render(&dom)
}

fn main() {
    println!("<!doctype html>{}", render("Dioxus & Vue", 3));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_island_holds_exactly_the_markup_vue_hydrates() {
        let page = render("Dioxus & Vue", 3);
        let clicks = counter::Props::new("Clicks", 3);
        let mut markup = String::new();
        counter::render(&mut markup, &clicks);
        let total = counter::island(&counter::Props::new("Total", 6)).into_string();
        assert_eq!(
            page,
            format!(
                concat!(
                    "<main><h1>Dioxus &#38; Vue</h1>",
                    r#"<div data-island="Counter" data-props="{{&#34;label&#34;:&#34;Clicks&#34;,&#34;start&#34;:3}}">{}</div>"#,
                    "<section>{}</section>",
                    "</main>",
                    r#"<script type="module" src="/assets/main.js"></script>"#,
                ),
                markup, total
            )
        );
        assert_eq!(markup, r#"<button type="button">Clicks: 3</button>"#);
    }

    #[test]
    fn a_fullstack_render_adds_no_marker_inside_an_island() {
        let mut dom = VirtualDom::new_with_props(
            Page,
            PageProps {
                title: "t".to_owned(),
                start: 1,
            },
        );
        dom.rebuild_in_place();
        let page = dioxus_ssr::pre_render(&dom);
        let island = counter::island(&counter::Props::new("Total", 2)).into_string();
        assert!(page.contains(&format!(">{island}</section>")), "{page}");
        assert!(
            page.contains(
                r#"data-node-hydration="2"><button type="button">Clicks: 1</button></div>"#
            ),
            "{page}"
        );
    }
}
