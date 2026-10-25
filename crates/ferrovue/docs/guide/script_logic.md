The logic of `<script setup>` on the server: statements in a `computed` and in a list method's
callback, the functions a template calls, and the object literals they build.

A `computed` may be written as a body of statements, as may the arrow function given to `.map()`,
`.filter()`, `.find()`, `.some()`, `.every()`, `.findIndex()`, `.reduce()`, a `.toSorted()`
comparator and the other list methods the template may call. The compiler translates each body to
one Rust expression that computes what JavaScript computes, step for step.

# What a body may hold

- `const` and `let` of any value the template may compute, destructured too:
  `const { name, posts: count } = author`, `const [first] = rows`. A type annotation types an
  empty array as it does in setup (`const tags: string[] = []`).
- assignments to the body's `let`s, and `for…of` and counting `for` loops (see
  [Loops and assignments](#loops-and-assignments)).
- `if` / `else if` / `else`, and blocks.
- `return` of a value, at the end of the body or early.
- `switch` over a string (a string-literal union included) or a number: `case`s stacked to share
  their statements, `default` anywhere, and each case ending in `return` or in `break`, which goes
  on after the `switch`. A case's declarations go in a block of their own: `case "md": { … }`.

```vue
<script setup lang="ts">
import { computed } from "vue";

interface Author {
  name: string;
  title?: string;
}

const props = defineProps<{ author?: Author; size: "sm" | "md" | "lg"; tags: string[] }>();

const byline = computed(() => {
  if (!props.author) return "Anonymous";
  const name = props.author.name.trim();
  if (name === "") return "Unnamed";
  return name;
});

const label = computed(() => {
  switch (props.size) {
    case "sm":
      return "small";
    case "md":
    case "lg":
      return "large";
  }
  return "unknown";
});

const shouted = computed(() =>
  props.tags.map((t) => {
    const trimmed = t.trim();
    if (trimmed === "") return "-";
    return trimmed.toUpperCase();
  }),
);
</script>
```

# How a body is translated

Each `return` is a branch of an `if` in Rust, and each `const` a `let`, evaluated once, where
JavaScript evaluates it and only on the path that reaches it. This is the generated code of
`byline` above:

```rust
# use ferrovue as fv;
# struct Author<'a> { name: std::borrow::Cow<'a, str> }
# struct Props<'a> { author: Option<Author<'a>> }
# let props = Props { author: Some(Author { name: " Ann ".into() }) };
let s_byline = if let Some(fv_author) = props.author.as_ref() { { let fv_name = fv::strings::js_trim(&fv_author.name); if fv_name.is_empty() { "Unnamed" } else { fv_name } } } else { "Anonymous" };
# assert_eq!(s_byline, "Ann");
```

A `const` that only renames a value already at hand (a prop, a field, a literal) is read in place,
without a `let`.

An early `return` narrows what follows it as TypeScript narrows it: after
`if (!props.author) return "Anonymous"`, `props.author` is present, and after
`if (!a || !a.title) return "-"`, `a.title` is. `&&` and `||` in an `if` narrow each side in
turn, as they do in the template's `v-if`.

A `computed` is still one value of the render: one whose statements may throw (`.repeat()` of a
negative count, `.toISOString()` of an invalid date, a helper) is evaluated where the render first
reads it, as Vue evaluates it, and a `const` after an early `return` is never evaluated on the
path that returns. A string, a list or an optional string computed from a `const` is handed out as
its own value, since the `let` it borrows from ends with the body.

# Loops and assignments

A body may assign the `let`s it declares and loop over lists and strings:

- `x = …`, `x += …`, `x -= …`, `x *= …`, `x /= …`, `x %= …`, `x ??= …`, `x ||= …`, `x &&= …`,
  `x++` and `x--`, each a statement of its own, anywhere in the body: in its `if`s, its `switch`es
  and its loops.
- `for (const x of list)` over a list of strings, numbers, booleans or objects: a prop, a
  `computed`, the result of a list method, an array literal, `Object.keys()`, `Object.values()` or
  `Object.entries()`. The item is a name or a pattern (`for (const { name, score } of rows)`,
  `for (const [key, value] of Object.entries(counts))`), and `list.entries()` gives the index too:
  `for (const [i, x] of list.entries())`.
- `for (const ch of text)` over a string, by its characters as JavaScript iterates it: a character
  beyond U+FFFF, such as 🦀, is one item of two UTF-16 code units, and half of a surrogate pair
  (from `slice` and the like) is one item of one, held as U+FFFD as
  [`strings`](crate::guide::strings#halves-of-surrogate-pairs) describes.
- `for (let i = start; i < end; i++)`, a counting loop: from an integer, with `<`, `<=`, `>` or
  `>=` against an integer bound, and `i++`, `i--`, `i += k` or `i -= k` of a whole `k` towards it.
  The bound is read again before each item, as JavaScript reads it, and may not read a `let` the
  loop changes; the body leaves `i` to the loop's head.
- `break` and `continue`, loops inside loops, and `return` inside a loop.

```vue
<script setup lang="ts">
import { computed } from "vue";

interface Row {
  name: string;
  score: number;
}

const props = defineProps<{ rows: Row[]; amount: number }>();

const leader = computed(() => {
  let best = -1;
  let name = "nobody";
  for (const r of props.rows) {
    if (r.score <= best) continue;
    best = r.score;
    name = r.name;
  }
  return `${name} (${best})`;
});

function thousands(n: number): string {
  const digits = String(Math.abs(n));
  let out = n < 0 ? "-" : "";
  for (const [i, ch] of digits.split("").entries()) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += ch;
  }
  return out;
}
</script>

<template>
  <p>{{ leader }}: {{ thousands(amount) }}</p>
</template>
```

An assignment gives the `let` its new value for the statements after it, so a `let` that no loop
assigns costs what a `const` costs, and has the type TypeScript narrows it to: after `found = w`,
a `let found: string | undefined` is a string. A loop carries the `let`s it assigns from one item
to the next in Rust variables: a string in a `String`, a boolean in a `bool`, and a number in an
`f64`, which holds every value a JavaScript number holds, `-0` and integers beyond 2⁵³ included, and
computes them as JavaScript does; one the loop only gives integers is read back as an integer. Each
may be `undefined` or `null`, in an `Option`. Strings are appended to in place. This is the
generated code of `leader`:

```rust
# use ferrovue as fv;
# struct Row<'a> { name: std::borrow::Cow<'a, str>, score: i64 }
# struct Props<'a> { rows: Vec<Row<'a>> }
# let props = Props { rows: vec![Row { name: "Ann".into(), score: 7 }, Row { name: "Bo".into(), score: 9 }] };
let s_leader = { let mut fv_best: f64 = -1.0f64; let mut fv_name: String = String::from("nobody"); for fv_r in props.rows.iter() { if fv_r.score as f64 <= fv_best {} else { fv_best = fv_r.score as f64; fv_name = String::from(&*fv_r.name); } } std::borrow::Cow::<str>::Owned(format!("{} ({})", fv_name, fv::core::numbers::Js(fv_best))) };
# assert_eq!(s_leader, "Bo (9)");
```

A `return` inside a loop ends it, and the body returns that value once the loop is left; it gives a
string, a number or a boolean. A body whose every path ends in `break` or `return` runs on the first
item alone, as JavaScript runs it. Each value is computed once, where JavaScript computes it, and a
`let` nothing reads after the loop is assigned only where something does.

The loops the compiler cannot bound are refused, `while`, `do…while` and `for…in` among them, and so
is a `for` loop that does not count as above: iterate a list or a string with `for…of`, or count to
an integer bound. A `let` keeps one type, the one it is declared with or the type of its first value,
and a `let` that starts as `undefined` or `null` states its type: `let found: string | undefined =
undefined`. A body assigns its own `let`s: an assignment to a `const`, a parameter, a prop, a ref,
a `computed`, a field or an item of an object or a list is refused, and so is one from a function
inside the body to a `let` of the body. So is a function declared in the body that reads a `let` the
body assigns again: the server gives it the value the `let` holds where the function is declared,
and JavaScript the value it holds where the function is called.

# Functions

The template and a `computed` may call functions of the component's own, declared in
`<script setup>`, and functions exported from a `.ts` file it imports (a default export
included). Their bodies hold what a
`computed`'s may, and read what it may: props, refs (`count.value`), `computed`s, constants and
other such functions. A function in a `.ts` file reads that file's constants, its other functions
and what it imports from other `.ts` files.

```ts
// components/format.ts
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
```

```vue
<script setup lang="ts">
import { compact, pluralise } from "./format";
import type { Float } from "ferrovue/types";

const props = defineProps<{ views: number; price: Float; tags: string[] }>();

function tagLine(tag: string, index: number): string {
  return index === 0 ? tag.toUpperCase() : tag;
}
</script>

<template>
  <p>{{ compact(views) }} {{ pluralise(views, "view") }}, {{ compact(price) }}</p>
  <span v-for="(tag, i) in tags" :key="tag">{{ tagLine(tag, i) }}</span>
</template>
```

Each call is translated where it is written: its arguments are evaluated once, in order, then its
body with the parameters bound to them, as JavaScript calls it. A parameter takes the type of the
argument it is given there, so `compact` above is computed on an integer for `views` and on a
`Float` for `price`, each as JavaScript computes it; annotations are not needed for the translation,
though an empty array given to an annotated parameter, or returned under an annotated return type,
takes its type from it. A function imported from a `.ts` file this way needs no
[`helpers`](crate::guide::errors_and_limits#helpers) entry and no Rust twin.

Parameters are plain names, optional (`x?: T`, `undefined` when not given), with defaults
(`x = 1`, which may read an earlier parameter, applied when the argument is missing or
`undefined`), and object or array patterns of names (`function grade({ score }: Member)`).

A body may declare arrow functions of its own, which read its names and are translated where the
body calls them, as the functions above are:

```ts
export function clock(seconds: number): string {
  const pad = (k: number) => String(k).padStart(2, "0");
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}
```

A function the template names only from an event handler (`@click="toggle"`) is never translated,
and may hold anything. One the template or a `computed` calls, whose body the server cannot
evaluate, is refused with the code of the statement or expression that stops it, at its place in
the function's file, the message naming the function and the call: `` (in `total()`, called at
components/Cart.vue:9:12) ``.

# Object literals

An object literal is built as the Rust struct of the interface it is typed with, a struct of the
component's module or of `types.rs`. Its type comes from where it goes:

- a `computed` annotated with it: `computed<Card>(() => …)`, `computed((): Card => …)`, or
  `const card: ComputedRef<Card> = computed(…)`;
- a function's return type (`function card(…): Card`), or a parameter's (`badge({ label })` for
  `function badge(b: Badge)`), in `<script setup>` or in a `.ts` file;
- a `.map()` callback's return type (`.map((x): Row => ({ … }))`), or the list type its result is
  given: a `computed<Row[]>`, a function returning `Row[]`, a child's prop typed `Row[]`;
- a child's prop typed with an interface, `:item="{ id, label }"`, and the same in `v-bind="{ … }"`;
- an annotated `const` in setup, `const card: Card = { title: props.title, … }`, or `satisfies`;
- the field of another literal, or an item of an array literal, typed by the field or the list.

```vue
<script setup lang="ts">
import { computed } from "vue";
import Crumbs from "./Crumbs.vue";

interface Message {
  title: string;
  body: string;
  code?: number;
}

const props = defineProps<{ code: number; parts: string[] }>();

const message = computed((): Message =>
  props.code === 404 ? { title: "Missing", body: "Gone." } : { title: "Error", body: "Retry.", code: props.code },
);
</script>

<template>
  <h1>{{ message.title }}</h1>
  <!-- Crumbs: defineProps<{ crumbs: Crumb[] }>(), with interface Crumb { label: string; href: string } -->
  <Crumbs :crumbs="parts.map((label, i) => ({ label, href: `/${parts.slice(0, i + 1).join('/')}` }))" />
</template>
```

The literal's keys are evaluated in the order they are written, and the optional fields it leaves
out are `None`, as an explicit `undefined` is. This is the generated code of `message`:

```rust
# use std::borrow::Cow;
# struct Message<'a> { title: Cow<'a, str>, body: Cow<'a, str>, code: Option<i64> }
# struct Props { code: i64 }
# let props = Props { code: 500 };
let s_message = if props.code as f64 == 404.0 { Message { title: std::borrow::Cow::<str>::Borrowed("Missing"), body: std::borrow::Cow::<str>::Borrowed("Gone."), code: None } } else { Message { title: std::borrow::Cow::<str>::Borrowed("Error"), body: std::borrow::Cow::<str>::Borrowed("Retry."), code: Some(props.code) } };
# assert_eq!(s_message.title, "Error");
# assert_eq!(s_message.body, "Retry.");
# assert_eq!(s_message.code, Some(500));
```

A string the literal reads from the props stays borrowed; one it computes, or reads from a value a
function or a `.map()` callback holds for itself, is owned. The template, a `computed` and a child
read the struct's fields as they read a prop's.

A key is a name, a string, a shorthand (`{ title }`), or a computed key the compiler knows (a
string literal, a constant, an enum member: `{ [KEY]: "x" }`). A spread copies an object of the same
interface and comes first, the keys after it writing over its fields: `{ ...card, title }`. Each
field takes what a prop of its type takes, with the absence it declares: an optional field takes
`undefined` or a value that may be `undefined`, a `T | null` field `null` or a value that may be
`null`.

A field typed as a union of string literals holds the union's enum (see
[`props`](crate::guide::props#unions-of-string-literals)): a literal of the union is its variant
(`{ size: "md" }` is `Size::Md`), a value of the same enum is given as it is, and a narrower union
or a `?:` of members goes through a `match`. A string that may hold another value is refused
([FV0635](crate::guide::error_codes#fv0635)): give a member, or a value typed as the union.

Nothing the server renders shows the order of an object's keys or tells an absent field from one
that is `undefined`: `JSON.stringify()`, `Object.keys()`, `v-for` over an object, `{{ }}` and
`v-bind` of an object are refused, here as for an object prop, and so is an attribute bound to one.

A value built from object literals is held while the expression that builds it runs. It is read
whole, by a field, by `v-for` and `.length`, and handed to a child. A list method, an item
(`list[0]`) or an optional chain of it is refused
([FV0636](crate::guide::error_codes#fv0636)): give it a `computed` of its own and read that, or call
`.filter()` before `.map()`.

| Written | Code | What to write instead |
|---|---|---|
| a literal whose type is not known: no annotation reaches it | FV0634 | an annotation where it goes, as the message says |
| a key the interface does not declare, a required field left out, a key given twice, a method, `__proto__`, a computed key the compiler does not know, a spread of another type or after other keys, a string that may be outside a field's union | FV0635 | the fields of the interface, the spread first, a member of the union |
| `undefined` for a required field, `null` for an optional one | FV0606 | `?? null`, `?? undefined`, or the type the field declares |
| a list method, an item or `?.` of a value built from literals | FV0636 | a `computed` that holds it, or the method called before `.map()` |

# What is refused

Everything else a body could hold is refused, with the statement named:

| Written | Code | What to write instead |
|---|---|---|
| a `while`, `do…while` or `for…in` loop | FV1901 | `for…of`, a counting `for` loop, `.map()`, `.filter()`, `.reduce()` |
| `try`, `throw`, `var`, a label, an expression statement other than an assignment, a `function` or class declared inside the body | FV1901 | the value itself, a prop computed in Rust, or `const f = (…) => …` for a function |
| an assignment inside an expression (`f(i++)`), to a `const`, a parameter, a prop, a ref, a `computed`, a field or an item, or from a function inside the body to a `let` of the body; a function declared in the body reading a `let` the body assigns again | FV1902 | a statement of its own assigning a `let` of the body; a parameter for the function |
| a `for` loop that does not count from an integer to an integer bound the loop leaves alone, `for await`, a `for…of` loop without a declaration in its head | FV1909 | `for (let i = start; i < end; i++)`, `for (const x of list)` |
| `for…of` over a value that is not a list of strings, numbers, booleans or objects, or a string | FV1910 | `.filter(Boolean)` for a list of optional values, `x ?? []` for an optional list |
| a loop assigning a `let` that holds a list, an object, or a value that may be both `null` and `undefined`; a `return` inside a loop of a list, an object or a value that may be absent | FV1911 | `.map()`, `.filter()`, `.find()`, or a `return` after the loop |
| a `let` assigned a value of another type, `++` of a string, a `let` starting as `undefined` with no type, a `let` holding a function | FV1912 | a `let` of its own for the other value, `let x: T \| undefined = undefined` |
| a path that reaches the end of the body, or `return;` | FV1903 | a `return` on every path; `return undefined` where that is meant |
| a case falling through into the next case's statements, a declaration directly in a `case`, code after `return` | FV1904 | `return` or `break` at the end of each case, `{ … }` around a case's declarations |
| more than 4096 paths that fall off an `if` or `break` out of a `case` and continue after it, as in a run of `switch`es of `break`ing cases | FV1905 | `return` at the end of each case, or the body split into several `computed`s |
| a function that calls itself, directly or through others | FV1906 | the value computed in Rust and passed as a prop |
| a function declared with `const`, called by setup code above its declaration, where JavaScript throws a `ReferenceError` | FV1908 | the declaration moved above the call, or the function declared with `function` |
| `...rest` parameters, `async` functions, generators, `...` arguments, more arguments than the function names, a default for a parameter given a value that may be `null` or `undefined` | FV1907 | named parameters; `??` where the value is passed |

A `computed` the server cannot evaluate stays client-only until the template reads it, which is
then refused with the code of the statement that stops it, at its place in the `computed`, the
message naming where the template reads it. A refusal is reported once, however often the template
reads the `computed`.
