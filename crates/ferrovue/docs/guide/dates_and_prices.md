Dates and prices: what a template may compute itself, and the pattern for everything that depends
on a locale or a time zone.

A page is rendered twice: once by the server, and again by the reader's browser as it hydrates.
Both must write the same text. That rules out two things JavaScript does with dates and numbers:

- **The time zone.** `new Date("2024-05-01T09:30")`, `.getHours()` and `.toString()` read the time
  zone of the machine running them, and the server's is not the reader's.
- **The locale.** `Intl.NumberFormat`, `Intl.DateTimeFormat`, `.toLocaleString()` and vue-i18n's
  `$d` and `$n` format from locale data each JavaScript engine ships. Node, Chromium, Firefox and
  Safari carry different versions of it, and they write some dates, times and numbers differently:
  a narrow no-break space before "AM" in one and a plain space in another, other abbreviations,
  other separators. No server can write what every reader's browser writes.

So ferrovue supports the part of `Date` that depends on neither, exactly, and refuses the rest
with an error that points here. For a formatted date or price, the value is formatted once, in Rust,
and handed to the component as a string, or written into a translated message.

# Dates in a template

A date is built from an ISO string or a number of milliseconds, and read with the methods that
work in UTC:

| Template | Rust | Gives |
|---|---|---|
| `new Date(s)`, `Date.parse(s)` | `js_date_parse` | the time value of an ISO string (below) |
| `new Date(ms)` | `js_time_clip` | `ms` truncated, or an invalid date beyond ±8.64 × 10¹⁵ |
| `new Date(d)` | the same time value | a copy of the date `d` |
| `d.toISOString()` | `js_to_iso_string` | `2024-05-01T09:30:00.000Z`; `+275760-09-13T00:00:00.000Z` outside the years 0000 to 9999 |
| `d.getTime()`, `d.valueOf()` | the time value | milliseconds since 1970, or `NaN` |
| `d.getUTCFullYear()` | `js_utc_full_year` | the year, negative before year 0 |
| `d.getUTCMonth()` | `js_utc_month` | 0 for January to 11 |
| `d.getUTCDate()` | `js_utc_date` | the day of the month, from 1 |
| `d.getUTCDay()` | `js_utc_day` | 0 for Sunday to 6 |
| `d.getUTCHours()`, `getUTCMinutes()`, `getUTCSeconds()`, `getUTCMilliseconds()` | `js_utc_hours` and the rest | the time of day in UTC |

A date can be held in a `computed`, chosen with `?:`, and built inside a `v-for`. It cannot be
interpolated or bound whole (Vue would write its `.toString()`, in the server's time zone), compared
with `===` or `<`, or passed as a prop: read `.toISOString()` or `.getTime()` from it.

```vue
<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ published: string }>();
const date = computed(() => new Date(props.published));
</script>

<template>
  <time :datetime="date.toISOString()">
    {{ date.getUTCDate() }}/{{ date.getUTCMonth() + 1 }}/{{ date.getUTCFullYear() }}
  </time>
</template>
```

Each of these is held to vectors recorded from Node (`tests/vectors/dates.json`: thousands of
strings and time values, drawn at random beside the edge cases), and the strings and numbers it
accepts are read alike by Chromium and Firefox in four time zones, from UTC−3:30 to UTC+14.

## The strings a date is built from

ECMAScript specifies how one format is read, its date time string format, and leaves every other
string to each engine. ferrovue accepts the part of that format whose reading does not depend on
the time zone:

- a date alone: `2024-05-01`, `2024-05` or `2024`, read as midnight UTC;
- a date and a time with a `Z` or an offset: `2024-05-01T09:30Z`, `2024-05-01T09:30:15Z`,
  `2024-05-01T09:30:15.250+02:00`;
- a year of four digits, or of six with a sign (`+010000`, `-000001`), as `.toISOString()` writes
  it;
- fields within their ranges: a month from 01 to 12, a day that the month has, hours to 23,
  minutes and seconds to 59, milliseconds as three digits;
- with an offset, a date and time whose fields, read as UTC, lie within ±8.64 × 10¹⁵ ms of 1970,
  or one the offset leaves beyond it, which is an invalid date everywhere.

Everything else is refused, because browsers would not agree on it: a date and time with no `Z` or
offset (read in local time), `2024-02-30` (which V8 and Firefox read as 1 March), `2024-01-00`
(which Firefox reads as 31 December, V8 as invalid), a lowercase `t` or `z`, a space for the `T`,
`T24:00`, one or two fractional digits, `"May 1, 2024"`, an empty string, `-000000`, and a date
and time at the edge of the range whose offset brings it inside (`+275760-09-13T01:00+01:00`,
which Safari reads as invalid and the other engines as the last valid moment). A string
literal in the template is checked when the component is compiled
([FV1803](crate::guide::error_codes#fv1803)). A string from the props is checked as it renders, and
`js_date_parse` panics on one outside the format, since the server cannot
know what the reader's browser would make of it. Hand components strings the format holds:

```rust
// The ISO string of a number of milliseconds, as JavaScript's `toISOString()` writes it.
assert_eq!(ferrovue::js_to_iso_string(1_714_555_800_000.0), "2024-05-01T09:30:00.000Z");
```

From `chrono`, `to_rfc3339_opts(SecondsFormat::Millis, true)` writes the format. Take care with
other RFC 3339 writers: RFC 3339 allows any number of fractional digits, and the format takes
exactly three. Simpler still, a `number` prop of milliseconds (`new Date(props.ms)`) needs no
string at all.

## Invalid dates

A date beyond ±8.64 × 10¹⁵ ms from 1970 (about 275,000 years) is invalid, as in JavaScript:
`.getTime()` and every `.getUTC…()` method give `NaN`, and `.toISOString()` throws a `RangeError`,
on which the generated code panics. Test a date that may be invalid before writing it, with
`d.getTime() === d.getTime()` (false only for `NaN`). A `computed` is worked out once before the
render in Rust, where Vue works it out when the template first reads it, so call `.toISOString()`
of a date that may be invalid in the template, under the `v-if` that tests it.

## The current time

`new Date()` and `Date.now()` are the moment they run, which differs between the server's render
and the browser's hydration, so they are refused ([FV1801](crate::guide::error_codes#fv1801)).
Read the clock in Rust and pass the time as a prop:

```rust
use std::time::{SystemTime, UNIX_EPOCH};

let now = SystemTime::now().duration_since(UNIX_EPOCH).expect("after 1970").as_millis() as i64;
let iso = ferrovue::js_to_iso_string(now as f64);
assert!(iso.ends_with('Z'));
```

# Prices and formatted dates

A price is written in the reader's locale (`€1,299.50` in English, `€ 1.299,50` in Dutch), and a
date with the month's name. Both depend on the locale, so the component receives them written.
There are two ways, which work together.

## Format in Rust, pass a string

The server formats the value with whatever Rust library suits it (`icu`, `num-format`, `chrono`,
`time`, or a few lines of your own) and passes the result as a `string` prop. The island's props
carry the same string to the browser, which writes it unchanged as it hydrates, so the reader sees
exactly the server's formatting:

```rust
fn euros(cents: i64, locale: &str) -> String {
    let (sign, cents) = if cents < 0 { ("-", -cents) } else { ("", cents) };
    let whole = (cents / 100).to_string();
    let (group, decimal) = if locale == "nl" { ('.', ',') } else { (',', '.') };
    let mut grouped = String::new();
    for (i, digit) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i) % 3 == 0 {
            grouped.push(group);
        }
        grouped.push(digit);
    }
    let amount = format!("{grouped}{decimal}{:02}", cents % 100);
    if locale == "nl" { format!("€ {sign}{amount}") } else { format!("{sign}€{amount}") }
}

assert_eq!(euros(129_950, "en"), "€1,299.50");
assert_eq!(euros(129_950, "nl"), "€ 1.299,50");
assert_eq!(euros(5, "nl"), "€ 0,05");
```

## Translate with vue-i18n

A message holds the words and the order of a locale, and the template fills it with a value it
computes without a locale: `.toFixed()` for an amount, `.toISOString()` for a date. ferrovue renders
`$t` as vue-i18n does ([`i18n`](crate::guide::i18n)).

```json
{ "price": "€{amount}", "posted": "Posted on {date}" }
```

```json
{ "price": "€ {amount}", "posted": "Geplaatst op {date}" }
```

## End to end

This component, from the conformance suite (`Prices.vue`), shows a price formatted in Rust beside
one computed in the template and translated, and a date both ways:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ cents: number; total: string; posted: string }>();
const { t, locale } = useI18n();
const fixed = computed(() => (props.cents / 100).toFixed(2));
const amount = computed(() => (locale.value === "nl" ? fixed.value.replace(".", ",") : fixed.value));
</script>

<template>
  <section :lang="locale">
    <p>{{ t("price", { amount }) }}</p>
    <p>{{ total }}</p>
    <p>{{ $t("posted", { date: new Date(posted).toISOString().slice(0, 10) }) }}</p>
    <time :datetime="new Date(posted).toISOString()">{{ new Date(posted).getUTCDate() }}-{{ new Date(posted).getUTCMonth() + 1 }}-{{ new Date(posted).getUTCFullYear() }}</time>
  </section>
</template>
```

The generated `render` computes the amount and the date with the runtime's twins of `toFixed`,
`replace` and `Date`, and the server builds the props with its own formatting:

```rust
# #[cfg(feature = "i18n")]
# mod generated {
# pub mod i18n {
# use ferrovue::i18n::{Locale, Message, Part};
# pub const LOCALE: &str = "en";
# pub const FALLBACK: &[&str] = &["en"];
# pub static LOCALES: &[Locale] = &[
#     Locale {
#         name: "en",
#         messages: &[
#             ("posted", Message { cases: &[&[Part::Text("Posted on "), Part::Named("date")]] }),
#             ("price", Message { cases: &[&[Part::Text("€"), Part::Named("amount")]] }),
#         ],
#     },
#     Locale {
#         name: "nl",
#         messages: &[
#             ("posted", Message { cases: &[&[Part::Text("Geplaatst op "), Part::Named("date")]] }),
#             ("price", Message { cases: &[&[Part::Text("€ "), Part::Named("amount")]] }),
#         ],
#     },
# ];
# pub fn i18n(locale: &str) -> ferrovue::I18n {
#     ferrovue::I18n::new(LOCALES, locale, FALLBACK)
# }
# }
# pub mod prices {
# // @generated by ferrovue from components/Prices.vue. Do not edit: change the `.vue` file and run
# // `ferrovue`.
#
# use std::borrow::Cow;
#
# use ferrovue as fv;
#
# /// The component's name, as `data-island` carries it.
# pub const NAME: &str = "Prices";
#
# /// The props `Prices.vue` declares.
# #[derive(Debug, Clone, serde::Serialize)]
# #[cfg_attr(test, derive(serde::Deserialize))]
# pub struct Props<'a> {
#     #[serde(rename = "cents")]
#     pub cents: i64,
#     #[serde(rename = "total")]
#     pub total: Cow<'a, str>,
#     #[serde(rename = "posted")]
#     pub posted: Cow<'a, str>,
# }
#
# impl<'a> Props<'a> {
#     /// Props with its required fields.
#     pub fn new(cents: i64, total: impl Into<Cow<'a, str>>, posted: impl Into<Cow<'a, str>>) -> Self {
#         Props { cents, total: total.into(), posted: posted.into() }
#     }
#
# }
/// Write the component's server render into `out`.
pub fn render(out: &mut String, props: &Props<'_>, fv_i18n: &fv::I18n) {
    out.reserve(98 + props.total.len() + props.posted.len());
    let s_fixed = fv::js_to_fixed(props.cents as f64 / 100.0, 2);
    let s_amount = if fv_i18n.locale() == "nl" { std::borrow::Cow::<str>::Owned(fv::js_replace(&s_fixed, ".", ",").into_owned()) } else { std::borrow::Cow::<str>::Borrowed(&*s_fixed) };
    out.push_str("<section");
    if fv_i18n.locale().is_empty() {
        out.push_str(" lang");
    } else {
        out.push_str(" lang=\"");
        fv::escape_into(out, fv_i18n.locale());
        out.push('"');
    }
    out.push_str("><p>");
    fv::escape_into(out, &fv_i18n.t("price", &fv::i18n::Args { named: &[("amount", fv::i18n::Value::Str(&s_amount))], list: &[], plural: None }));
    out.push_str("</p><p>");
    fv::escape_into(out, &props.total);
    out.push_str("</p><p>");
    fv::escape_into(out, &fv_i18n.t("posted", &fv::i18n::Args { named: &[("date", fv::i18n::Value::Str(&fv::js_slice(&fv::js_to_iso_string(fv::js_date_parse(&props.posted)), 0.0f64, Some(10.0f64))))], list: &[], plural: None }));
    out.push_str("</p><time datetime=\"");
    fv::escape_into(out, &fv::js_to_iso_string(fv::js_date_parse(&props.posted)));
    out.push_str("\">");
    fv::push_number(out, fv::js_utc_date(fv::js_date_parse(&props.posted)));
    out.push('-');
    fv::push_number(out, fv::js_utc_month(fv::js_date_parse(&props.posted)) + 1.0);
    out.push('-');
    fv::push_number(out, fv::js_utc_full_year(fv::js_date_parse(&props.posted)));
    out.push_str("</time></section>");
}
# } }
# fn euros(cents: i64, locale: &str) -> String {
#     let (sign, cents) = if cents < 0 { ("-", -cents) } else { ("", cents) };
#     let whole = (cents / 100).to_string();
#     let (group, decimal) = if locale == "nl" { ('.', ',') } else { (',', '.') };
#     let mut grouped = String::new();
#     for (i, digit) in whole.chars().enumerate() {
#         if i > 0 && (whole.len() - i) % 3 == 0 {
#             grouped.push(group);
#         }
#         grouped.push(digit);
#     }
#     let amount = format!("{grouped}{decimal}{:02}", cents % 100);
#     if locale == "nl" { format!("€ {sign}{amount}") } else { format!("{sign}€{amount}") }
# }
# #[cfg(not(feature = "i18n"))]
# fn main() {}
# #[cfg(feature = "i18n")]
# fn main() {
# use generated::{i18n, prices};
let props = prices::Props::new(129_950, euros(129_950, "nl"), "2024-05-01T23:30:00.000-02:00");

let mut out = String::new();
prices::render(&mut out, &props, &i18n::i18n("nl"));
assert_eq!(
    out,
    r#"<section lang="nl"><p>€ 1299,50</p><p>€ 1.299,50</p><p>Geplaatst op 2024-05-02</p><time datetime="2024-05-02T01:30:00.000Z">2-5-2024</time></section>"#
);
# }
```

The browser hydrates the same text: `total` reaches it in the island's props as the string the
server wrote, and the rest it computes as the server did.

# What stays refused

- [FV1801](crate::guide::error_codes#fv1801): `new Date()` and `Date.now()`, the current time;
- [FV1802](crate::guide::error_codes#fv1802): `new Date(year, month, …)`, which reads its parts in
  local time, and `new Date()` or `Date.parse()` of a value that may be absent, a boolean or
  anything but one string or number;
- [FV1803](crate::guide::error_codes#fv1803): a date literal outside the format above;
- [FV1804](crate::guide::error_codes#fv1804): the local getters (`.getFullYear()`, `.getHours()`)
  with the UTC one to use instead, `.getTimezoneOffset()`, `.toString()`, `.toUTCString()`,
  `.toJSON()`, the setters, and `Date.UTC()`;
- [FV1805](crate::guide::error_codes#fv1805), permanently: `Intl` in any form,
  `.toLocaleString()`, `.toLocaleDateString()`, `.toLocaleTimeString()`, `.localeCompare()`, and
  vue-i18n's `$d` and `$n` (`d` and `n` from `useI18n()`). `.toLocaleUpperCase()` and
  `.toLocaleLowerCase()` are refused for the same reason
  ([FV0715](crate::guide::error_codes#fv0715)).
