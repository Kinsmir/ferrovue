use std::cell::Cell;
use std::fmt;

use crate::js_date::JsTime;

/// A render that cannot write what Vue's `renderToString` writes for these props: a date string
/// browsers read differently, an integer beyond the range of `i64` where the template needs one,
/// a string longer than JavaScript allows. A generated `try_render` returns it, so a server can
/// answer `400 Bad Request`; `render` panics with its message.
///
/// It carries the error code, the component and the place in its file where the template asks for
/// the value, and a message saying what was refused and what to do.
/// [`errors_and_limits`](crate::guide::errors_and_limits#refused-at-render-time) shows a handler
/// answering with it.
///
/// # Example
///
/// ```
/// # mod published {
/// #     use ferrovue as fv;
/// #     pub const NAME: &str = "Published";
/// #     pub struct Props<'a> { pub on: &'a str }
/// #     pub fn render(out: &mut String, props: &Props<'_>) {
/// #         fv::refused::rendered(try_render(out, props));
/// #     }
/// #     pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::refused::Refused> {
/// #         let fv_refusals = fv::refused::Refusals::new(NAME, "components/Published.vue");
/// #         out.push_str("<time>");
/// #         fv::core::escape::escape_into(out, &fv_refusals.keep(fv::dates::try_to_iso_string(fv_refusals.keep(fv::dates::try_date_parse(props.on), 3, 25)), 3, 9));
/// #         out.push_str("</time>");
/// #         fv_refusals.check(Ok(()))
/// #     }
/// # }
/// // Published.vue: <time>{{ new Date(on).toISOString() }}</time>
/// let mut out = String::new();
/// published::try_render(&mut out, &published::Props { on: "2024-05-01" })?;
/// assert_eq!(out, "<time>2024-05-01T00:00:00.000Z</time>");
///
/// let refused = published::try_render(&mut String::new(), &published::Props { on: "May 1" })
///     .unwrap_err();
/// assert_eq!(refused.code(), "FV1803");
/// assert_eq!(refused.component(), Some("Published"));
/// assert_eq!(refused.file(), Some("components/Published.vue"));
/// assert_eq!((refused.line(), refused.column()), (Some(3), Some(25)));
/// assert!(refused.to_string().starts_with("error[FV1803]: components/Published.vue:3:25: "));
/// # Ok::<(), ferrovue::refused::Refused>(())
/// ```
#[non_exhaustive]
#[derive(Clone)]
pub struct Refused(Box<Inner>);

#[derive(Debug, Clone)]
struct Inner {
    code: &'static str,
    message: String,
    component: Option<&'static str>,
    file: Option<&'static str>,
    line: u32,
    column: u32,
    seq: u64,
}

thread_local! {
    static SEQ: Cell<u64> = const { Cell::new(0) };
}

impl Refused {
    /// A refusal with its error code and message, not yet located. For the runtime and generated
    /// code.
    #[doc(hidden)]
    #[must_use]
    #[cold]
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        let seq = SEQ.with(|s| {
            let n = s.get().wrapping_add(1);
            s.set(n);
            n
        });
        Refused(Box::new(Inner {
            code,
            message: message.into(),
            component: None,
            file: None,
            line: 0,
            column: 0,
            seq,
        }))
    }

    /// The error code, such as `"FV1803"`, which
    /// [`error_codes`](crate::guide::error_codes) explains.
    #[must_use]
    pub fn code(&self) -> &'static str {
        self.0.code
    }

    /// What was refused, and what to do.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.0.message
    }

    /// The name of the component whose template asks for the value, as its `NAME` holds it.
    #[must_use]
    pub fn component(&self) -> Option<&'static str> {
        self.0.component
    }

    /// The component's file, as the compiler named it.
    #[must_use]
    pub fn file(&self) -> Option<&'static str> {
        self.0.file
    }

    /// The line of the file where the template or the script asks for the value, from 1.
    #[must_use]
    pub fn line(&self) -> Option<u32> {
        (self.0.line > 0).then_some(self.0.line)
    }

    /// The column of that line, from 1.
    #[must_use]
    pub fn column(&self) -> Option<u32> {
        (self.0.line > 0 && self.0.column > 0).then_some(self.0.column)
    }

    #[cold]
    fn located(
        mut self,
        component: &'static str,
        file: &'static str,
        line: u32,
        column: u32,
    ) -> Self {
        if self.0.component.is_none() {
            self.0.component = Some(component);
            self.0.file = Some(file);
            self.0.line = line;
            self.0.column = column;
        }
        self
    }
}

impl fmt::Display for Refused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "error[{}]: ", self.0.code)?;
        if let Some(file) = self.0.file {
            f.write_str(file)?;
            if let Some(line) = self.line() {
                write!(f, ":{line}")?;
                if let Some(column) = self.column() {
                    write!(f, ":{column}")?;
                }
            }
            f.write_str(": ")?;
        }
        f.write_str(&self.0.message)
    }
}

impl fmt::Debug for Refused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Refused")
            .field("code", &self.0.code)
            .field("message", &self.0.message)
            .field("component", &self.0.component)
            .field("file", &self.0.file)
            .field("line", &self.line())
            .field("column", &self.column())
            .finish()
    }
}

impl std::error::Error for Refused {}

/// The refusals of one component's render: the first in the order the render met them, which
/// it returns. Generated code keeps each fallible value with [`keep`](Self::keep), where a
/// refusal is held and the render goes on with a placeholder, and returns with
/// [`check`](Self::check).
#[doc(hidden)]
pub struct Refusals {
    first: Cell<Option<Refused>>,
    component: &'static str,
    file: &'static str,
}

impl Refusals {
    /// No refusal yet, in the component called `component`, written in `file`.
    #[must_use]
    #[inline]
    pub const fn new(component: &'static str, file: &'static str) -> Self {
        Refusals {
            first: Cell::new(None),
            component,
            file,
        }
    }

    /// The value, or its type's default once the refusal, located at `line` and `column` of the
    /// component's file, is held.
    #[inline]
    pub fn keep<T: Default>(&self, value: Result<T, Refused>, line: u32, column: u32) -> T {
        match value {
            Ok(v) => v,
            Err(refused) => {
                self.hold(refused.located(self.component, self.file, line, column));
                T::default()
            }
        }
    }

    /// The date `t` as a child's `Date` prop of type `T`, or the epoch once the refusal is held
    /// where `T` cannot hold `t`.
    ///
    /// # Panics
    ///
    /// With the refusal's message where `T` cannot hold the epoch either.
    #[inline]
    pub fn date<T: JsTime>(&self, t: f64, line: u32, column: u32) -> T {
        if let Some(date) = T::from_time_value(t) {
            return date;
        }
        let refused =
            crate::js_date::date_refused(t).located(self.component, self.file, line, column);
        let Some(epoch) = T::from_time_value(0.0) else {
            panic!("{refused}");
        };
        self.hold(refused);
        epoch
    }

    /// Hold what a child's render returned.
    #[inline]
    pub fn join(&self, rendered: Result<(), Refused>) {
        if let Err(refused) = rendered {
            self.hold(refused);
        }
    }

    /// The first refusal, of those held and `rendered`'s; `rendered` when none is held.
    #[inline]
    pub fn check(&self, rendered: Result<(), Refused>) -> Result<(), Refused> {
        first(self.first.take(), rendered)
    }

    #[cold]
    fn hold(&self, refused: Refused) {
        let held = self.first.take();
        self.first.set(first(held, Err(refused)).err());
    }
}

pub(crate) fn first(held: Option<Refused>, rendered: Result<(), Refused>) -> Result<(), Refused> {
    match (held, rendered) {
        (None, rendered) => rendered,
        (Some(held), Err(other)) if other.0.seq < held.0.seq => Err(other),
        (Some(held), _) => Err(held),
    }
}

impl fmt::Debug for Refusals {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Refusals")
            .field("component", &self.component)
            .field("file", &self.file)
            .finish_non_exhaustive()
    }
}

/// What a generated `render` does with its `try_render`: nothing when it rendered.
///
/// # Panics
///
/// With the refusal's message.
#[doc(hidden)]
#[inline]
#[track_caller]
pub fn rendered(result: Result<(), Refused>) {
    if let Err(refused) = result {
        refuse(&refused);
    }
}

#[cold]
#[inline(never)]
#[track_caller]
fn refuse(refused: &Refused) -> ! {
    panic!("{refused}")
}

const I64_LIMIT: f64 = 9_223_372_036_854_775_808.0;

/// An integer the template computed as JavaScript does, as a double, held as the `i64` a child's
/// `number` prop, an index or a range needs.
///
/// # Errors
///
/// FV0724 where `x` is not an integer within the range of `i64`, which the `i64` cannot hold.
#[doc(hidden)]
#[inline]
pub fn try_int(x: f64) -> Result<i64, Refused> {
    if (-I64_LIMIT..I64_LIMIT).contains(&x) && x.fract() == 0.0 {
        Ok(x as i64)
    } else {
        Err(int_refused(x))
    }
}

#[cold]
fn int_refused(x: f64) -> Refused {
    let mut shown = String::new();
    ferrovue_core::numbers::push_number(&mut shown, x);
    Refused::new(
        "FV0724",
        format!(
            "the number {shown} is beyond the range of i64, where the template needs an integer (a \
             child's `number` prop, an index or a range): check the props before rendering and keep \
             them within ±2⁵³, where JavaScript's integers are exact, or type the child's prop \
             `Float`"
        ),
    )
}

#[cfg(test)]
mod tests;
