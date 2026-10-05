//! A bookshop served by axum: pages rendered by Vue components compiled to Rust by ferrovue, and
//! hydrated in the browser by a Vite build of the same components.

#[rustfmt::skip]
mod generated;

mod assets;
mod catalogue;
mod pages;
mod ui;

ferrovue::conformance!("fixtures", generated::render_json, at_least = 24);

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use ferrovue::HtmlStream;
use tower_http::services::ServeDir;

use assets::Assets;
use pages::{Page, Site};

const REVIEW_DELAY: Duration = Duration::from_millis(800);

const USAGE: &str = "usage: ferrovue-example-fullstack [--render <path>]";

#[tokio::main]
async fn main() {
    let dist = std::env::var_os("DIST_DIR").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("dist"),
        PathBuf::from,
    );
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [] => serve(dist).await,
        [flag, path] if flag == "--render" => {
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
        .route("/books/{id}/reviews", get(reviews))
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

async fn page(State(site): State<Arc<Site>>, uri: Uri) -> Response {
    let Page {
        status,
        html,
        holes,
    } = site.page(uri.path());
    let body = HtmlStream::new(html).holes(holes.into_iter().map(|hole| {
        let site = Arc::clone(&site);
        async move { site.fill(hole).await }
    }));
    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::OK);
    (status, body).into_response()
}

async fn reviews(State(site): State<Arc<Site>>, Path(id): Path<String>) -> impl IntoResponse {
    site.reviews(&id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::Hole;

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
        assert_eq!(
            html.matches(r#"data-hydrate="interaction""#).count(),
            4,
            "{html}"
        );
        assert!(html.contains(r#"<a href="/books/left-hand""#), "{html}");
        assert!(
            html.contains(r#"<a aria-current="page" href="/" class="active brand">"#),
            "{html}"
        );
        assert!(
            html.contains("Basket of guest: <b data-v-0a3b973f>1</b> book"),
            "{html}"
        );
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
        assert!(
            matches!(&page.holes[..], [Hole::Reviews(id)] if id == "dune"),
            "{:?}",
            page.holes
        );
        let [before, after] = ferrovue::split_holes(&page.html)[..] else {
            panic!("one hole, two pieces");
        };
        assert!(before.contains("<h1>Dune</h1>"), "{before}");
        assert!(
            before.contains(r#"<article class="book" data-id="dune">"#),
            "{before}"
        );
        assert!(before.contains("<code>/books/dune</code>"), "{before}");
        assert!(before.ends_with("<h2>Reviews</h2><!--[-->"), "{before}");
        assert!(after.starts_with("<!--]--></section>"), "{after}");
        let reviews = site.fill(page.holes.into_iter().next().unwrap()).await;
        assert!(
            reviews.starts_with(r#"<div data-island="Reviews""#),
            "{reviews}"
        );
        assert!(
            reviews.contains(r#"}]}" data-hydrate="visible"><div class="review-list""#),
            "{reviews}"
        );
        assert!(
            reviews.contains("Too much sand &lt;for me&gt;."),
            "{reviews}"
        );
        let (_, whole) = site.render_to_string("/books/dune").await;
        assert_eq!(whole, format!("{before}{reviews}{after}"));
    }

    #[tokio::test]
    async fn the_handler_streams_the_page_whole_with_its_status() {
        let site = Arc::new(site());
        for (path, status) in [("/books/dune", 200), ("/picks", 200), ("/nowhere", 404)] {
            let response = page(State(Arc::clone(&site)), Uri::from_static(path)).await;
            assert_eq!(response.status(), status, "{path}");
            assert_eq!(
                response.headers()["content-type"],
                "text/html; charset=utf-8"
            );
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("a body");
            let (_, whole) = site.render_to_string(path).await;
            assert_eq!(body, whole, "{path}");
        }
    }

    #[tokio::test]
    async fn the_picks_page_is_one_app_recorded_after_its_streamed_reviews() {
        let (status, html) = site().render_to_string("/picks").await;
        assert_eq!(status, 200);
        assert!(
            html.contains(r#"<body><div id="app"><div class="layout picks"><header>"#),
            "{html}"
        );
        assert!(!html.contains("data-island"), "{html}");
        assert!(
            html.contains(r#"<main><!--[--><article class="pick" data-id="dune"><h2>Dune</h2>"#),
            "{html}"
        );
        assert!(html.contains("Too much sand &lt;for me&gt;."), "{html}");
        let record = html
            .split_once(r#"</div><script type="application/json" id="__fv_page">"#)
            .and_then(|(_, rest)| rest.split_once("</script>"))
            .map(|(record, _)| record)
            .expect("the record after the app");
        assert!(
            record.starts_with(r#"{"props":{"shop":"Ferrovue Books","featured":"Dune"},"slots":{"default":[{"c":"Pick","p":{"book":{"id":"dune","#),
            "{record}"
        );
        assert!(
            record.contains(r#""reviews":[{"c":"Reviews","p":{"reviews":[{"reader":"Ada","#),
            "{record}"
        );
        assert!(
            record.contains(r#"Too much sand \u003cfor me\u003e."#),
            "{record}"
        );
    }

    #[tokio::test]
    async fn the_reviews_are_a_response_of_their_own() {
        let site = Arc::new(site());
        let response = reviews(State(Arc::clone(&site)), Path("dune".to_owned()))
            .await
            .into_response();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()["content-type"],
            "text/html; charset=utf-8"
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("a body");
        let hole = Hole::Reviews("dune".to_owned());
        assert_eq!(body, site.fill(hole).await);
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
