From nothing to a rendered component.

# 1. Install both halves

The compiler is an npm package, run at build time; this crate is what its output calls at run time.
Use the same version of both.

```sh
pnpm add -D ferrovue                          # or npm / yarn; Node 22.18 or newer
cargo add ferrovue serde --features serde/derive
cargo add --dev serde_json
```

`serde` is needed because every generated props struct derives `serde::Serialize`: an island
carries its props to the client as JSON. `serde_json` is a dev-dependency because the generated
`mod.rs` holds a `#[cfg(test)]` function that renders a component from props written as JSON, for a
project's own conformance tests.

The crate that includes the generated code must use **edition 2024**, because that code uses
let-chains, and the latest stable Rust.

# 2. Configure

`ferrovue.config.json`, at the project root. Paths are relative to it.

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/ferrovue@0.7.0/schema.json",
  "components": "client/components",
  "out": "src/generated",
  "routes": "client/routes.json"
}
```

`$schema` names the configuration's JSON Schema, which every version of the npm package ships as
`schema.json`; `ferrovue init` writes it with the version that runs. VS Code reads it with no
extension or setting: it completes the keys, describes each on hover, and underlines a misspelt
key, a value of the wrong type and a deprecated key. ferrovue does not read `$schema`. Without
network access, point it at the installed package: `"./node_modules/ferrovue/schema.json"`.

| Key | Required | Meaning |
|---|---|---|
| `components` | yes | Directory of `.vue` files to compile |
| `out` | yes | Directory the Rust modules are written to. **Every module ferrovue wrote there is replaced**, and one no component produces any more is removed; a `.rs` file without ferrovue's `// @generated` header is left alone |
| `routes` | no | JSON file listing the app's routes: each a vue-router path, or `{ "path", "name", "children" }`. Needed for `<RouterLink>`, `<RouterView>` and `useRoute()`. See [`routing`](crate::guide::routing) |
| `router` | no | Instead of `routes`: `{ routes, base?, linkActiveClass?, linkExactActiveClass? }`, matching `createWebHistory(base)` and `createRouter`'s options |
| `stores` | no | Directory of Pinia stores whose state components may read. See [`pinia`](crate::guide::pinia) |
| `trustedHtml` | no | Rust path of the type a `TrustedHtml` prop is: `ferrovue::BasicHtml`, `ferrovue::Sanitised` with the `ammonia` feature, or a type of your own such as `crate::html::CleanHtml`. Needed for `v-html`. See [`escaping`](crate::guide::escaping) |
| `helpers` | no | `{ module, functions }`: functions a template may call, each mapped to a Rust twin. See [`errors_and_limits`](crate::guide::errors_and_limits#helpers) |
| `twins` | no | Components ferrovue does not compile, each rendered by a Rust function of yours: `{ "VBtn": { "rust": "crate::ui::v_btn", "props": { "label": "string" }, "slots": ["default"] } }`. See [`errors_and_limits`](crate::guide::errors_and_limits#rust-twins) |
| `i18n` | no | vue-i18n: `{ messages, locale?, fallbackLocale? }`: the directory of locale files (`en.json`, `nl.json`), the default locale and the fallbacks. See [`i18n`](crate::guide::i18n) |
| `clientDirectives` | no | Custom directives with no server output, by name without `v-`: `["focus"]` |
| `scopeId` | no | How a `<style scoped>` id is hashed, as `@vitejs/plugin-vue` hashes it: `"filepath-source"` (the default, the plugin's in a production build) or `"filepath"`. See [`scoped_styles`](crate::guide::scoped_styles) |
| `viteRoot` | no | Vite's root, relative to this file's directory, from which a component's path is hashed for its scope id (default `.`) |
| `isProduction` | no | Whether `@vitejs/plugin-vue` compiles for production, as Vite's `isProduction`: `true` (the default) for `vite build`, `false` for the dev server. It names the variables `v-bind()` in `<style>` sets. See [`scoped_styles`](crate::guide::scoped_styles#v-bind-in-style) |
| `cssModules` | no | `{ generateScopedName, hashPrefix?, context? }`, as Vite's `css.modules` names CSS module classes: needed for `<style module>`. `context` is the directory Vite runs in (default `viteRoot`). See [`scoped_styles`](crate::guide::scoped_styles#css-modules) |
| `builders` | no | `false` leaves out each props struct's and shared type's `new()` and setters, for an app that builds its props as struct literals (default `true`). See [`props`](crate::guide::props#building-props) |

# 3. Write a component

```vue
<!-- client/components/Greeting.vue -->
<script setup lang="ts">
defineProps<{ name: string; unread: number; note?: string }>();
</script>

<template>
  <p class="greeting">Hello, {{ name }}!<b v-if="unread">{{ unread }} new</b><i v-if="note">{{ note }}</i></p>
</template>
```

# 4. Generate

```sh
pnpm ferrovue           # write the modules
pnpm ferrovue --check   # write nothing; exit 1 if the committed modules are stale (for CI)
pnpm ferrovue --watch   # write them, then again on every change
pnpm ferrovue --check --format json  # errors as JSON, for an editor or CI
```

A Vite project can use the plugin in `ferrovue/vite` instead of `--watch`: it regenerates on change
and shows a refused construct in Vite's error overlay. Each error has a stable code; [Editor and CI
diagnostics](#editor-and-ci-diagnostics) describes the JSON output and a VS Code problem matcher.

The compiler writes `src/generated/greeting.rs` and `src/generated/mod.rs`, which declares one
module per component. This is `greeting.rs`, exactly as written (only the reservation is an
estimate the compiler works out per component):

```rust
# mod greeting {
// @generated by ferrovue from components/Greeting.vue. Do not edit: change the `.vue` file and run
// `ferrovue`.

use std::borrow::Cow;

use ferrovue as fv;

/// The component's name, as `data-island` carries it.
pub const NAME: &str = "Greeting";

/// The props `Greeting.vue` declares.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
pub struct Props<'a> {
    #[serde(rename = "name")]
    pub name: Cow<'a, str>,
    #[serde(rename = "unread")]
    pub unread: i64,
    #[serde(rename = "note", default, skip_serializing_if = "Option::is_none")]
    pub note: Option<Cow<'a, str>>,
}

impl<'a> Props<'a> {
    /// Props with its required fields, every optional one absent.
    pub fn new(name: impl Into<Cow<'a, str>>, unread: i64) -> Self {
        Props { name: name.into(), unread, note: None }
    }

    /// Set `note`, which is absent otherwise.
    pub fn note(mut self, note: impl Into<Cow<'a, str>>) -> Self {
        self.note = Some(note.into());
        self
    }
}


/// Write the component's server render into `out`.
pub fn render(out: &mut String, props: &Props<'_>) {
    out.reserve(70 + props.name.len() + props.note.as_deref().map_or(0, str::len));
    out.push_str("<p class=\"greeting\">Hello, ");
    fv::escape_into(out, &props.name);
    out.push('!');
    if props.unread != 0 {
        out.push_str("<b>");
        fv::push_int(out, props.unread);
        out.push_str(" new</b>");
    } else {
        out.push_str("<!---->");
    }
    if let Some(n1) = props.note.as_deref().filter(|v| !v.is_empty()) {
        out.push_str("<i>");
        fv::escape_into(out, n1);
        out.push_str("</i>");
    } else {
        out.push_str("<!---->");
    }
    out.push_str("</p>");
}

/// The component's markup, for a maud page that shows it without hydrating it.
pub fn html<'p, 'a>(props: &'p Props<'a>) -> fv::Html<'p, Props<'a>> {
    fv::Html::markup(props, render)
}

/// The component as an island the client hydrates.
pub fn island<'p, 'a>(props: &'p Props<'a>) -> fv::Html<'p, Props<'a>> {
    fv::Html::island(NAME, props, render)
}

/// [`html`], holding the props: a handler that builds them can return it.
pub fn into_html<'a>(props: Props<'a>) -> fv::Html<'a, Props<'a>> {
    fv::Html::markup_owned(props, render)
}

/// [`island`], holding the props.
pub fn into_island<'a>(props: Props<'a>) -> fv::Html<'a, Props<'a>> {
    fv::Html::island_owned(NAME, props, render)
}
# }
```

Note what the template became: `v-if` is an `if` with Vue's `<!---->` placeholder in the `else`,
the integer is written with [`push_int`](crate::push_int) as JavaScript writes numbers, and every
interpolation goes through [`escape_into`](crate::escape_into).

# 5. Render

Declare the generated module once. `#[rustfmt::skip]` keeps rustfmt from rewriting the files, which
`ferrovue --check` would then report as stale:

```rust
// src/main.rs or src/lib.rs
#[rustfmt::skip]
# /*
mod generated;
# */
# mod generated { pub mod greeting { pub struct Props; } }

use generated::greeting::{self, Props};
```

Then build the props and render:

```rust
# mod generated { pub mod greeting {
# // @generated by ferrovue from components/Greeting.vue. Do not edit: change the `.vue` file and run
# // `ferrovue`.
#
# use std::borrow::Cow;
#
# use ferrovue as fv;
#
# /// The component's name, as `data-island` carries it.
# pub const NAME: &str = "Greeting";
#
# /// The props `Greeting.vue` declares.
# #[derive(Debug, Clone, serde::Serialize)]
# #[cfg_attr(test, derive(serde::Deserialize))]
# pub struct Props<'a> {
#     #[serde(rename = "name")]
#     pub name: Cow<'a, str>,
#     #[serde(rename = "unread")]
#     pub unread: i64,
#     #[serde(rename = "note", default, skip_serializing_if = "Option::is_none")]
#     pub note: Option<Cow<'a, str>>,
# }
#
# impl<'a> Props<'a> {
#     /// Props with its required fields, every optional one absent.
#     pub fn new(name: impl Into<Cow<'a, str>>, unread: i64) -> Self {
#         Props { name: name.into(), unread, note: None }
#     }
#
#     /// Set `note`, which is absent otherwise.
#     pub fn note(mut self, note: impl Into<Cow<'a, str>>) -> Self {
#         self.note = Some(note.into());
#         self
#     }
# }
#
#
# /// Write the component's server render into `out`.
# pub fn render(out: &mut String, props: &Props<'_>) {
#     out.reserve(70 + props.name.len() + props.note.as_deref().map_or(0, str::len));
#     out.push_str("<p class=\"greeting\">Hello, ");
#     fv::escape_into(out, &props.name);
#     out.push('!');
#     if props.unread != 0 {
#         out.push_str("<b>");
#         fv::push_int(out, props.unread);
#         out.push_str(" new</b>");
#     } else {
#         out.push_str("<!---->");
#     }
#     if let Some(n1) = props.note.as_deref().filter(|v| !v.is_empty()) {
#         out.push_str("<i>");
#         fv::escape_into(out, n1);
#         out.push_str("</i>");
#     } else {
#         out.push_str("<!---->");
#     }
#     out.push_str("</p>");
# }
#
# /// The component's markup, for a maud page that shows it without hydrating it.
# pub fn html<'p, 'a>(props: &'p Props<'a>) -> fv::Html<'p, Props<'a>> {
#     fv::Html::markup(props, render)
# }
#
# /// The component as an island the client hydrates.
# pub fn island<'p, 'a>(props: &'p Props<'a>) -> fv::Html<'p, Props<'a>> {
#     fv::Html::island(NAME, props, render)
# }
# } }
# use generated::greeting::{self, Props};
// Borrowed strings cost nothing; owned ones (a `String` from a database) work as well.
let user = String::from("Ada");
let props = Props::new(user.as_str(), 3);

// Into a buffer the page is already being written to.
let mut page = String::from("<!doctype html><html><body>");
greeting::render(&mut page, &props);
page.push_str("</body></html>");
assert_eq!(
    page,
    r#"<!doctype html><html><body><p class="greeting">Hello, Ada!<b>3 new</b><!----></p></body></html>"#
);

// As an island the client hydrates from its own props.
let island = greeting::island(&props).into_string();
assert_eq!(
    island,
    concat!(
        r#"<div data-island="Greeting" data-props="{&quot;name&quot;:&quot;Ada&quot;,&quot;unread&quot;:3}">"#,
        r#"<p class="greeting">Hello, Ada!<b>3 new</b><!----></p></div>"#,
    )
);
```

# Editor and CI diagnostics

Every error has a stable code, `FV` and four digits, listed in
[`error_codes`](crate::guide::error_codes). The CLI writes it first, then the file, line and column,
the message, the line quoted with a caret, and where the code is documented:

```text
error[FV0602]: components/Card.vue:4:17: `.toPrecision()` is not supported
 4 | <template><p>{{ n.toPrecision(2) }}</p></template>
   |                 ^
 = docs: https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0602
```

`--format json` writes one JSON object per run to standard output instead, for an editor, a CI
annotation or a script; the exit status is the same as without it:

```sh
pnpm ferrovue --check --format json
pnpm ferrovue --format json
```

```json
{
  "diagnostics": [
    {
      "file": "components/Card.vue",
      "line": 4,
      "column": 17,
      "endLine": null,
      "endColumn": null,
      "code": "FV0602",
      "severity": "error",
      "title": "Unsupported method",
      "message": "`.toPrecision()` is not supported",
      "docs": "https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html#fv0602"
    }
  ]
}
```

Lines and columns count from 1, and the end is exclusive. A field the compiler does not know is
`null`: the end is known for a construct in `<script setup>`, the line and column for most errors
in a `.vue` file, and only the file for a configuration, locale or routes file. A file that does not
parse has the code `FV0001` and the parser's message. The compiler stops at the
first error, so `diagnostics` holds one error at most today. A warning, such as one for a deprecated
configuration key (`FV1117`) or command-line option (`FV1118`), is a diagnostic with the
`severity` `"warning"`, listed before the error, and does not change the exit status; without
`--format json` it is written to standard error as `warning[FV1117]: …`. A run that succeeds adds `out`, `files`,
`changed` and `removed`; `--check` adds `out`, `stale` and `notGenerated`, the modules it would
rewrite or remove. `--format json` does not combine with `--diff`.

In VS Code, a task with these problem matchers puts each error of a run in the Problems panel and
underlines it in the file; the plugin in [the next section](#diagnostics-in-your-editor) shows them
as you type. Add the task to `.vscode/tasks.json` and run it with **Tasks: Run Task**:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "ferrovue",
      "type": "shell",
      "command": "pnpm exec ferrovue",
      "group": "build",
      "problemMatcher": [
        {
          "owner": "ferrovue",
          "source": "ferrovue",
          "fileLocation": ["relative", "${workspaceFolder}"],
          "pattern": {
            "regexp": "^error\\[(FV\\d{4})\\]: ([^:]+):(\\d+):(\\d+): (.*)$",
            "code": 1,
            "file": 2,
            "line": 3,
            "column": 4,
            "message": 5
          }
        },
        {
          "owner": "ferrovue",
          "source": "ferrovue",
          "fileLocation": ["relative", "${workspaceFolder}"],
          "pattern": {
            "regexp": "^error\\[(FV\\d{4})\\]: ([^:]+\\.(?:vue|ts|json)): (.*)$",
            "kind": "file",
            "code": 1,
            "file": 2,
            "message": 3
          }
        }
      ]
    }
  ]
}
```

The first matcher reads an error at a line and column; the second one an error in a whole file, as
in a locale file. Run the task from the directory that holds `ferrovue.config.json`, or set the
task's `options.cwd` and `fileLocation` to it.

# Diagnostics in your editor

`ferrovue/volar` is a plugin for Vue's language tools, the language server that the Vue (Official)
extension for VS Code and Vue support in other editors run. While you edit a component, it compiles
the project with the editor's text of that component in place of the file, and shows what ferrovue
refuses in it where the editor shows Vue's own template errors: underlined, with the error's code,
which links to the code's entry in [`error_codes`](crate::guide::error_codes).

Name the plugin in `vueCompilerOptions` in the `tsconfig.json` whose `include` covers the
components, then run **Vue: Restart Vue and TS servers** from the command palette (or reload the
window):

```json
{
  "include": ["components/**/*.vue", "components/**/*.ts"],
  "vueCompilerOptions": {
    "plugins": ["ferrovue/volar"]
  }
}
```

A refused `{{ n.toPrecision(2) }}` is then underlined at `n`, and its hover and the Problems panel
read:

```text
ferrovue: `.toPrecision()` is not supported  vue(FV0602)
```

where `FV0602` opens the error's documentation.

- An error in the template is underlined on the construct. Vue's language server checks the inside
  of `<script setup>` and `<style>` through TypeScript and CSS only, so an error there is underlined
  on the block's opening tag, as `<script setup lang="ts">`, and its message ends with its line and
  column, as `(at 2:21)`. An error about the whole component is at its start.
- The plugin finds the project from the component: the nearest directory above it that holds
  `ferrovue.config.json`. A configuration file of another name or place is named with `config`,
  relative to the project root, as `--config` takes it:
  `"plugins": [{ "name": "ferrovue/volar", "config": "config/ferrovue.json" }]`.
- The compiler stops at the first error in the project, so while one component has an error, the
  others show none. A component is checked again each time its text changes: after an edit to a
  store, a shared type or another component, the open component shows the result on its next edit.
- The error's code carries its link in the form VS Code reads. For an editor that shows that form
  wrongly, `"codeLinks": false` gives the code as text and puts the link at the end of the message.
- TypeScript's server and `vue-tsc` load the same plugins; this one does nothing in them, so
  `vue-tsc` does not report these errors. In CI, run `ferrovue --check`.
- The plugin needs `@vue/language-core` 3.3 or newer, the version of Vue (Official) 3.3. Vue's
  language tools load it with `require`, which loads an ES module on Node.js 22.12 or newer; the
  language server runs on the editor's own Node.js.

From here:

- [`generated_code`](crate::guide::generated_code) describes every module the compiler writes;
- [`islands_and_hydration`](crate::guide::islands_and_hydration) is the client side;
- the repository's
  [`examples/fullstack`](https://github.com/Kinsmir/ferrovue/tree/main/examples/fullstack) is a
  complete axum server and Vite client to copy.
