#![allow(dead_code)]

mod domain {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Tone {
        Warm,
    }

    impl ferrovue::props::Union for Tone {
        const ALL: &'static [Self] = &[Tone::Warm];

        fn as_str(self) -> &'static str {
            "warm"
        }
    }
}

#[rustfmt::skip]
#[path = "../../src/generated/toned.rs"]
mod toned;

fn main() {}
