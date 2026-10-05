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

- An integer is written by [`push_int`](crate::push_int): its decimal digits, exactly, within
  ±(2⁵³ − 1). Beyond that, a JavaScript number has already lost precision (the browser rounds the
  value it reads from an island's props), so it is written as JavaScript writes the rounded number.
- A fraction is written by [`push_number`](crate::push_number), which is
  `Number.prototype.toString`: the shortest digits that read back as the same double, laid out as
  ECMAScript lays them out: `0.30000000000000004`, `1e+21`, `1.5e-7`, `NaN`, `-Infinity`, and `0`
  for `-0`.
- In a template literal or a string `+`, a number goes through [`Js`](crate::Js), whose `Display`
  writes it the same way.

```rust
use ferrovue::{Js, push_int, push_number};

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
both to `f64`, operates, and casts the result back, so a result within ±2⁵³ is exact and matches
JavaScript's. This is from the generated code of a component reading `counter.doubled`, a Pinia
getter that is `count * 2`:

```rust
# use ferrovue as fv;
# struct CounterState { count: i64 }
# struct Stores { counter: CounterState }
# let fv_stores = Stores { counter: CounterState { count: 21 } };
# let mut buf = String::new();
# let out = &mut buf;
fv::push_int(out, (fv_stores.counter.count as f64 * 2.0) as i64);
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

`Math` and `toFixed` have twins where Rust's own functions differ from JavaScript's:

| JavaScript | Rust | Why not the standard method |
|---|---|---|
| `Math.round(x)` | [`js_round`](crate::js_round) | A half rounds toward +∞: `-2.5` to `-2`, where `f64::round` gives `-3`; and from `-0.5` up to zero the result is `-0`, which `1 / Math.round(x)` shows (`-Infinity`) |
| `Math.max(a, b)`, `Math.min(a, b)` | [`js_max`](crate::js_max), [`js_min`](crate::js_min) | `NaN` if either is, where `f64::max` ignores a `NaN` |
| `x.toFixed(d)` | [`js_to_fixed`](crate::js_to_fixed) | An exact tie rounds away from zero, where Rust's formatting rounds to even |
| `Math.floor`, `Math.ceil`, `Math.trunc`, `Math.abs` | `f64::floor`, `ceil`, `trunc`, `abs` | They agree |
| `s.length` | [`js_length`](crate::js_length) | UTF-16 code units, not UTF-8 bytes. See [`strings`](crate::guide::strings) |
| `Number(s)`, `parseInt(s)`, `parseFloat(s)` | [`js_number`](crate::js_number), [`js_parse_int`](crate::js_parse_int), [`js_parse_float`](crate::js_parse_float) | JavaScript's grammar for numbers, which differs from Rust's `parse`. See [`strings`](crate::guide::strings) |

```rust
assert_eq!(ferrovue::js_round(-2.5), -2.0);
assert_eq!(1.0 / ferrovue::js_round(-0.4), f64::NEG_INFINITY); // Math.round(-0.4) is -0
assert!(ferrovue::js_max(1.0, f64::NAN).is_nan());
assert_eq!(ferrovue::js_to_fixed(1.005, 2), "1.00"); // 1.005 is 1.00499999999999989… as a double
assert_eq!(ferrovue::js_to_fixed(2.5, 0), "3");      // a true tie: away from zero
```

# Keeping islands exact

An island's props travel as JSON, which has no words for some numbers JavaScript has:

- an `f64` that is `NaN` or infinite is written as JavaScript writes it, the bare token `NaN`,
  `Infinity` or `-Infinity`, wherever it is: a prop, an item of a list, a field of an object, a
  value of a `Record`. `serde_json` alone would write `null`, and the client would render something
  other than what the server did (an empty string for the server's `NaN`) with nothing to say so.
  `mountIslands` from `ferrovue` reads the tokens back as the numbers they stand for, so a
  `Float` prop that is `NaN` hydrates as `NaN`. The stores' state in
  [`state_script_into`](crate::state_script_into) is written the same way and read back by
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
#         fv::push_number(out, props.level);
#         out.push_str("</p>");
#     }
#     pub fn island(props: &Props) -> fv::Html<'_, Props> {
#         fv::Html::island("Gauge", props, render)
#     }
# }
// Gauge.vue: defineProps<{ level: Float }>(), rendering <p>{{ level }}</p>.
let html = gauge::island(&gauge::Props { level: f64::NAN }).into_string();
assert_eq!(html, r#"<div data-island="Gauge" data-props="{&quot;level&quot;:NaN}"><p>NaN</p></div>"#);
```

The tokens are not JSON, so code that reads the props with plain `JSON.parse` refuses them; an
older `ferrovue` leaves such an island as the server rendered it and reports that its props
are not JSON, so it never hydrates with a wrong value. Upgrade the npm package with the crate.

Integers beyond the range of `i64` itself cannot be represented at all; keep integer props and the
results of integer arithmetic within ±2⁵³, where both sides agree exactly.

A number that reaches the client exactly can still be one the DOM refuses: a `<meter>` or
`<progress>` whose `:value` is `NaN` does not hydrate, because the browser throws when Vue sets that
property to a number that is not finite, as it would in an app Vue rendered alone.
