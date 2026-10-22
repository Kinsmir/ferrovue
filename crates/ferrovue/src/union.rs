use std::fmt;

/// The error of parsing a string as the enum generated for a union of string literals, when the
/// string is none of its members.
///
/// The generated enums' `FromStr` and `TryFrom<&str>` return it:
///
/// ```
/// # #[derive(Debug, PartialEq)]
/// # enum Size { Sm, Md }
/// # impl std::str::FromStr for Size {
/// #     type Err = ferrovue::ParseUnionError;
/// #     fn from_str(s: &str) -> Result<Self, Self::Err> {
/// #         match s {
/// #             "sm" => Ok(Size::Sm),
/// #             "md" => Ok(Size::Md),
/// #             _ => Err(ferrovue::ParseUnionError::new("Size", s, &["sm", "md"])),
/// #         }
/// #     }
/// # }
/// let e = "xl".parse::<Size>().unwrap_err();
/// assert_eq!(e.value(), "xl");
/// assert_eq!(e.members(), ["sm", "md"]);
/// assert_eq!(e.to_string(), "`xl` is not one of the members of `Size`: `sm`, `md`");
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseUnionError {
    union: &'static str,
    value: String,
    members: &'static [&'static str],
}

impl ParseUnionError {
    #[doc(hidden)]
    #[must_use]
    pub fn new(union: &'static str, value: &str, members: &'static [&'static str]) -> Self {
        ParseUnionError {
            union,
            value: value.to_owned(),
            members,
        }
    }

    /// The name of the enum.
    #[must_use]
    pub fn union(&self) -> &'static str {
        self.union
    }

    /// The string that is none of the members.
    #[must_use]
    pub fn value(&self) -> &str {
        &self.value
    }

    /// The members of the union, in the order it declares them.
    #[must_use]
    pub fn members(&self) -> &'static [&'static str] {
        self.members
    }
}

impl fmt::Display for ParseUnionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "`{}` is not one of the members of `{}`: ",
            self.value, self.union
        )?;
        for (i, m) in self.members.iter().enumerate() {
            if i > 0 {
                f.write_str(", ")?;
            }
            write!(f, "`{m}`")?;
        }
        Ok(())
    }
}

impl std::error::Error for ParseUnionError {}
