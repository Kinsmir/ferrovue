The logic of `<script setup>` on the server: statements in a `computed` and in a list method's
callback.

A `computed` may be written as a body of statements, as may the arrow function given to `.map()`,
`.filter()`, `.find()`, `.some()`, `.every()`, `.findIndex()`, `.reduce()`, a `.toSorted()`
comparator and the other list methods the template may call. The compiler translates each body to
one Rust expression that computes what JavaScript computes, step for step.

# What a body may hold

- `const`, and `let` that is never assigned again, of any value the template may compute,
  destructured too: `const { name, posts: count } = author`, `const [first] = rows`. A type
  annotation types an empty array as it does in setup (`const tags: string[] = []`).
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
let s_byline = if let Some(n1) = props.author.as_ref() { { let fv_c2 = fv::js_trim(&n1.name); if fv_c2.is_empty() { "Unnamed" } else { fv_c2 } } } else { "Anonymous" };
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

# What is refused

Everything else a body could hold is refused where it is written, with the statement named:

| Written | Code | What to write instead |
|---|---|---|
| a loop (`for`, `for…of`, `for…in`, `while`, `do…while`) | FV1901 | `.map()`, `.filter()`, `.reduce()` |
| `try`, `throw`, `var`, a label, `continue`, an expression statement, a function or class declared inside the body | FV1901 | the value itself, or a prop computed in Rust |
| `x = …`, `x += …`, `x++`, a `let` assigned again | FV1902 | a `const` for each value |
| a path that reaches the end of the body, or `return;` | FV1903 | a `return` on every path; `return undefined` where that is meant |
| a case falling through into the next case's statements, a declaration directly in a `case`, code after `return` | FV1904 | `return` or `break` at the end of each case, `{ … }` around a case's declarations |
| more than 4096 paths that fall off an `if` or `break` out of a `case` and continue after it, as in a run of `switch`es of `break`ing cases | FV1905 | `return` at the end of each case, or the body split into several `computed`s |

A `computed` the server cannot evaluate stays client-only until the template reads it, which is
then refused with FV0613, the message naming the statement and its line.
