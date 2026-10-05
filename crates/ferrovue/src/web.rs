use std::convert::Infallible;
use std::future::Future;
use std::ops::Range;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use futures_core::Stream;

#[cfg(any(feature = "axum", feature = "actix-web"))]
use crate::Html;
use crate::slots::HOLE;

#[cfg(any(feature = "axum", feature = "actix-web"))]
const TEXT_HTML: &str = "text/html; charset=utf-8";

enum Hole {
    Loading(Pin<Box<dyn Future<Output = String> + Send>>),
    Ready(String),
}

/// A page rendered with [`hole`](crate::hole)s, sent in pieces: the markup up to the first hole at
/// once, then each hole's content as soon as it and every hole before it are ready, each followed
/// by the markup up to the next hole. [`guide::streaming`](crate::guide::streaming) explains holes.
///
/// Give it the whole render, holes and all, and a future for each hole, in the order the holes
/// appear: [`hole`](HtmlStream::hole) for one, [`holes`](HtmlStream::holes) for many. Their output
/// is written as it is, unescaped. A hole given no future is left empty, and a future beyond the
/// last hole is dropped without being run.
///
/// # Example
///
/// ```
/// use std::time::Duration;
///
/// use ferrovue::{hole, slot_into, HtmlStream};
///
/// // A page rendered with a hole where the reviews go.
/// let mut page = String::from("<h1>Dune</h1><section>");
/// slot_into(&mut page, Some(hole()), None);
/// page.push_str("</section>");
///
/// let body = HtmlStream::new(page).hole(async {
///     tokio::time::sleep(Duration::from_millis(10)).await; // a slow lookup
///     String::from("<p>A classic.</p>")
/// });
/// # #[cfg(feature = "axum")]
/// # tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap().block_on(async {
/// // In an axum handler, `body` is the response; read back here as a client would.
/// use axum::response::IntoResponse;
///
/// let response = body.into_response();
/// assert_eq!(response.headers()["content-type"], "text/html; charset=utf-8");
/// let sent = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
/// assert_eq!(sent, "<h1>Dune</h1><section><!--[--><p>A classic.</p><!--]--></section>");
/// # });
/// ```
#[cfg_attr(docsrs, doc(cfg(feature = "stream")))]
pub struct HtmlStream {
    page: Bytes,
    pieces: Vec<Range<usize>>,
    holes: Vec<Hole>,
    next: usize,
}

impl HtmlStream {
    /// A page to send: a render with holes, or without, as one piece.
    pub fn new(rendered: String) -> Self {
        let mut pieces = Vec::new();
        let mut start = 0;
        for (at, _) in rendered.match_indices(HOLE) {
            pieces.push(start..at);
            start = at + HOLE.len();
        }
        pieces.push(start..rendered.len());
        HtmlStream {
            page: Bytes::from(rendered),
            pieces,
            holes: Vec::new(),
            next: 0,
        }
    }

    /// The content of the next hole not yet given any: what `content` returns, once it is ready.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::{hole, slot_into, HtmlStream};
    ///
    /// let mut page = String::from("<main>");
    /// slot_into(&mut page, Some(hole()), None);
    /// page.push_str("<aside>");
    /// slot_into(&mut page, Some(hole()), None);
    /// page.push_str("</aside></main>");
    ///
    /// // Each hole's future is its own type: an `async` block, a call to an `async fn`.
    /// let id = String::from("dune");
    /// let body = HtmlStream::new(page)
    ///     .hole(async move { format!("<p>the reviews of {id}</p>") })
    ///     .hole(std::future::ready(String::from("<p>related books</p>")));
    /// ```
    pub fn hole(mut self, content: impl Future<Output = String> + Send + 'static) -> Self {
        if self.holes.len() + 1 < self.pieces.len() {
            self.holes.push(Hole::Loading(Box::pin(content)));
        }
        self
    }

    /// The content of the holes, in order, from the next not yet given any.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::{hole, slot_into, HtmlStream};
    ///
    /// let mut page = String::from("<ul>");
    /// for _ in 0..3 {
    ///     slot_into(&mut page, Some(hole()), None);
    /// }
    /// page.push_str("</ul>");
    ///
    /// let body = HtmlStream::new(page).holes(
    ///     ["Dune", "Solaris", "Kindred"].map(|title| async move { format!("<li>{title}</li>") }),
    /// );
    /// ```
    pub fn holes<I>(self, contents: I) -> Self
    where
        I: IntoIterator,
        I::Item: Future<Output = String> + Send + 'static,
    {
        contents.into_iter().fold(self, HtmlStream::hole)
    }

    #[cfg(any(feature = "axum", feature = "actix-web"))]
    fn whole(self) -> Result<Bytes, Self> {
        if self.pieces.len() == 1 {
            Ok(self.page)
        } else {
            Err(self)
        }
    }
}

impl std::fmt::Debug for HtmlStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let loading = self
            .holes
            .iter()
            .filter(|hole| matches!(hole, Hole::Loading(_)))
            .count();
        f.debug_struct("HtmlStream")
            .field("len", &self.page.len())
            .field("holes", &(self.pieces.len() - 1))
            .field("loading", &loading)
            .field("next", &self.next)
            .finish()
    }
}

impl Stream for HtmlStream {
    type Item = Result<Bytes, Infallible>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        for hole in &mut this.holes {
            if let Hole::Loading(content) = hole
                && let Poll::Ready(html) = content.as_mut().poll(cx)
            {
                *hole = Hole::Ready(html);
            }
        }
        loop {
            let i = this.next / 2;
            let chunk = if this.next.is_multiple_of(2) {
                let Some(piece) = this.pieces.get(i) else {
                    return Poll::Ready(None);
                };
                this.page.slice(piece.clone())
            } else {
                match this.holes.get_mut(i) {
                    Some(Hole::Loading(_)) => return Poll::Pending,
                    Some(Hole::Ready(html)) => Bytes::from(std::mem::take(html)),
                    None => Bytes::new(),
                }
            };
            this.next += 1;
            if !chunk.is_empty() {
                return Poll::Ready(Some(Ok(chunk)));
            }
        }
    }
}

/// A component as a whole response: `200 OK`, `text/html; charset=utf-8`, the markup. An
/// [`island`](crate::guide::generated_code#html-and-island) is a response too, for a client that
/// swaps it into a page.
///
/// # Example
///
/// ```
/// # mod greeting {
/// #     use std::borrow::Cow;
/// #     #[derive(serde::Serialize)]
/// #     pub struct Props<'a> { pub name: Cow<'a, str> }
/// #     impl<'a> Props<'a> {
/// #         pub fn new(name: impl Into<Cow<'a, str>>) -> Self { Props { name: name.into() } }
/// #     }
/// #     pub fn render(out: &mut String, props: &Props<'_>) {
/// #         out.push_str("<p>Hello, ");
/// #         ferrovue::escape_into(out, &props.name);
/// #         out.push_str("!</p>");
/// #     }
/// #     pub fn html<'p, 'a>(props: &'p Props<'a>) -> ferrovue::Html<'p, Props<'a>> {
/// #         ferrovue::Html::markup(props, render)
/// #     }
/// #     pub fn into_html<'a>(props: Props<'a>) -> ferrovue::Html<'a, Props<'a>> {
/// #         ferrovue::Html::markup_owned(props, render)
/// #     }
/// # }
/// # #[cfg(feature = "axum")]
/// # fn main() {
/// use axum::Router;
/// use axum::extract::Path;
/// use axum::response::IntoResponse;
/// use axum::routing::get;
///
/// async fn greet(Path(name): Path<String>) -> impl IntoResponse {
///     greeting::into_html(greeting::Props::new(name))
/// }
///
/// static GUEST: greeting::Props<'static> = greeting::Props {
///     name: std::borrow::Cow::Borrowed("guest"),
/// };
///
/// async fn welcome() -> impl IntoResponse {
///     greeting::html(&GUEST)
/// }
///
/// let app: Router = Router::new()
///     .route("/hello/{name}", get(greet))
///     .route("/", get(welcome));
/// # let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
/// # let response = runtime.block_on(greet(Path("<Ada>".to_owned()))).into_response();
/// # assert_eq!(response.status(), 200);
/// # assert_eq!(response.headers()["content-type"], "text/html; charset=utf-8");
/// # let body = runtime.block_on(axum::body::to_bytes(response.into_body(), usize::MAX)).unwrap();
/// # assert_eq!(body, "<p>Hello, &lt;Ada&gt;!</p>");
/// # }
/// # #[cfg(not(feature = "axum"))]
/// # fn main() {}
/// ```
#[cfg(feature = "axum")]
#[cfg_attr(docsrs, doc(cfg(feature = "axum")))]
impl<P: serde::Serialize, F: Fn(&mut String, &P)> axum_core::response::IntoResponse
    for Html<'_, P, F>
{
    fn into_response(self) -> axum_core::response::Response {
        html_response(axum_core::body::Body::from(self.into_string()))
    }
}

/// A page as a response: `200 OK`, `text/html; charset=utf-8`, streamed as its holes are filled,
/// or whole when it has none. For another status, respond with `(status, stream)`.
///
/// # Example
///
/// ```
/// # #[cfg(feature = "axum")]
/// # fn main() {
/// use axum::http::StatusCode;
/// use axum::response::{IntoResponse, Response};
/// use ferrovue::HtmlStream;
///
/// async fn not_found() -> Response {
///     let page = String::from("<!doctype html><h1>Not found</h1>");
///     (StatusCode::NOT_FOUND, HtmlStream::new(page)).into_response()
/// }
/// # let response = tokio::runtime::Builder::new_current_thread().build().unwrap().block_on(not_found());
/// # assert_eq!(response.status(), 404);
/// # assert_eq!(axum::body::HttpBody::size_hint(response.body()).exact(), Some(33));
/// # }
/// # #[cfg(not(feature = "axum"))]
/// # fn main() {}
/// ```
#[cfg(feature = "axum")]
#[cfg_attr(docsrs, doc(cfg(feature = "axum")))]
impl axum_core::response::IntoResponse for HtmlStream {
    fn into_response(self) -> axum_core::response::Response {
        use axum_core::body::Body;
        html_response(match self.whole() {
            Ok(page) => Body::from(page),
            Err(stream) => Body::from_stream(stream),
        })
    }
}

#[cfg(feature = "axum")]
fn html_response(body: axum_core::body::Body) -> axum_core::response::Response {
    let mut response = axum_core::response::Response::new(body);
    response.headers_mut().insert(
        http::header::CONTENT_TYPE,
        http::HeaderValue::from_static(TEXT_HTML),
    );
    response
}

/// A component as a whole response: `200 OK`, `text/html; charset=utf-8`, the markup. An
/// [`island`](crate::guide::generated_code#html-and-island) is a response too, for a client that
/// swaps it into a page.
///
/// # Example
///
/// ```
/// # mod greeting {
/// #     use std::borrow::Cow;
/// #     #[derive(serde::Serialize)]
/// #     pub struct Props<'a> { pub name: Cow<'a, str> }
/// #     impl<'a> Props<'a> {
/// #         pub fn new(name: impl Into<Cow<'a, str>>) -> Self { Props { name: name.into() } }
/// #     }
/// #     pub fn render(out: &mut String, props: &Props<'_>) {
/// #         out.push_str("<p>Hello, ");
/// #         ferrovue::escape_into(out, &props.name);
/// #         out.push_str("!</p>");
/// #     }
/// #     pub fn html<'p, 'a>(props: &'p Props<'a>) -> ferrovue::Html<'p, Props<'a>> {
/// #         ferrovue::Html::markup(props, render)
/// #     }
/// #     pub fn into_html<'a>(props: Props<'a>) -> ferrovue::Html<'a, Props<'a>> {
/// #         ferrovue::Html::markup_owned(props, render)
/// #     }
/// # }
/// # #[cfg(feature = "actix-web")]
/// # fn main() {
/// use actix_web::{App, HttpResponse, Responder, web};
///
/// async fn greet(name: web::Path<String>) -> impl Responder {
///     greeting::into_html(greeting::Props::new(name.into_inner()))
/// }
///
/// static GUEST: greeting::Props<'static> = greeting::Props {
///     name: std::borrow::Cow::Borrowed("guest"),
/// };
///
/// async fn welcome() -> impl Responder {
///     greeting::html(&GUEST)
/// }
///
/// let app = App::new()
///     .route("/hello/{name}", web::get().to(greet))
///     .route("/", web::get().to(welcome));
/// # let response = HttpResponse::from(greeting::into_html(greeting::Props::new("<Ada>")));
/// # assert_eq!(response.status(), 200);
/// # assert_eq!(response.headers().get("content-type").unwrap(), "text/html; charset=utf-8");
/// # let body = tokio::runtime::Builder::new_current_thread().build().unwrap()
/// #     .block_on(actix_web::body::to_bytes(response.into_body())).unwrap();
/// # assert_eq!(body, "<p>Hello, &lt;Ada&gt;!</p>");
/// # }
/// # #[cfg(not(feature = "actix-web"))]
/// # fn main() {}
/// ```
#[cfg(feature = "actix-web")]
#[cfg_attr(docsrs, doc(cfg(feature = "actix-web")))]
impl<P: serde::Serialize, F: Fn(&mut String, &P)> actix_web::Responder for Html<'_, P, F> {
    type Body = actix_web::body::BoxBody;

    fn respond_to(self, _: &actix_web::HttpRequest) -> actix_web::HttpResponse {
        self.into()
    }
}

#[cfg(feature = "actix-web")]
#[cfg_attr(docsrs, doc(cfg(feature = "actix-web")))]
impl<P: serde::Serialize, F: Fn(&mut String, &P)> From<Html<'_, P, F>> for actix_web::HttpResponse {
    fn from(html: Html<'_, P, F>) -> Self {
        actix_web::HttpResponse::Ok()
            .content_type(TEXT_HTML)
            .body(html.into_string())
    }
}

/// A page as a response: `200 OK`, `text/html; charset=utf-8`, streamed as its holes are filled,
/// or whole when it has none. For another status, `.customize().with_status(…)`.
///
/// # Example
///
/// ```
/// # #[cfg(feature = "actix-web")]
/// # fn main() {
/// use actix_web::Responder;
/// use actix_web::http::StatusCode;
/// use ferrovue::HtmlStream;
///
/// async fn not_found() -> impl Responder {
///     let page = String::from("<!doctype html><h1>Not found</h1>");
///     HtmlStream::new(page).customize().with_status(StatusCode::NOT_FOUND)
/// }
/// # }
/// # #[cfg(not(feature = "actix-web"))]
/// # fn main() {}
/// ```
#[cfg(feature = "actix-web")]
#[cfg_attr(docsrs, doc(cfg(feature = "actix-web")))]
impl actix_web::Responder for HtmlStream {
    type Body = actix_web::body::BoxBody;

    fn respond_to(self, _: &actix_web::HttpRequest) -> actix_web::HttpResponse {
        self.into()
    }
}

#[cfg(feature = "actix-web")]
#[cfg_attr(docsrs, doc(cfg(feature = "actix-web")))]
impl From<HtmlStream> for actix_web::HttpResponse {
    fn from(stream: HtmlStream) -> Self {
        let mut response = actix_web::HttpResponse::Ok();
        response.content_type(TEXT_HTML);
        match stream.whole() {
            Ok(page) => response.body(page),
            Err(stream) => response.streaming(stream),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::future::poll_fn;
    use std::time::Duration;

    use super::*;
    use crate::{hole, slot_into, split_holes};

    fn two_holes() -> String {
        let mut page = String::from("<h1>");
        slot_into(&mut page, Some(hole()), None);
        page.push_str("</h1><aside>");
        slot_into(&mut page, Some(hole()), None);
        page.push_str("</aside>");
        page
    }

    async fn chunks(mut stream: HtmlStream) -> Vec<String> {
        let mut sent = Vec::new();
        while let Some(chunk) = poll_fn(|cx| Pin::new(&mut stream).poll_next(cx)).await {
            let Ok(chunk) = chunk;
            sent.push(String::from_utf8(chunk.to_vec()).expect("UTF-8"));
        }
        sent
    }

    async fn after(ms: u64, html: &'static str) -> String {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        html.to_owned()
    }

    #[test]
    fn a_stream_debugs_as_its_length_holes_loading_holes_and_next_piece() {
        let page = two_holes();
        let len = page.len();
        let stream = HtmlStream::new(page).hole(after(0, "first"));
        assert_eq!(
            format!("{stream:?}"),
            format!("HtmlStream {{ len: {len}, holes: 2, loading: 1, next: 0 }}")
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_pieces_are_split_holes_with_each_hole_filled_in_order() {
        let page = two_holes();
        let pieces: Vec<String> = split_holes(&page).into_iter().map(str::to_owned).collect();
        let stream = HtmlStream::new(page)
            .hole(after(20, "first"))
            .hole(after(10, "second"));
        assert_eq!(
            chunks(stream).await,
            [&*pieces[0], "first", &pieces[1], "second", &pieces[2]]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_holes_are_fetched_at_once() {
        let start = tokio::time::Instant::now();
        let stream = HtmlStream::new(two_holes())
            .hole(after(100, "a"))
            .hole(after(100, "b"));
        chunks(stream).await;
        assert_eq!(start.elapsed(), Duration::from_millis(100));
    }

    #[tokio::test]
    async fn a_hole_without_content_is_empty_and_content_without_a_hole_is_dropped() {
        let stream = HtmlStream::new(two_holes()).hole(after(0, "only"));
        assert_eq!(
            chunks(stream).await.concat(),
            "<h1><!--[-->only<!--]--></h1><aside><!--[--><!--]--></aside>"
        );
        let stream = HtmlStream::new(two_holes()).holes(["a", "b", "c"].map(|s| after(0, s)));
        assert_eq!(
            chunks(stream).await.concat(),
            "<h1><!--[-->a<!--]--></h1><aside><!--[-->b<!--]--></aside>"
        );
    }

    #[tokio::test]
    async fn empty_pieces_and_contents_are_not_sent() {
        let mut page = String::new();
        slot_into(&mut page, Some(hole()), None);
        page.push_str(HOLE);
        let stream = HtmlStream::new(page).holes([after(0, ""), after(0, "x")]);
        assert_eq!(chunks(stream).await, ["<!--[-->", "<!--]-->", "x"]);
        assert!(chunks(HtmlStream::new(String::new())).await.is_empty());
    }

    #[cfg(feature = "axum")]
    #[tokio::test]
    async fn axum_sends_a_page_without_holes_whole_and_one_with_holes_streamed() {
        use axum::body::HttpBody;
        use axum_core::response::IntoResponse;

        let response = HtmlStream::new("<p>whole</p>".to_owned()).into_response();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], TEXT_HTML);
        assert_eq!(response.body().size_hint().exact(), Some(12));

        let response = HtmlStream::new(two_holes())
            .holes(["a", "b"].map(|s| after(0, s)))
            .into_response();
        assert_eq!(response.headers()["content-type"], TEXT_HTML);
        assert_eq!(response.body().size_hint().exact(), None);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("a body");
        assert_eq!(
            body,
            "<h1><!--[-->a<!--]--></h1><aside><!--[-->b<!--]--></aside>"
        );
    }

    #[cfg(feature = "axum")]
    #[tokio::test]
    async fn an_axum_handler_returns_a_page_holding_the_props_it_built() {
        use std::borrow::Cow;

        use axum::extract::Path;
        use axum::routing::get;
        use axum_core::response::IntoResponse;

        #[derive(serde::Serialize)]
        struct Props<'a> {
            name: Cow<'a, str>,
        }
        fn render(out: &mut String, props: &Props<'_>) {
            out.push_str("<b>");
            crate::escape_into(out, &props.name);
            out.push_str("</b>");
        }
        async fn greet(Path(name): Path<String>) -> impl IntoResponse {
            Html::island_owned("Name", Props { name: name.into() }, render)
        }
        let _: axum::Router = axum::Router::new().route("/{name}", get(greet));

        let response = greet(Path("<Ada>".to_owned())).await.into_response();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], TEXT_HTML);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("a body");
        assert_eq!(
            body,
            r#"<div data-island="Name" data-props="{&quot;name&quot;:&quot;&lt;Ada&gt;&quot;}"><b>&lt;Ada&gt;</b></div>"#
        );
    }

    #[cfg(feature = "actix-web")]
    #[tokio::test]
    async fn actix_sends_a_component_and_a_streamed_page() {
        use actix_web::Responder;
        use actix_web::body::{BodySize, MessageBody, to_bytes};

        #[derive(serde::Serialize)]
        struct Props<'a> {
            name: &'a str,
        }
        fn render(out: &mut String, props: &Props<'_>) {
            out.push_str("<b>");
            crate::escape_into(out, props.name);
            out.push_str("</b>");
        }
        let request = actix_web::test::TestRequest::default().to_http_request();
        let response =
            Html::island_owned("Name", Props { name: "<Ada>" }, render).respond_to(&request);
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers().get("content-type").unwrap(), TEXT_HTML);
        let body = to_bytes(response.into_body()).await.expect("a body");
        assert_eq!(
            body,
            r#"<div data-island="Name" data-props="{&quot;name&quot;:&quot;&lt;Ada&gt;&quot;}"><b>&lt;Ada&gt;</b></div>"#
        );

        let whole = HtmlStream::new("<p>whole</p>".to_owned()).respond_to(&request);
        assert_eq!(whole.body().size(), BodySize::Sized(12));

        let response = HtmlStream::new(two_holes())
            .holes(["a", "b"].map(|s| after(0, s)))
            .respond_to(&request);
        assert_eq!(response.headers().get("content-type").unwrap(), TEXT_HTML);
        assert_eq!(response.body().size(), BodySize::Stream);
        let body = to_bytes(response.into_body()).await.expect("a body");
        assert_eq!(
            body,
            "<h1><!--[-->a<!--]--></h1><aside><!--[-->b<!--]--></aside>"
        );
    }
}
