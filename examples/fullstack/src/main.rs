//! A bookshop served by axum: pages rendered by Vue components compiled to Rust by ferrovue, and
//! hydrated in the browser by a Vite build of the same components.
//!
//! ```sh
//! pnpm --filter ferrovue-example-fullstack build   # the client, and src/generated/
//! cargo run -p ferrovue-example-fullstack          # http://localhost:3000
//! cargo run -p ferrovue-example-fullstack -- --render /books/dune   # one page, to stdout
//! ```

#[rustfmt::skip]
mod generated;

mod assets;
mod catalogue;
mod pages;

use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::http::{StatusCode, Uri, header};
use axum::response::Response;
use futures_util::{StreamExt, stream};
use tower_http::services::ServeDir;

use assets::Assets;
use pages::{Hole, Page, Site};

/// How long the reviews take to look up when serving: long enough to see the page stream.
const REVIEW_DELAY: Duration = Duration::from_millis(800);

const USAGE: &str = "usage: ferrovue-example-fullstack [--render <path>]";

#[tokio::main]
async fn main() {
    let dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("dist");
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [] => serve(dist).await,
        [flag, path] if flag == "--render" => {
            // Every hole filled at once: the page as a browser receives it once the stream ends.
            let site = Site::new(
                Assets::from_manifest(&dist).unwrap_or(Assets::None),
                Duration::ZERO,
            );
            let (_, html) = site.render_to_string(path).await;
            print!("{html}");
        }
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    }
}

async fn serve(dist: PathBuf) {
    let site = Arc::new(Site::new(Assets::from_env(&dist), REVIEW_DELAY));
    let app = Router::new()
        .nest_service("/assets", ServeDir::new(dist.join("assets")))
        .fallback(page)
        .with_state(site);
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_owned());
    let listener =
        tokio::net::TcpListener::bind(("127.0.0.1", port.parse().expect("PORT is a port number")))
            .await
            .expect("the port is free");
    println!(
        "listening on http://{}",
        listener.local_addr().expect("a bound address")
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("the server runs");
}

/// Every page: the markup up to the first hole goes out at once, each hole's content follows as
/// soon as it is ready, and the markup after it straight behind.
async fn page(State(site): State<Arc<Site>>, uri: Uri) -> Response {
    let Page {
        status,
        pieces,
        holes,
    } = site.page(uri.path());
    enum Part {
        Ready(String),
        Later(Hole),
    }
    let mut parts = Vec::with_capacity(pieces.len() + holes.len());
    let mut holes = holes.into_iter();
    for piece in pieces {
        parts.push(Part::Ready(piece));
        parts.extend(holes.next().map(Part::Later));
    }
    let body = stream::iter(parts).then(move |part| {
        let site = Arc::clone(&site);
        async move {
            Ok::<_, Infallible>(match part {
                Part::Ready(html) => html,
                Part::Later(hole) => site.fill(&hole).await,
            })
        }
    });
    Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK))
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from_stream(body))
        .expect("a valid response")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site() -> Site {
        let assets = Assets::Built {
            script: "/assets/main.js".to_owned(),
            styles: vec!["/assets/main.css".to_owned()],
        };
        Site::new(assets, Duration::ZERO)
    }

    #[tokio::test]
    async fn the_home_page_lists_every_book_with_an_island_each() {
        let (status, html) = site().render_to_string("/").await;
        assert_eq!(status, 200);
        assert!(html.starts_with("<!doctype html>"), "{html}");
        assert_eq!(
            html.matches(r#"data-island="AddToBasket""#).count(),
            4,
            "{html}"
        );
        assert!(html.contains(r#"<a href="/books/left-hand""#), "{html}");
        // The named link to the home page is the active one.
        assert!(
            html.contains(r#"<a aria-current="page" href="/" class="active brand">"#),
            "{html}"
        );
        // The store's state is rendered, through its getter, and sent for the client to start from.
        assert!(html.contains("Basket of guest: <b>1</b> book"), "{html}");
        assert!(
            html.contains(r#"<script type="application/json" id="__pinia">{"basket":{"owner":"guest","ids":["solaris"]}}</script>"#),
            "{html}"
        );
        assert!(
            html.contains(r#"<link rel="stylesheet" href="/assets/main.css">"#),
            "{html}"
        );
        assert!(
            html.ends_with(
                r#"<script type="module" src="/assets/main.js"></script></body></html>"#
            ),
            "{html}"
        );
    }

    #[tokio::test]
    async fn a_book_page_reads_its_route_and_streams_its_reviews() {
        let site = site();
        let page = site.page("/books/dune");
        assert_eq!(page.holes, [Hole::Reviews("dune".to_owned())]);
        let [before, after] = page.pieces.as_slice() else {
            panic!("one hole, two pieces");
        };
        // Everything before the reviews goes out first, and the reviews are not in it.
        assert!(before.contains("<h1>Dune</h1>"), "{before}");
        assert!(
            before.contains(r#"<article class="book" data-id="dune">"#),
            "{before}"
        );
        assert!(before.contains("<code>/books/dune</code>"), "{before}");
        assert!(before.ends_with("<h2>Reviews</h2><!--[-->"), "{before}");
        assert!(after.starts_with("<!--]--></section>"), "{after}");
        let reviews = site.fill(&page.holes[0]).await;
        assert!(
            reviews.starts_with(r#"<div data-island="Reviews""#),
            "{reviews}"
        );
        // Escaped, in the markup and in the island's props.
        assert!(
            reviews.contains("Too much sand &lt;for me&gt;."),
            "{reviews}"
        );
        // The page whole is the pieces with the hole filled.
        let (_, whole) = site.render_to_string("/books/dune").await;
        assert_eq!(whole, format!("{before}{reviews}{after}"));
    }

    #[tokio::test]
    async fn an_unknown_book_or_path_is_not_found() {
        for path in ["/books/missing", "/nowhere"] {
            let (status, html) = site().render_to_string(path).await;
            assert_eq!(status, 404, "{path}");
            assert!(html.contains(&format!("<code>{path}</code>")), "{html}");
        }
    }
}
