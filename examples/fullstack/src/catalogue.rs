use std::time::Duration;

use crate::generated::types::{Book, Review};

const BOOKS: &[(&str, &str, &str, i64)] = &[
    ("dune", "Dune", "Frank Herbert", 1965),
    ("solaris", "Solaris", "Stanisław Lem", 1961),
    (
        "left-hand",
        "The Left Hand of Darkness",
        "Ursula K. Le Guin",
        1969,
    ),
    ("ficciones", "Ficciones", "Jorge Luis Borges", 1944),
];

const REVIEWS: &[(&str, &str, i64, &str)] = &[
    ("dune", "Ada", 5, "The spice must flow."),
    ("dune", "Grace", 4, "Long, & worth every page."),
    ("dune", "Linus", 3, "Too much sand <for me>."),
    ("solaris", "Alan", 5, "An ocean that thinks back."),
    (
        "left-hand",
        "Barbara",
        5,
        "Winter, and what it does to people.",
    ),
];

fn book_of(
    &(id, title, author, year): &(&'static str, &'static str, &'static str, i64),
) -> Book<'static> {
    Book::new(id, title, author, year)
}

/// Every book, in shelf order.
pub fn books() -> Vec<Book<'static>> {
    BOOKS.iter().map(book_of).collect()
}

/// The book with this id, if the shop stocks it.
pub fn book(id: &str) -> Option<Book<'static>> {
    BOOKS.iter().find(|b| b.0 == id).map(book_of)
}

/// A book's reviews, after `delay`: the slow query a streamed page doesn't wait for.
pub async fn reviews(id: &str, delay: Duration) -> Vec<Review<'static>> {
    if !delay.is_zero() {
        tokio::time::sleep(delay).await;
    }
    REVIEWS
        .iter()
        .filter(|r| r.0 == id)
        .map(|&(_, reader, stars, text)| Review::new(reader, stars, text))
        .collect()
}
