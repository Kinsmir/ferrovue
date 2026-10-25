JavaScript's numbers, in Rust.

JavaScript has one number type, a double. Vue writes numbers as JavaScript's `String(n)` writes
them and computes as JavaScript computes, so the generated Rust has to as well, or the page would
not hydrate.

# Two Rust types for one JavaScript type

| Declared as | Rust type | For |
|---|---|---|
| `number` | `i64` | Counts, ids, indexes: most numeric props |
| `Float`, from `ferrovue/types` | `f64` | Anything that may hold a fraction: prices, ratios |

```ts
import type { Float } from "ferrovue/types";
defineProps<{ qty: number; price: Float }>();
```

In the browser both are plain numbers; `Float` is only `number` under another name, which tells the
compiler to use `f64`.

# How numbers are written

- An integer is written by [`push_int`](crate::core::push_int): its decimal digits, exactly, within
  ±(2⁵³ − 1). Beyond that, a JavaScript number has already lost precision (the browser rounds the
  value it reads from an island's props), so it is written as JavaScript writes the rounded number.
- A fraction is written by [`push_number`](crate::core::push_number), which is
  `Number.prototype.toString`: the shortest digits that read back as the same double, laid out as
  ECMAScript lays them out: `0.30000000000000004`, `1e+21`, `1.5e-7`, `NaN`, `-Infinity`, and `0`
  for `-0`.
- In a template literal or a string `+`, a number goes through [`Js`](crate::core::Js), whose `Display`
  writes it the same way.

```rust
use ferrovue::core::{Js, push_int, push_number};

let mut out = String::new();
push_int(&mut out, 9_007_199_254_740_993); // 2⁵³ + 1: JavaScript holds 2⁵³
out.push(' ');
push_number(&mut out, 0.1 + 0.2);
out.push(' ');
push_number(&mut out, 1e21);
assert_eq!(out, "9007199254740992 0.30000000000000004 1e+21");

// `${qty} × ${price}`
assert_eq!(format!("{} × {}", Js(3_i64), Js(2.5_f64)), "3 × 2.5");
```

# How numbers are computed

Every operation is done on doubles, as JavaScript does it. Arithmetic between two integers casts
both to `f64` and operates. Where the result is written into the page (text, an attribute, a style,
a template literal, `String()`, `JSON.stringify()`), it is written from the `f64` as JavaScript
writes it, so `n * n` of a large `n` reads `16000000000000000000` or `8.112963841460666e+31`, as
Vue's does. This is from the generated code of a component reading `counter.doubled`, a Pinia
getter that is `count * 2`:

```rust
# use ferrovue as fv;
# struct CounterState { count: i64 }
# struct Stores { counter: CounterState }
# let fv_stores = Stores { counter: CounterState { count: 21 } };
# let mut buf = String::new();
# let out = &mut buf;
fv::core::push_number(out, fv_stores.counter.count as f64 * 2.0);
# assert_eq!(buf, "42");
```

A literal is written as a double where it meets one (`2.0`), and arithmetic between literals alone
is done by the compiler.

Some operations always give a `Float`, because they do in JavaScript:

- `/`, even between two integers: `qty / 4` is `0.75` for 3, and `qty / 0` is `Infinity`;
- `%` by anything but a non-zero integer literal, since `n % 0` is `NaN`;
- `+`, `-`, `*` with a `Float` on either side.

Comparisons are made between doubles too, and a number is falsy when it is `0` (or, for a `Float`,
`NaN`), as in JavaScript.

`Math`, `toFixed`, `toPrecision` and `toExponential` have twins where Rust's own functions differ
from JavaScript's:

| JavaScript | Rust | Why not the standard method |
|---|---|---|
| `Math.round(x)` | [`js_round`](crate::core::js_round) | A half rounds toward +∞: `-2.5` to `-2`, where `f64::round` gives `-3`; and from `-0.5` up to zero the result is `-0`, which `1 / Math.round(x)` shows (`-Infinity`) |
| `Math.max(a, b)`, `Math.min(a, b)` | [`js_max`](crate::core::js_max), [`js_min`](crate::core::js_min) | `NaN` if either is, where `f64::max` ignores a `NaN` |
| `x.toFixed(d)` | [`js_to_fixed`](crate::core::js_to_fixed) | An exact tie rounds away from zero, where Rust's formatting rounds to even |
| `x.toPrecision(p)` | [`js_to_precision`](crate::core::js_to_precision) | The same ties, and JavaScript's choice of an exponent (`1.2e+5`) below 10⁻⁶ and from 10ᵖ up; `x.toPrecision()` is `String(x)` |
| `x.toExponential(f)`, `x.toExponential()` | [`js_to_exponential`](crate::core::js_to_exponential) | The same ties, and JavaScript's exponent, `e+5` where Rust writes `e5`; without an argument, the digits `String(x)` writes |
| `Math.floor`, `Math.ceil`, `Math.trunc`, `Math.abs` | `f64::floor`, `ceil`, `trunc`, `abs` | They agree |
| `Math.sqrt(x)` | `f64::sqrt` | They agree: IEEE 754 rounds a square root correctly, in every engine and in Rust |
| `Math.sign(x)` | [`js_sign`](crate::core::js_sign) | `0`, `-0` and `NaN` are their own sign, where `f64::signum` gives 1 for `0` |
| `Math.PI`, `Math.E`, `Math.LN2`, `Math.LN10`, `Math.LOG2E`, `Math.LOG10E`, `Math.SQRT2`, `Math.SQRT1_2`, and `Number.EPSILON`, `MAX_SAFE_INTEGER`, `MIN_SAFE_INTEGER`, `MAX_VALUE`, `MIN_VALUE`, `POSITIVE_INFINITY`, `NEGATIVE_INFINITY`, `NaN` | the same doubles, as literals | They are constants |
| `a ** b`, `Math.pow(a, b)` | worked out when compiling | See below |
| `s.length` | `js_length` | UTF-16 code units, as JavaScript counts them. See [`strings`](crate::guide::strings) |
| `Number(s)`, `parseInt(s)`, `parseFloat(s)` | `js_number`, `js_parse_int`, `js_parse_float` | JavaScript's grammar for numbers, which differs from Rust's `parse`. See [`strings`](crate::guide::strings) |
| `Number.isNaN(x)`, `isNaN(x)` | `f64::is_nan` | They agree |
| `Number.isFinite(x)`, `isFinite(x)` | `f64::is_finite` | They agree |
| `Number.isInteger(x)` | `x.fract() == 0.0` | Rust has no method of its own; `-0` is an integer, `NaN` and the infinities are not |
| `Number.isSafeInteger(x)` | `x.fract() == 0.0 && x.abs() <= 9_007_199_254_740_991.0` | An integer within ±(2⁵³ − 1) |

A `number` prop holds an integer, which is never `NaN` nor infinite, so the compiler writes
`Number.isNaN(n)` as `false` and `Number.isFinite(n)` as `true`, and `Number.isSafeInteger(n)`
compares the `i64` with 2⁵³ − 1. Of an optional number, each test is `false` when the number is
absent, as in JavaScript. The four `Number` tests do not convert their argument: of a string, a
boolean or a `Date` each is always `false`, which is refused as a mistake
([FV0718](crate::guide::error_codes#fv0718)): write `Number.isNaN(Number(s))` for a string and
`Number.isNaN(d.getTime())` for a date. The global `isNaN()` and `isFinite()` convert theirs as
`Number()` does, and are accepted of a present number, where they agree with `Number.isNaN()` and
`Number.isFinite()`.

```rust
assert_eq!(ferrovue::core::js_round(-2.5), -2.0);
assert_eq!(1.0 / ferrovue::core::js_round(-0.4), f64::NEG_INFINITY); // Math.round(-0.4) is -0
assert!(ferrovue::core::js_max(1.0, f64::NAN).is_nan());
assert!(ferrovue::core::js_sign(-0.0).is_sign_negative()); // Math.sign(-0) is -0
assert_eq!(ferrovue::core::js_to_fixed(1.005, 2), "1.00"); // 1.005 is 1.00499999999999989… as a double
assert_eq!(ferrovue::core::js_to_fixed(2.5, 0), "3");      // a true tie: away from zero
assert_eq!(ferrovue::core::js_to_precision(0.125, 2), "0.13");
assert_eq!(ferrovue::core::js_to_precision(123_456.0, 3), "1.23e+5");
assert_eq!(ferrovue::core::js_to_exponential(1.5e-7, None), "1.5e-7");
```

Their argument is a number literal, or none: from 0 to 100 digits for `toFixed` and
`toExponential`, a precision from 1 to 100 for `toPrecision`, a fraction truncated as JavaScript
truncates it (`toPrecision(2.9)` is `toPrecision(2)`). Any other argument, which JavaScript may
answer with a `RangeError`, is refused when the component is compiled (`FV0705`, `FV0716`,
`FV0717`).

`Math.sqrt`, `Math.sign` and the constants are held to `math.json`, recorded from Node and computed
alike by Chromium and Firefox. The other functions of `Math`, `Math.cbrt`, `Math.hypot`,
`Math.exp`, `Math.log`, the trigonometric functions and their kin, are computed by each engine's
own routine, which the specification leaves free to round in its own way, so the page could show
digits the browser's render does not: they are refused
([FV0719](crate::guide::error_codes#fv0719)). Compute such a value in Rust and pass it as a prop.

Powers are worked out when compiling, of an integer and a whole exponent from 0 that are both
known, whose result is within ±2⁵³: `2 ** 10`, `Math.pow(-3, 3)`, `n * 2 ** 8`. Every engine gives
those exactly, as `math.json`'s 776 powers recorded from Node, Chromium and Firefox show. Any other
power is refused ([FV0720](crate::guide::error_codes#fv0720)): engines compute them by different
routines, and Node 22's V8 writes `10 ** -20` as `1.0000000000000001e-20` where Node 24 and Firefox
write `1e-20`.

# Keeping islands exact

An island's props travel as JSON, which has no words for some numbers JavaScript has:

- an `f64` that is `NaN` or infinite is written as JavaScript writes it, the bare token `NaN`,
  `Infinity` or `-Infinity`, wherever it is: a prop, an item of a list, a field of an object, a
  value of a `Record`. `serde_json` alone would write `null`, and the client would render something
  other than what the server did (an empty string for the server's `NaN`) with nothing to say so.
  `mountIslands` from `ferrovue` reads the tokens back as the numbers they stand for, so a
  `Float` prop that is `NaN` hydrates as `NaN`. The stores' state in
  [`state_script_into`](crate::page::state_script_into) is written the same way and read back by
  `hydrateState`. Everything else is exactly what `serde_json` writes;
- an `i64` beyond ±2⁵³ is rounded by the browser. The server writes the rounded value too, so the
  page still hydrates, but the client holds the rounded number, as it would with any JavaScript
  number.

```rust
# mod gauge {
#     use ferrovue as fv;
#     #[derive(Debug, Clone, serde::Serialize)]
#     pub struct Props {
#         #[serde(rename = "level")]
#         pub level: f64,
#     }
#     pub fn render(out: &mut String, props: &Props) {
#         out.push_str("<p>");
#         fv::core::push_number(out, props.level);
#         out.push_str("</p>");
#     }
#     pub fn island(props: &Props) -> fv::html::Html<'_, Props> {
#         fv::html::Html::island("Gauge", props, render)
#     }
# }
// Gauge.vue: defineProps<{ level: Float }>(), rendering <p>{{ level }}</p>.
let html = gauge::island(&gauge::Props { level: f64::NAN }).into_string();
assert_eq!(html, r#"<div data-island="Gauge" data-props="{&quot;level&quot;:NaN}"><p>NaN</p></div>"#);
```

The tokens are not JSON, so code that reads the props with plain `JSON.parse` refuses them; an
older `ferrovue` leaves such an island as the server rendered it and reports that its props
are not JSON, so it never hydrates with a wrong value. Upgrade the npm package with the crate.

Integers beyond the range of `i64` itself cannot be held in an `i64`: a prop cannot carry one, and
a result of integer arithmetic the template needs as an integer, given to a child's `number` prop,
used as an index or as the count of a `v-for` over a range, cannot either. Such a result beyond
±2⁶³ is refused as the component renders ([FV0724](crate::guide::error_codes#fv0724)): the
generated `try_render` returns a [`Refused`](crate::render::Refused), so a server can answer the request
with an error, and `render` panics with its message
([`errors_and_limits`](crate::guide::errors_and_limits#refused-at-render-time)). Keep integer props
and the results that go there within ±2⁵³, where both sides agree exactly, or type the child's
prop `Float`.

A number that reaches the client exactly can still be one the DOM refuses: a `<meter>` or
`<progress>` whose `:value` is `NaN` does not hydrate, because the browser throws when Vue sets that
property to a number that is not finite, as it would in an app Vue rendered alone.
