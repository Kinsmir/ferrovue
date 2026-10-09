What is escaped, where, and the one way to write raw HTML.

[`security`](crate::guide::security) is the threat model behind this page: every place ferrovue
writes data from readers, the code and tests behind each guarantee, and what it inherits from Vue.

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
more than it does in Vue. A `javascript:` URL bound to `:href` is still a `javascript:` URL, a
string bound to `:style` is still CSS, `:srcdoc` is still a document and `:onclick` is still script.
Validate URLs from users before rendering them, as a Vue app would. The
[threat model](crate::guide::security#what-ferrovue-inherits-from-vue) lists every such case.

What the page carries for the client is escaped for its context as well:

- an island's `data-props` is JSON, escaped as an attribute value;
- [`state_script_into`](crate::state_script_into) writes `<`, `>`, `&`, U+2028 and U+2029 inside its
  JSON as `\u` escapes, so no value can end the `<script>` element or be read as markup inside it,
  and it escapes the element's `id`.

# Your own code is not escaped for you

Slot closures and the parts of the page you write yourself are plain Rust: whatever they
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

On the server, that prop's type is whatever `trustedHtml` names in `ferrovue.config.json`, a type
that implements [`TrustedHtml`](crate::TrustedHtml). `v-html` of anything else, a plain string or a
translated message, is refused at compile time.

There are four ways to have one:

| Type | Needs | Takes | Use it for |
|---|---|---|---|
| [`BasicHtml`](crate::BasicHtml) | nothing | text with `<b>`, `<i>`, `<em>`, `<strong>`, `<code>`, `<br>`, `<p>`, `<ul>`, `<ol>` and `<li>`, or plain text | comments, reviews, bios: text from users with a little formatting |
| [`InlineHtml`](crate::InlineHtml) | nothing | text with `<b>`, `<i>`, `<em>`, `<strong>`, `<code>` and `<br>` | a line of formatted text inside a `<p>` |
| `ferrovue::Sanitised` | the `ammonia` feature | any HTML, cleaned to ammonia's policy or yours | Markdown rendered to HTML, CMS content, HTML from elsewhere |
| a type of your own | your sanitiser | whatever your sanitiser accepts | another sanitiser, or a policy kept in one place |

## Where `v-html` may go

The browser reads the page with its HTML parser, which rebuilds markup in some places: it moves
what is written in a table's structure out of the table, drops the tags inside a `<select>`, ends
SVG and MathML at an HTML tag, and ends a `<p>` at a block such as `<p>`, `<ul>` or `<div>`. There
the page holds other nodes than the server wrote, and hydration mismatches. Vue does the same, so
ferrovue refuses `v-html` where it would happen:

| Element carrying `v-html` | Allowed | Instead |
|---|---|---|
| `<table>`, `<thead>`, `<tbody>`, `<tfoot>`, `<tr>`, `<colgroup>` | no (FV1512) | a `<td>`, `<th>` or `<caption>` |
| `<select>`, `<optgroup>` | no (FV1512) | the `<option>`s written in the template |
| an SVG element other than `<foreignObject>`, `<desc>` and `<title>` | no (FV1512) | an HTML element inside a `<foreignObject>` |
| a MathML element other than `<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>`, and `<annotation-xml>` with a static `encoding="text/html"` or `"application/xhtml+xml"` | no (FV1512) | an `<mtext>` |
| a `<p>`, or an element inside one (through `<template>` and `<slot>`) | only an `InlineHtml` prop (FV1513) | a `<div>`, or the prop typed `InlineHtml` |
| anything else | any trusted HTML | |

The check for a `<p>` stops where the parser does: at a `<button>`, `<table>`, `<td>`, `<th>`,
`<caption>`, `<object>`, `<marquee>`, `<applet>` or `<template>` element, which keeps a block
inside it from ending the `<p>` around it, at an SVG or MathML element, and at a child component.
Content written into a child component's slot is checked where it is written: the compiler cannot
see that the child places it inside a `<p>`, and the same holds for a component whose root is
rendered inside another component's `<p>`. Give such HTML the `InlineHtml` type.

An `InlineHtml` prop comes from `ferrovue/types` and is always
[`ferrovue::InlineHtml`](crate::InlineHtml) on the server, whatever `trustedHtml` names, so it needs
no configuration:

```vue
<script setup lang="ts">
import type { InlineHtml } from "ferrovue/types";
defineProps<{ lead: InlineHtml }>();
</script>

<template>
  <p class="lead" v-html="lead"></p>
</template>
```

With `"trustedHtml": "ferrovue::InlineHtml"` in `ferrovue.config.json`, every `TrustedHtml` prop is
inline HTML as well, and may go inside a `<p>`.

## `ferrovue::BasicHtml`

[`BasicHtml`](crate::BasicHtml) needs no sanitiser and no feature. It never reads the input as
HTML: `BasicHtml::new(untrusted)` escapes every character, as [`escape_into`](crate::escape_into)
does, and writes as tags only the ten tags above, spelled exactly so, in lower case and with no
attributes. It closes what is left open, leaves out end tags with nothing to close, and keeps the
tags in an order a browser reads back as written. Anything else, `<B>`, `<b class="x">`, `<a>` or
`<script>`, is text on the page.

```json
{ "trustedHtml": "ferrovue::BasicHtml" }
```

```rust
use ferrovue::BasicHtml;

assert_eq!(
    BasicHtml::new("<b>Great</b> <i>read<script>steal()</script>").as_str(),
    "<b>Great</b> <i>read&lt;script&gt;steal()&lt;/script&gt;</i>"
);
assert_eq!(
    BasicHtml::from_text("Line one\nline two\n\nNext <paragraph>").as_str(),
    "<p>Line one<br>line two</p><p>Next &lt;paragraph&gt;</p>"
);
```

`BasicHtml::from_text(text)` escapes everything and writes blank lines as paragraphs and other
line breaks as `<br>`. Character references in the input (`&amp;`, `&#60;`) are kept, since they
only ever write text.

## `ferrovue::Sanitised`, with the `ammonia` feature

With the crate's `ammonia` feature, `ferrovue::Sanitised` is HTML cleaned by
[ammonia](https://docs.rs/ammonia).

```json
{ "trustedHtml": "ferrovue::Sanitised" }
```

```toml
ferrovue = { version = "0.7", features = ["ammonia"] }
```

Sanitisation happens before render, when the value is built: `Sanitised::new(untrusted)` cleans
with ammonia's default policy, `Sanitised::with(&builder, untrusted)` with an `ammonia::Builder` of
your own (`ferrovue::ammonia` is the crate, re-exported). Rendering writes the cleaned string as it
is. The value serialises as that string, so an island's `data-props` carries exactly what the
server rendered, and the client's `v-html` writes the same string: server and client hold the same
HTML, and hydration matches. Deserialising a `Sanitised` cleans the string again with the default
policy, so no JSON can make one that skipped the sanitiser.

Ammonia's default policy keeps the tags of text and documents (paragraphs, headings, lists,
tables, links, images, emphasis, `<code>` and `<pre>`, and the like), with a few attributes each
(`href` on links, `src`, `alt`, `width` and `height` on images, `title` and `lang` everywhere),
and URLs whose scheme is on its list (`http`, `https`, `mailto` and other common ones) or that are
relative. It removes everything else: `<script>`, `<style>`, SVG and MathML with their
content, other elements such as `<form>` and `<button>` (keeping their text), event handler attributes,
`class`, `id` and `style`, comments, and `javascript:` and other unlisted URLs. Links gain
`rel="noopener noreferrer"`. It closes elements left open, so the HTML cannot reach past the
element it is written into. A policy of your own can allow more, such as `class` on some tags.

## A type of your own

A type of your own implements [`TrustedHtml`](crate::TrustedHtml), with three rules:

1. **Sanitise before render.** The only way to make a value runs the sanitiser, so holding one is
   proof the HTML was made safe. Keep the field private and give the type no `From<String>`.
2. **The client receives the same string.** `#[serde(transparent)]` serialises the value as the
   string `trusted_html` returns, so an island's `data-props` carries the HTML the server wrote,
   and the client's `v-html` writes it unchanged.
3. **Sanitise again on `Deserialize`.** The generated props struct derives `serde::Deserialize`
   under `cfg(test)`, so the type needs it. Deserialise a string and run it through the sanitiser,
   so that no JSON can make a value that skipped it. A sanitiser whose output, cleaned again, is
   the same output reads back what was serialised.

```json
{ "trustedHtml": "crate::html::CleanHtml" }
```

```rust
// src/html.rs
use ferrovue::TrustedHtml;
use serde::{Deserialize, Deserializer};

/// HTML that has been through the sanitiser: the only way to make one.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(transparent)]
pub struct CleanHtml(String);

impl CleanHtml {
    pub fn new(untrusted: &str) -> Self {
        CleanHtml(sanitise(untrusted))
    }
}

impl TrustedHtml for CleanHtml {
    fn trusted_html(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for CleanHtml {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(CleanHtml::new(&String::deserialize(deserializer)?))
    }
}

/// Your sanitiser. This one keeps no markup at all.
fn sanitise(untrusted: &str) -> String {
    untrusted.replace(['<', '>'], "")
}
# let html = CleanHtml::new("<script>x</script>");
# let mut out = String::new();
# ferrovue::trusted_into(&mut out, &html);
# assert_eq!(out, "scriptx/script");
# let json = serde_json::to_string(&html).unwrap();
# assert_eq!(serde_json::from_str::<CleanHtml>(&json).unwrap(), html);
```
