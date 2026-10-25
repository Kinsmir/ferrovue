use ferrovue::Union;

/// `Tone` as the application keeps it, which `unions` in ferrovue.config.json names for
/// `Toned.vue`'s `type Tone`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Warm,
    XCool,
}

impl Union for Tone {
    const ALL: &'static [Self] = &[Tone::Warm, Tone::XCool];

    fn as_str(self) -> &'static str {
        match self {
            Tone::Warm => "warm",
            Tone::XCool => "x-cool",
        }
    }
}
