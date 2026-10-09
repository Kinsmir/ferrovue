The threat model: every place ferrovue writes data that may come from a reader, what it
guarantees there, the code that enforces it, the tests that hold it, and what it inherits from Vue.

ferrovue's promise is that the HTML it writes is the HTML Vue's server renderer writes. That makes
Vue's own escaping the baseline: wherever Vue escapes, ferrovue escapes the same characters the same
way, and wherever Vue writes a value as it is, so does ferrovue. A gap in that promise is a
cross-site scripting hole in every site that uses ferrovue; [SECURITY.md] says how to report one.
[`escaping`](crate::guide::escaping) is the user's guide to the same rules; this page is the map for
a reviewer.

[SECURITY.md]: https://github.com/Kinsmir/ferrovue/blob/main/SECURITY.md

# Trust boundaries

**Trusted**, written by the application's developers and checked in with it:

- the components: `.vue` files, the `.ts` files they import types and constants from, and so every
  element name, attribute name, static attribute value, class and style property name, `useHead`
  key and `<RouterLink>` route name a template holds;
- `ferrovue.config.json`, the routes file, the store definitions and the locale files (messages are
  compiled into Rust at build time);
- the application's Rust: the page around the components, slot closures, Rust twins and helpers,
  the [`TrustedHtml`](crate::TrustedHtml) types and their sanitisers, the futures that fill
  [`HtmlStream`](crate::HtmlStream) holes, and the ids given to
  [`state_script_into`](crate::state_script_into) and [`PageRecord`](crate::PageRecord).

**Untrusted**, and safe to fill from a request, a database or another user:

- every prop value, at every depth: strings, numbers, lists, dictionaries (keys too), optional and
  nullable values;
- Pinia store state;
- the route: the location given to [`Router::at`](crate::Router::at), and so the path, its
  parameters, the query and the hash; a `<RouterLink>`'s `to` built from props;
- the locale name passed to the generated `i18n(locale)`, and every value given to `$t`;
- every value given to `useHead` and `useSeoMeta`;
- the input of [`BasicHtml::new`](crate::BasicHtml::new), [`InlineHtml::new`](crate::InlineHtml::new)
  and `Sanitised::new`;
- the margin and query of a [`Hydrate`](crate::Hydrate), and a `<Teleport>`'s `to`.

Untrusted data is safe in the sense Vue's server renderer gives: it cannot leave the text node or
quoted attribute value it is written into, and it cannot add an element or an attribute. It can
still be a hostile *value* where the context gives values meaning: a URL, CSS, an event handler.
Those cases are listed under [what ferrovue inherits from Vue](#what-ferrovue-inherits-from-vue).

# Where data is written

## Text

| | |
|---|---|
| Written | `{{ }}`, `v-text`, a component's text props, messages from `$t`, the route's fields, store state |
| Guarantee | `"`, `&`, `'`, `<` and `>` are written as entities (`&quot;`, `&amp;`, `&#39;`, `&lt;`, `&gt;`), every other character as it is: Vue's `escapeHtml`. Numbers and booleans are written as JavaScript writes them and hold none of the five |
| Code | `escape_into` in `crates/ferrovue-core/src/escape.rs`; the compiler emits it for every string (`display` in `packages/ferrovue/src/attrs.ts`) |
| Tests | `crates/ferrovue-core/tests/vectors/escape.json` (recorded from `@vue/shared`) and a 20,000-case property against a byte-by-byte reference (`crates/ferrovue-core/src/escape/tests.rs`); `escaped_text_holds_no_markup_and_reads_back_whole` (`crates/ferrovue/tests/properties.rs`); the conformance components' hostile fixtures; the fuzzer, whose `FERROVUE_FUZZ_PLANT=1` self-check replaces one `escape_into` with a plain push and must be caught |

Text inside `<textarea>`, `<title>` or `<noscript>` is escaped the same way. Text
inside a `<script>` or `<style>`, which a template can only reach through `<component :is>`, is
escaped too and stays code: see below.

## Attribute values

| | |
|---|---|
| Written | Bound attributes (`:title`, `:href`), static ones beside them, `class` and `style` in all their shapes, attributes falling through to a child's root (`$attrs`, `useAttrs()`, `inheritAttrs: false`), boolean and enumerated attributes, `<RouterLink>`'s `href` and classes |
| Guarantee | Every value is double-quoted and escaped with `escape_into`. A boolean attribute (`disabled`, `checked`, `hidden` given a boolean, and the rest of Vue's list) is written as its name alone or left out. `class` is normalised (trimmed, empty names dropped, an object's true names joined) and escaped as a whole. Static values are the template's, written as Vue's compiler writes them |
| Code | `renderAttr` and `renderDynamicAttr` in `packages/ferrovue/src/attrs.ts`; `crates/ferrovue/src/attrs.rs` (`attr_into`, `dynamic_attr_into`, `style_into`) for merged and fallthrough attributes; `crates/ferrovue/src/class.rs` |
| Tests | `crates/ferrovue/tests/vectors/attrs.json` (`ssrRenderAttrs(mergeProps(…))`) and `class.json`, recorded from Vue; the `Attrs`, `Fallthrough` and `Fall*` components' hostile fixtures; `Unsanitised` (below) |

## Attribute names

| | |
|---|---|
| Written | Every attribute name a template binds, the names that fall through to a child's root, the names of an element `<component :is>` renders from virtual nodes |
| Guarantee | No attribute name comes from data. The compiler takes names from the template alone: a name chosen at run time (`:[name]`) is refused (FV0408), and so is `v-bind` of anything but an object literal (FV0410); `$attrs` holds the names some parent's template wrote. A bound name Vue's server renderer would skip as unsafe (one holding `>`, `/`, `=`, `"`, `'`, tab, line feed, form feed, carriage return or space) is refused at compile time (FV0404) |
| Code | `objectAttrs`, `mergeProps` and `attrEntries` in `packages/ferrovue/src/attrs.ts`; `packages/ferrovue/src/fallthrough.ts` |
| Defence in depth | The runtime that writes fallthrough attributes repeats Vue's rules for names given to [`Attrs`](crate::Attrs) by Rust code: it drops `key`, `ref`, `innerHTML`, `textContent`, `ref_key`, `ref_for`, names starting `.` and listeners (`on` followed by anything but a lower-case letter), lowers the case, maps `className`, `htmlFor`, `acceptCharset` and `httpEquiv`, writes a boolean attribute as its name, and drops a name holding any of the unsafe characters above (`dynamic_attr_into` in `crates/ferrovue/src/attrs.rs`) |
| Tests | `attrs.json` holds names with each unsafe character, NUL, U+00A0, `on`, `onx` and `onClick`; `compiler.test.ts` refuses `:x'y`, `:[name]` and `v-bind="props.extra"`; `TagCasing` holds the case rules of virtual nodes to Vue |

## CSS

| | |
|---|---|
| Written | `:style` objects, arrays and strings, merged with a static `style`, `v-show`'s `display:none`, styles falling through |
| Guarantee | Property names come from the template (computed names are refused, FV1008, and so are numeric and `:`-prefixed ones, FV1009) and are escaped; values are escaped. A string merged with other styles is parsed into declarations as Vue's `normalizeStyle` parses it and written back escaped. `v-bind()` in a `<style>` block is refused (FV1006), so no prop reaches CSS custom properties |
| Code | `packages/ferrovue/src/styles.ts`; `style_into`, `parse_style` and `style_text_into` in `crates/ferrovue/src/attrs.rs` |
| Tests | `Styles` and `Shown` fixtures (hostile included), `attrs.json`'s styles, `Unsanitised` |

## Island props: `data-props` and `data-hydrate`

| | |
|---|---|
| Written | An island's wrapper, `<div data-island="Name" data-props="{…}" data-hydrate="…">` |
| Guarantee | `data-props` is the props as JSON (serde_json, with `NaN` and `Infinity` as bare tokens), escaped with `escape_into` as it is written, so it is one attribute value whatever the props hold. Props serde_json refuses write an empty value in a release build and panic in a debug one. `data-island` is the component's name, a constant, escaped as well. `data-hydrate` is [`Hydrate::attribute`](crate::Hydrate::attribute), escaped. The client reads `data-props` with `JSON.parse` and a reviver for the non-finite tokens (`parseJson` in `packages/ferrovue/src/client.ts`), and never evaluates it |
| Code | `island_into` in `crates/ferrovue/src/html.rs`; `escaped_into` in `crates/ferrovue/src/json.rs`; with the `dioxus` feature, `to_element` in `crates/ferrovue/src/dioxus.rs` hands the same values to Dioxus as attributes, which it escapes |
| Tests | `island_props_cannot_leave_their_attribute`, `the_island_name_is_escaped_too` and `a_hostile_media_query_or_root_margin_cannot_leave_its_attribute` (`crates/ferrovue/src/html/tests.rs`); `written_escaped_is_what_escaping_the_json_gives` (`json.rs`); the Dioxus tests in `tests/conformance.rs` |

## The state script and the page record

| | |
|---|---|
| Written | [`state_script_into`](crate::state_script_into) (Pinia state) and [`PageRecord::script_into`](crate::PageRecord::script_into) (the layout's props and every page part's component and props): `<script type="application/json" id="…">…</script>` |
| Guarantee | The JSON has `<`, `>`, `&`, U+2028 and U+2029 written as `\u` escapes, so no value can end the element, open a comment or be read as markup inside it, and the body reads back as the JSON given. The `id` is escaped. The type is `application/json`, which no browser runs, so the page needs no nonce for it. A value serde_json refuses is `null` in the record, which stays readable |
| Code | `json_script_into` and `json_escaped_into` in `crates/ferrovue/src/state.rs`; `Recorded::to_json` in `crates/ferrovue/src/page.rs`; `state_script` in `dioxus.rs` |
| Tests | `crates/ferrovue/src/state/tests.rs`; `the_record_cannot_be_closed_by_a_prop_and_reads_back_whole` (`crates/ferrovue/src/page/tests.rs`); `the_state_script_is_one_element_whose_body_reads_back` (`properties.rs`); `pages/hostile.json` in the conformance suite |

## The page head

| | |
|---|---|
| Written | [`Head::render`](crate::Head::render): `<title>`, `<meta>`, `<link>`, `<base>`, `<style>`, `<script>`, `<noscript>`, and the `<html>` and `<body>` attributes |
| Guarantee | Exactly what unhead's `renderSSRHead` writes, which escapes less than Vue does. A title is escaped as text (`&`, `<`, `>`, `"`, `'` and `/`). An attribute value is double-quoted with only `"` escaped. Attribute names other than `data-` ones are lowered, and names are dropped when empty or holding JavaScript whitespace, `"`, `'`, `<`, `>`, `/`, `=`, a control character or DEL; `__proto__`, `constructor` and `prototype` keys are dropped. A `script` whose type ends in `json`, or is `importmap` or `speculationrules`, has `<` written as `<`. Any other `script`, `style` or `noscript` content is written as it is, with only its own closing tag (`</script`, `</style`, `</noscript`, in any case) written as `<\/…` |
| Code | `tag_into`, `props_into`, `invalid_attr_name`, `sanitize` and `replace_close_tag_into` in `crates/ferrovue/src/head.rs` |
| Tests | `crates/ferrovue/tests/vectors/head.json`: 460 heads recorded from unhead, hand-written ones with markup-breaking values, hostile attribute names and `<!--<script>` in scripts, and 400 drawn at random from hostile values (`packages/ferrovue/test/head-inputs.ts`); the `HeadPage`, `HeadLater` and `HeadNest` hostile fixtures, hydrated by unhead's client |

Where unhead escapes less than a browser needs, the browser reads back something other than the
value: `a&amp;b` in an attribute is read as `a&b`. The fixtures in `UNHEAD_REWRITES`
(`packages/ferrovue/test/conformance-cases.ts`) are those where unhead's client then rewrites the
tag as it hydrates. A value still cannot leave its attribute, since `"` is escaped, or its
`<style>`, `<script>` or `<noscript>`, since the closing tag is.

## `<RouterLink>`

| | |
|---|---|
| Written | The `href` of each link, its active classes, `aria-current` |
| Guarantee | The `href` is what vue-router's `router.resolve(to).href` gives, escaped with `escape_into`. With `{ name, params }`, each parameter is encoded as vue-router encodes it (`/`, `?`, `#` and characters outside a URI percent-encoded); a query built with [`query_into`](crate::query_into) encodes keys and values (`&`, `#`, `+`, `=` in a key, a space as `+`); a hash is encoded. A string `to`, and the `path` of `{ path }`, are kept as written and resolved against the current path when they do not start with `/` |
| Code | `link`, `link_named`, `link_path`, `encode_url` and `parse_url` in `crates/ferrovue-router/src/lib.rs`; `packages/ferrovue/src/plugins/router-link.ts` |
| Tests | `crates/ferrovue-router/tests/vectors/router.json` (recorded from vue-router: hostile parameters, queries and hashes, `javascript:alert(1)`, `https://example.com/` and `//evil.example/x` as a string `to`); `crates/ferrovue-router/tests/properties.rs`; the `Nav` and `Menu` hostile fixtures, `Links/encoded` and `RouteInfo/query-hostile` |

## Translated messages

| | |
|---|---|
| Written | `$t(…)` and `t(…)` from `useI18n()`, and `locale` |
| Guarantee | A message is text. vue-i18n's message compiler turns each locale file into parts at build time; at render, named and list values are put in as they are, as vue-i18n does with its default `escapeParameter: false`, and the whole message is then escaped where it is written, as Vue escapes `{{ $t(…) }}`. `v-html` of a message is refused (FV1502). A missing key renders as the key, escaped |
| Code | `I18n::t` in `crates/ferrovue-i18n/src/lib.rs`; `packages/ferrovue/src/plugins/i18n.ts` |
| Tests | `Translated` and `Plurals` fixtures, whose messages hold `<b>` and `&` and whose hostile fixture passes markup as a value; `crates/ferrovue-i18n/src/tests.rs` |

## `v-html` and trusted HTML

| | |
|---|---|
| Written | `v-html` |
| Guarantee | The only place generated code writes a value unescaped. It is accepted only on a prop typed `TrustedHtml` or `InlineHtml` (FV1502); anything else, a string or a message, is refused at compile time. Such a prop's Rust type implements [`TrustedHtml`](crate::TrustedHtml), whose contract is that every value has been through a sanitiser. ferrovue's own types: [`BasicHtml`](crate::BasicHtml) and [`InlineHtml`](crate::InlineHtml) escape their whole input as `escape_into` does and write back as tags only their fixed lists, exactly spelled, without attributes, balanced; `Sanitised` (the `ammonia` feature) is ammonia's output. Each deserialises by sanitising again, so no JSON makes one that skipped the sanitiser. `v-html` is also refused where the browser's parser would rebuild the HTML (tables, `<select>`, SVG and MathML, block HTML inside a `<p>`: FV1512 and FV1513), which keeps the server's and client's trees the same |
| Code | `trusted_into` in `crates/ferrovue/src/trusted.rs`; `crates/ferrovue/src/basic_html.rs`; `crates/ferrovue/src/sanitised.rs`; the `TrustedHtml` type in `packages/ferrovue/src/typescript.ts`; `packages/ferrovue/src/vhtml.ts`; the `v-html` branch of `packages/ferrovue/src/template.ts` |
| Tests | `crates/ferrovue/src/basic_html/tests.rs` and the `basic_html_*` and `inline_html_*` properties, which parse every output back with html5ever (`crates/ferrovue/tests/sanitised.rs`); `crates/ferrovue/src/sanitised/tests.rs` (scripts, handlers, `javascript:` URLs); the `v-html` tests in `compiler.test.ts`; `Prose` and `InlineProse` fixtures |

A [`TrustedHtml`](crate::TrustedHtml) type of the application's own is outside ferrovue's
guarantee: ferrovue writes what it holds.

## Teleports

| | |
|---|---|
| Written | `<Teleport>` content, collected in [`Teleports`](crate::Teleports) and written by the application where each target is |
| Guarantee | The content is generated markup, escaped as any other. `to` only names the collection the content goes into; it is never written into the page |
| Code | `crates/ferrovue/src/teleport.rs`; `packages/ferrovue/src/plugins/teleport.ts` |
| Tests | `crates/ferrovue/src/teleport/tests.rs`; the teleport fixtures, compared with what Vue's server teleported |

## Holes

| | |
|---|---|
| Written | [`hole`](crate::hole) and [`PageHole`](crate::PageHole) write a marker that [`split_holes`](crate::split_holes) and [`HtmlStream`](crate::HtmlStream) cut the page at |
| Guarantee | No value ferrovue writes holds the marker, so data cannot add or move a hole. The marker is `<fv-hole"</script</style</noscript>`: escaped text and attribute values have no `<`; the state script and page record have none either; unhead's attribute values have no raw `"`, its titles no raw `<`, its JSON scripts no raw `<`, and its other `script`, `style` and `noscript` content cannot hold that element's closing tag; `BasicHtml`, `InlineHtml` and ammonia write tags as a serialiser does, with no `"` after a tag's name. What fills a hole is written as it is |
| Code | `HOLE` in `crates/ferrovue/src/slots.rs`; `HtmlStream::new` in `crates/ferrovue/src/web.rs` |
| Tests | `a_value_in_the_head_cannot_move_a_hole` (`web.rs`), `no_head_value_writes_the_hole_marker` (`crates/ferrovue/src/head/tests.rs`), `no_value_holds_a_hole` (`crates/ferrovue/src/sanitised/tests.rs`); `pages/hostile.json` passes `<fv-hole>` as a prop |

## Scope ids

`data-v-…` attributes are written as they are. They come from the compiler (hashes of the
component's path and source) and reach components through `render_scoped` and
[`Attrs`](crate::Attrs); [`scope_attrs`](crate::scope_attrs) joins them without escaping. Code
that builds an `Attrs` passes the ids generated code gave it, never data.

## Rust twins, helpers and the application's own markup

A Rust twin writes its component's HTML itself, and a helper computes a value the template uses.
ferrovue cannot check either against Vue; the README says so, and their exactness is the
application's assertion. A helper returns a string, number or boolean that generated code escapes
like any other value, so a helper cannot write markup. A twin writes into the page directly, and must
escape what it writes: [`escape_into`](crate::escape_into) for text and values, and
[`attrs_into`](crate::attrs_into) or [`passed_attrs_into`](crate::passed_attrs_into) for the
attributes it is given. The same holds for slot closures, the page around the components and the
content of holes: they are plain Rust, and what they push is written as it is.

## Panics

Generated code and the runtime are written not to panic on props in a release build, and
[SECURITY.md] counts one that does as a vulnerability. A debug build panics
where Vue would throw or where data cannot be written exactly, so a mistake is found where it is
made: props serde_json refuses, a required route parameter that is missing or empty, a plural
number that chooses none of a message's cases. [`Page`](crate::Page) panics on a slot given twice
and on a part written where Vue would give it a slot scope id, which are mistakes in the
application's code. The router is held never to panic by properties over arbitrary locations.

# What ferrovue inherits from Vue

Escaping keeps a value inside its context; it does not judge what the value means there. Vue does
not either, and ferrovue writes what Vue writes, so each of these is left to the application. The
`Unsanitised` conformance component holds the first four to Vue with hostile values.

- **URLs.** A bound `href`, `src`, `action`, `formaction` or similar is written as given: a
  `javascript:` or `data:` URL from a reader stays one. Validate URLs from readers before rendering
  them (allow `https:`, `http:`, `mailto:` and relative ones), as a Vue application would.
- **`srcdoc`.** The value is escaped for the attribute, and the browser decodes it and parses it as
  a whole document: `:srcdoc` of reader input is markup injection. Give it HTML from a sanitiser.
- **Event handler attributes.** An attribute whose name starts `on` and a lower-case letter, such
  as `:onclick="value"` on an element or `onclick` passed to a component and falling through to its
  root, is an attribute to Vue, and its value is written escaped: the browser runs it as script.
  Never bind reader input to one.
- **CSS.** A style value is escaped and not checked: `{ color: value }` with
  `red;position:fixed` adds declarations, and `url(…)` fetches. Bind values from a fixed set, or
  check them.
- **`<script>` and `<style>` elements.** A template that renders one through `<component :is>` and
  interpolates into it writes the value escaped, and escaping does not make script or CSS safe.
- **`<RouterLink>`.** A string `to` that starts with `//`, such as `//evil.example/x`, is a
  protocol-relative URL to another host, as vue-router resolves it. A `to` built from reader input
  should be an object with a `name` and `params`, whose values are encoded.
- **Translated messages in URLs.** A message is text wherever it goes; bound to `:href`, it is a URL
  and may be any URL the message files hold.
- **The page head.** unhead does not check URLs in `href` and `content`. A `script`, `style` or
  `noscript` given reader input is code: in a script other than JSON, `<!--<script>` keeps the
  element open past its closing tag, as unhead writes it, and `noscript` content is HTML to a
  browser running without scripts. Put reader input in `title`, `meta` content and attributes, or
  in a `script` of type `application/ld+json`, whose `<` is escaped.

# For a reviewer

ferrovue's escaping is small, and most of it is a few functions. These hold the guarantee, in the
order a review should take them:

1. `crates/ferrovue-core/src/escape.rs`: `escape_into`, which every value goes through.
2. `crates/ferrovue/src/attrs.rs` and `packages/ferrovue/src/attrs.ts`, `fallthrough.ts` and
   `styles.ts`: attribute names and values, merging, fallthrough. The question: can a name come from
   data, or a value reach a quote unescaped?
3. `crates/ferrovue/src/json.rs`, `state.rs`, `html.rs` and `page.rs`: JSON in an attribute and in a
   script. Can a value close the attribute or the element?
4. `crates/ferrovue/src/trusted.rs`, `basic_html.rs`, `sanitised.rs`, and `packages/ferrovue/src/template.ts`,
   `typescript.ts` and `vhtml.ts`: the one unescaped write, and what may reach it.
5. `crates/ferrovue/src/head.rs`: unhead's rules, reproduced.
6. `crates/ferrovue-router/src/lib.rs`: URL encoding.
7. `crates/ferrovue/src/slots.rs` and `web.rs`: the hole marker.

The compiler's side of each rule is the code that refuses: a construct the compiler cannot
translate exactly is an error with a code ([`error_codes`](crate::guide::error_codes)).
