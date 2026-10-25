#![allow(dead_code)]

mod domain {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Tone {
        Warm,
        XCool,
        Hot,
    }

    impl ferrovue::union::Union for Tone {
        const ALL: &'static [Self] = &[Tone::Warm, Tone::XCool, Tone::Hot];

        fn as_str(self) -> &'static str {
            match self {
                Tone::Warm => "warm",
                Tone::XCool => "x-cool",
                Tone::Hot => "hot",
            }
        }
    }
}

#[rustfmt::skip]
#[path = "../../src/generated/toned.rs"]
mod toned;

fn main() {}
