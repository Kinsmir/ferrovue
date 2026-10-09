//! The contract between ferrovue's compiler and the Rust an application writes against what it
//! generates. The components in `components/` and `pages/` generate every item the generated-code
//! guide documents as stable, and the tests use each of them as an application would: a change to
//! the compiler that breaks this crate breaks that contract.

#[rustfmt::skip]
mod generated;

mod twins;

#[cfg(test)]
mod tests;
