What is escaped, where, and the one way to write raw HTML.

# Everything a template interpolates is escaped

Every value the generated code writes into the page goes through [`escape_into`](crate::escape_into),
which is Vue's `escapeHtml`: `"`, `&`, `'`, `<` and `>` become entities, and nothing else changes.
That covers text (`{{ name }}`), attribute values (`:title="name"`), class and style values, link
`href`s and translated messages. A value can therefore neither close the element or attribute it
is in nor open a new one.

```rust
let mut out = String::from("<p title=\"");
ferrovue::escape_into(&mut out, r#"" onmouseover="alert(1)"#);
out.push_str("\">");
assert_eq!(out, r#"<p title="&quot; onmouseover=&quot;alert(1)">"#);
```

The property tests check that escaped text holds no markup and reads back as it was, for any
string.

Escaping keeps a value inside its context; it does not make every value safe in every context, any
more than it does in Vue. A `javascript:` URL bound to `:href` is still a `javascript:` URL, and a
string bound to `:style` is still CSS. Validate URLs from users before rendering them, as a Vue app
would.

What the page carries for the client is escaped for its context as well:

- an island's `data-props` is JSON, escaped as an attribute value;
- [`state_script_into`](crate::state_script_into) writes `<`, `>`, `&`, U+2028 and U+2029 inside its
  JSON as `\u` escapes, so no value can end the `<script>` element or be read as markup inside it,
  and it escapes the element's `id`.

# Your own code is not escaped for you

Slot closures and the parts of the page you write yourself are Rust, not templates: whatever they
push is written as it is. Use [`escape_into`](crate::escape_into) for any text they write.

# Scope ids

The `data-v-` attributes of [`<style scoped>`](crate::guide::scoped_styles) are written as they are,
unescaped: they are ids the compiler computed, ` data-v-` followed by hex digits. The same goes for
the ids that reach a component at run time, in `render_scoped`'s `fv_attrs` and in the slot scope id
a scoped slot's closure is given: generated code builds them from those ids alone. `render_scoped`
is hidden from the documentation because only generated code should call it; a closure that writes
the slot scope id it is given writes one of those ids, and nothing a request supplied.

# `v-html` and `TrustedHtml`

`v-html` writes a value without escaping it, so ferrovue accepts it only on a prop declared with the
`TrustedHtml` type from `ferrovue/types`:

```vue
<script setup lang="ts">
import type { TrustedHtml } from "ferrovue/types";
defineProps<{ body: TrustedHtml; caption: string }>();
</script>

<template>
  <article><div class="body" v-html="body"></div><p>{{ caption }}</p></article>
</template>
```

On the server, that prop's type is whatever `trustedHtml` names in `ferrovue.config.json`, a type of
your own that implements [`TrustedHtml`](crate::TrustedHtml). Make it a type whose values can only
come from your sanitiser, so that holding one is proof the HTML was made safe:

```json
{ "trustedHtml": "crate::html::Sanitised" }
```

```rust
// src/html.rs
use ferrovue::TrustedHtml;

/// HTML that has been through the sanitiser: the only way to make one.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(transparent)]
pub struct Sanitised(String);

impl Sanitised {
    pub fn new(untrusted: &str) -> Self {
        // A real project calls its sanitiser here, `ammonia::clean(untrusted)` for example.
        Sanitised(untrusted.replace('<', "&lt;"))
    }
}

impl TrustedHtml for Sanitised {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}
# let mut out = String::new();
# ferrovue::trusted_into(&mut out, &Sanitised::new("<script>"));
# assert_eq!(out, "&lt;script>");
```

The generated props struct derives `Debug`, `Clone` and `serde::Serialize`, and
`serde::Deserialize` under `cfg(test)`, so the type needs the same derives (`Deserialize` may be
`#[cfg_attr(test, derive(serde::Deserialize))]`). `#[serde(transparent)]` sends the HTML to an
island's client as a plain string. Production code never deserialises props, so no request can
turn an arbitrary string into a `Sanitised`.

`v-html` of anything else, a plain string or a translated message, is refused at compile time.
