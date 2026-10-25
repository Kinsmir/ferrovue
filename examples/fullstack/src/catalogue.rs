use std::convert::Infallible;
use std::time::Duration;

use ferrovue::js_date::JsDate;

use crate::generated::loaders::{LoadStock, LoadWarehouse, Loaders};
use crate::generated::types::{Book, Review, Stock, Warehouse};

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

const REVIEWS: &[(&str, &str, i64, &str, &str)] = &[
    (
        "dune",
        "Ada",
        5,
        "The spice must flow.",
        "2024-03-10T08:05:09Z",
    ),
    (
        "dune",
        "Grace",
        4,
        "Long, & worth every page.",
        "2023-12-31T23:30-01:00",
    ),
    ("dune", "Linus", 3, "Too much sand <for me>.", "1999-01-01"),
    (
        "solaris",
        "Alan",
        5,
        "An ocean that thinks back.",
        "2024-02-29",
    ),
    (
        "left-hand",
        "Barbara",
        5,
        "Winter, and what it does to people.",
        "2020-06-01T12:00:00+02:00",
    ),
];

const STOCK: &[(&str, i64, &str, f64)] = &[
    ("dune", 3, "leeds", 1_717_200_000_000.0),
    ("solaris", 0, "leeds", 1_717_200_000_000.0),
    ("left-hand", 1, "porto", 1_714_521_600_000.0),
    ("ficciones", 2, "porto", 1_714_521_600_000.0),
];

const WAREHOUSES: &[(&str, &str, i64)] = &[("leeds", "Leeds", 2), ("porto", "Porto", 1)];

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
        .map(|&(_, reader, stars, text, posted)| {
            Review::new(reader, stars, text).posted(JsDate::parse(posted).expect("an ISO date"))
        })
        .collect()
}

/// How many copies of a book the shop holds, and the warehouse they ship from: none of a book it
/// does not stock.
pub fn stock(id: &str) -> Stock<'static> {
    STOCK.iter().find(|s| s.0 == id).map_or(
        Stock::new(0, ""),
        |&(_, copies, warehouse, counted)| {
            Stock::new(copies, warehouse).counted(JsDate::from_millis(counted))
        },
    )
}

/// The warehouse with this code, if there is one.
pub fn warehouse(code: &str) -> Option<Warehouse<'static>> {
    WAREHOUSES
        .iter()
        .find(|w| w.0 == code)
        .map(|&(_, city, days)| Warehouse::new(city, days))
}

/// The loaders the components await, answered from the catalogue.
pub struct Catalogue;

impl Loaders for Catalogue {
    type Error = Infallible;

    async fn load_stock(&self, call: LoadStock) -> Result<Stock<'static>, Infallible> {
        Ok(stock(&call.id))
    }

    async fn load_warehouse(
        &self,
        call: LoadWarehouse,
    ) -> Result<Option<Warehouse<'static>>, Infallible> {
        Ok(warehouse(&call.code))
    }
}
