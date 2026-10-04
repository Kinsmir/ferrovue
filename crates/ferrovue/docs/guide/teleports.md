`<Teleport>`: content rendered somewhere else on the page.

As in Vue's server renderer, a teleport leaves `<!--teleport start-->` and `<!--teleport end-->`
where it stands, and its content goes to its target's buffer. The page writes each target's buffer
inside the target element, after rendering the body, as a Vue server writes
`ssrContext.teleports`.

A component that renders a `<Teleport>`, or a child that does, takes a
[`Teleports`](crate::Teleports) as its last parameter. Build one per page render.

```vue
<!-- Modal.vue -->
<template>
  <div class="host">
    <button>{{ title }}</button>
    <Teleport to="#modals"><div v-if="open" class="modal"><h2>{{ title }}</h2><Teleport to="#modals"><p class="toast">saved</p></Teleport></div></Teleport>
    <Teleport to="#overlay" :disabled="inline"><aside>{{ title }} aside</aside></Teleport>
  </div>
</template>
```

```rust
# #[allow(unused_parens)]
# mod modal {
# use std::borrow::Cow;
# use ferrovue as fv;
# pub struct Props<'a> { pub title: Cow<'a, str>, pub open: bool, pub inline: bool }
# impl<'a> Props<'a> {
#     pub fn new(title: impl Into<Cow<'a, str>>, open: bool, inline: bool) -> Self {
#         Props { title: title.into(), open: open, inline: inline }
#     }
# }
/// Write the component's server render into `out`.
pub fn render(out: &mut String, props: &Props<'_>, fv_teleports: &fv::Teleports) {
    out.reserve(129 + props.title.len());
    out.push_str("<div class=\"host\"><button>");
    fv::escape_into(out, &*props.title);
    out.push_str("</button>");
    fv::teleport_into(out, fv_teleports, "#modals", false, &|out: &mut String| {
        if (props.open) {
            out.push_str("<div class=\"modal\"><h2>");
            fv::escape_into(out, &*props.title);
            out.push_str("</h2>");
            fv::teleport_into(out, fv_teleports, "#modals", false, &|out: &mut String| {
                out.push_str("<p class=\"toast\">saved</p>");
            });
            out.push_str("</div>");
        } else {
            out.push_str("<!---->");
        }
    });
    fv::teleport_into(out, fv_teleports, "#overlay", (props.inline), &|out: &mut String| {
        out.push_str("<aside>");
        fv::escape_into(out, &*props.title);
        out.push_str(" aside</aside>");
    });
    out.push_str("</div>");
}
# }
let teleports = ferrovue::Teleports::new();
let mut body = String::new();
modal::render(&mut body, &modal::Props::new("Delete?", true, false), &teleports);

let mut page = String::from("<body><div id=\"app\">");
page.push_str(&body);
page.push_str("</div><div id=\"modals\">");
page.push_str(&teleports.get("#modals").unwrap_or_default());
page.push_str("</div><div id=\"overlay\">");
page.push_str(&teleports.get("#overlay").unwrap_or_default());
page.push_str("</div></body>");

assert_eq!(
    body,
    r#"<div class="host"><button>Delete?</button><!--teleport start--><!--teleport end--><!--teleport start--><!--teleport end--></div>"#
);
// A nested teleport to the same target comes after its parent, as Vue collects them.
assert_eq!(
    teleports.get("#modals").unwrap(),
    concat!(
        r#"<!--teleport start anchor--><div class="modal"><h2>Delete?</h2><!--teleport start--><!--teleport end--></div><!--teleport anchor-->"#,
        r#"<!--teleport start anchor--><p class="toast">saved</p><!--teleport anchor-->"#,
    )
);
```

[`Teleports::get`](crate::Teleports::get) returns one target's content;
[`Teleports::into_targets`](crate::Teleports::into_targets) every target, in the order they were
first used, for a page that places them generically.

A disabled teleport (`:disabled="true"`) renders its content in place, between the markers, and
leaves empty anchors in its target, which must still be written for the client to hydrate.

# Choosing a target

As Vue recommends, teleport to a dedicated element (`#modals`) rather than to `body`. The browser
hydrates a target from its first node, and `body` also holds the app.
