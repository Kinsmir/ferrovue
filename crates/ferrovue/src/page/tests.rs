use super::*;
use crate::render::{slot_into, slot_into_slotted};
use ferrovue_core::{escape_into, push_number};

#[derive(Serialize)]
struct WordProps<'a> {
    text: &'a str,
    ratio: f64,
}

fn word(out: &mut String, props: &WordProps<'_>) {
    out.push_str("<i>");
    escape_into(out, props.text);
    out.push(' ');
    push_number(out, props.ratio);
    out.push_str("</i>");
}

fn part<'p>(props: &'p WordProps<'p>) -> Part<'p> {
    Part::new("Word", Html::markup(props, word))
}

#[derive(Serialize)]
struct LayoutProps<'a> {
    title: &'a str,
}

#[derive(Clone, Copy, Default)]
struct Slots<'s> {
    head: Option<Slot<'s>>,
    default: Option<Slot<'s>>,
}

fn layout<'p>(
    props: &'p LayoutProps<'p>,
    slots: Slots<'p>,
    slotted: &'static str,
) -> Html<'p, LayoutProps<'p>, impl Fn(&mut String, &LayoutProps<'p>) + 'p> {
    Html::markup(props, move |out: &mut String, props: &LayoutProps<'_>| {
        out.push_str("<header>");
        slot_into(
            out,
            slots.head,
            Some(&mut |out: &mut String| escape_into(out, props.title)),
        );
        out.push_str("</header><main>");
        slot_into_slotted(
            out,
            slots.default,
            slotted,
            Some(&mut |out: &mut String| out.push_str("empty")),
        );
        out.push_str("</main>");
    })
}

fn script_body<'s>(html: &'s str, id: &str) -> &'s str {
    let open = format!(r#"<script type="application/json" id="{id}">"#);
    let start = html.find(&open).expect("the record's script") + open.len();
    let end = html[start..].find("</script>").expect("its end") + start;
    &html[start..end]
}

#[test]
fn a_page_records_each_slot_s_parts_with_the_props_that_wrote_them() {
    let (a, b) = (
        WordProps {
            text: "one",
            ratio: 1.5,
        },
        WordProps {
            text: "two",
            ratio: 2.0,
        },
    );
    let mut page = Page::new();
    let head = page.slot("head", [part(&a)]);
    let body = page.slot("default", [part(&a), part(&b)]);
    let mut out = String::new();
    let slots = Slots {
        head: Some(head.slot()),
        default: Some(body.slot()),
    };
    let record = page.render_to(&mut out, layout(&LayoutProps { title: "T" }, slots, ""));
    record.script_into(&mut out, "__fv_page");
    assert_eq!(
        out,
        concat!(
            "<header><!--[--><i>one 1.5</i><!--]--></header><main><!--[--><i>one 1.5</i><i>two 2</i><!--]--></main>",
            r#"<script type="application/json" id="__fv_page">{"props":{"title":"T"},"slots":{"head":[{"c":"Word","p":{"text":"one","ratio":1.5}}],"#,
            r#""default":[{"c":"Word","p":{"text":"one","ratio":1.5}},{"c":"Word","p":{"text":"two","ratio":2.0}}]}}</script>"#,
        )
    );
}

#[test]
fn the_record_cannot_be_closed_by_a_prop_and_reads_back_whole() {
    let hostile = "</script><script>alert(1)</script><!--<fv-hole>&\u{2028}\u{2029}'\"";
    let props = WordProps {
        text: hostile,
        ratio: 0.0,
    };
    let mut page = Page::new();
    let body = page.slot(hostile, [part(&props)]);
    let mut out = String::new();
    let slots = Slots {
        head: None,
        default: Some(body.slot()),
    };
    let record = page.render_to(&mut out, layout(&LayoutProps { title: hostile }, slots, ""));
    record.script_into(&mut out, "a\"b");
    assert_eq!(crate::page::split_holes(&out).len(), 1, "{out}");
    let body = script_body(&out, "a&quot;b");
    assert!(
        !body.contains(['<', '>', '&', '\u{2028}', '\u{2029}']),
        "{body}"
    );
    let read: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(
        read,
        serde_json::json!({
            "props": { "title": hostile },
            "slots": { hostile: [{ "c": "Word", "p": { "text": hostile, "ratio": 0.0 } }] },
        })
    );
}

#[test]
fn numbers_json_cannot_carry_are_recorded_as_javascript_writes_them() {
    let props =
        [f64::NAN, f64::INFINITY, f64::NEG_INFINITY].map(|ratio| WordProps { text: "", ratio });
    let mut page = Page::new();
    let body = page.slot("default", props.iter().map(part));
    let mut out = String::new();
    let slots = Slots {
        head: None,
        default: Some(body.slot()),
    };
    let record = page.render_to(&mut out, layout(&LayoutProps { title: "" }, slots, ""));
    out.clear();
    record.script_into(&mut out, "p");
    assert!(
        out.contains(r#""p":{"text":"","ratio":NaN}},{"c":"Word","p":{"text":"","ratio":Infinity}},{"c":"Word","p":{"text":"","ratio":-Infinity}}"#),
        "{out}"
    );
}

#[test]
fn props_serde_json_refuses_are_recorded_as_null_and_the_record_still_reads() {
    #[derive(Serialize)]
    struct ByList {
        scores: std::collections::BTreeMap<Vec<i64>, f64>,
    }
    fn nothing(_: &mut String, _: &ByList) {}
    let by_list = ByList {
        scores: [(vec![1], 2.0)].into_iter().collect(),
    };
    let props = WordProps {
        text: "ok",
        ratio: 1.0,
    };
    let mut page = Page::new();
    let body = page.slot(
        "default",
        [
            Part::new("ByList", Html::markup(&by_list, nothing)),
            part(&props),
        ],
    );
    let slots = Slots {
        head: None,
        default: Some(body.slot()),
    };
    let mut out = String::new();
    let record = page.render_to(
        &mut out,
        Html::markup(&by_list, |out: &mut String, _: &ByList| {
            slot_into(out, slots.default, None);
        }),
    );
    out.clear();
    record.script_into(&mut out, "p");
    let read: serde_json::Value = serde_json::from_str(script_body(&out, "p")).unwrap();
    assert_eq!(
        read,
        serde_json::json!({
            "props": null,
            "slots": { "default": [
                { "c": "ByList", "p": null },
                { "c": "Word", "p": { "text": "ok", "ratio": 1.0 } },
            ] },
        })
    );
}

#[test]
fn an_island_is_written_without_its_wrapper() {
    let props = WordProps {
        text: "w",
        ratio: 1.0,
    };
    let mut page = Page::new();
    let body = page.slot(
        "default",
        [Part::new("Word", Html::island("Word", &props, word))],
    );
    let mut out = String::new();
    body.slot().render_to(&mut out);
    assert_eq!(out, "<i>w 1</i>");
    drop(page);
}

#[test]
fn a_page_returns_the_first_refusal_of_its_slots_parts() {
    fn refuse(out: &mut String, props: &WordProps<'_>) -> Result<(), Refused> {
        word(out, props);
        crate::render::try_int(props.ratio).map(drop)
    }
    let (early, late) = (
        WordProps {
            text: "a",
            ratio: 1e20,
        },
        WordProps {
            text: "b",
            ratio: 2e20,
        },
    );
    let mut page = Page::new();
    let body = page.slot(
        "default",
        [
            part(&early),
            Part::new("Word", Html::markup_fallible(&early, word, refuse)),
            Part::new("Word", Html::markup_fallible(&late, word, refuse)),
        ],
    );
    let slots = Slots {
        head: None,
        default: Some(body.slot()),
    };
    let mut out = String::from("kept");
    let refused = page
        .try_render_to(&mut out, layout(&LayoutProps { title: "T" }, slots, ""))
        .unwrap_err();
    assert_eq!(refused.code(), "FV0724");
    assert!(
        refused
            .message()
            .starts_with("the number 100000000000000000000 "),
        "{refused}"
    );
    assert_eq!(out, "kept");
}

#[test]
fn a_slot_given_no_parts_is_still_content_and_recorded_empty() {
    let mut page = Page::new();
    let body = page.slot("default", []);
    let mut out = String::new();
    let slots = Slots {
        head: None,
        default: Some(body.slot()),
    };
    let record = page.render_to(&mut out, layout(&LayoutProps { title: "T" }, slots, ""));
    assert_eq!(
        out,
        "<header><!--[-->T<!--]--></header><main><!--[--><!--]--></main>"
    );
    out.clear();
    record.script_into(&mut out, "p");
    assert!(out.contains(r#""slots":{"default":[]}"#), "{out}");
}

#[test]
fn a_slot_written_twice_is_recorded_once() {
    let props = WordProps {
        text: "w",
        ratio: 1.0,
    };
    let mut page = Page::new();
    let body = page.slot("default", [part(&props)]);
    let mut out = String::new();
    let slots = Slots {
        head: Some(body.slot()),
        default: Some(body.slot()),
    };
    let record = page.render_to(&mut out, layout(&LayoutProps { title: "T" }, slots, ""));
    assert_eq!(out.matches("<i>w 1</i>").count(), 2, "{out}");
    out.clear();
    record.script_into(&mut out, "p");
    assert_eq!(out.matches(r#""c":"Word""#).count(), 1, "{out}");
}

#[test]
#[should_panic(expected = "the page already has a slot called \"default\"")]
fn a_slot_is_given_once() {
    let mut page = Page::new();
    let _first = page.slot("default", []);
    let _hole = page.hole("default");
}

#[test]
#[should_panic(expected = "slot scope id data-v-1-s")]
fn a_part_is_refused_where_vue_would_give_it_a_slot_scope_id() {
    let mut page = Page::new();
    let body = page.slot("default", []);
    let slots = Slots {
        head: None,
        default: Some(body.slot()),
    };
    let _ = page.render_to(
        &mut String::new(),
        layout(&LayoutProps { title: "T" }, slots, "data-v-1-s"),
    );
}

#[test]
fn the_record_names_its_components_once_as_its_slots_and_holes_are_given_them() {
    let props = WordProps {
        text: "w",
        ratio: 1.0,
    };
    let other = |props| Part::new("Other", Html::markup(props, word));
    let mut page = Page::new();
    let head = page.slot("head", [part(&props), other(&props), part(&props)]);
    let late = page.hole("default");
    let mut out = String::new();
    let slots = Slots {
        head: Some(head.slot()),
        default: Some(late.slot()),
    };
    let record = page.render_to(&mut out, layout(&LayoutProps { title: "T" }, slots, ""));
    assert_eq!(record.island_names(), ["Word", "Other"]);
    let parts = [Part::new("Late", Html::markup(&props, word)), part(&props)];
    assert_eq!(
        parts.iter().map(Part::name).collect::<Vec<_>>(),
        ["Late", "Word"]
    );
    let _ = late.fill(parts);
    assert_eq!(record.island_names(), ["Word", "Other", "Late"]);
}

#[test]
fn a_hole_is_recorded_once_it_is_filled_or_dropped() {
    let props = WordProps {
        text: "late",
        ratio: 3.0,
    };
    let mut page = Page::new();
    let late = page.hole("default");
    let never = page.hole("head");
    let mut out = String::new();
    let slots = Slots {
        head: Some(never.slot()),
        default: Some(late.slot()),
    };
    let record = page.render_to(&mut out, layout(&LayoutProps { title: "T" }, slots, ""));
    assert_eq!(
        crate::page::split_holes(&out),
        [
            "<header><!--[-->",
            "<!--]--></header><main><!--[-->",
            "<!--]--></main>"
        ]
    );
    assert_eq!(late.fill([part(&props)]), "<i>late 3</i>");
    drop(never);
    out.clear();
    record.script_into(&mut out, "p");
    assert!(
        out.contains(
            r#""slots":{"default":[{"c":"Word","p":{"text":"late","ratio":3.0}}],"head":[]}"#
        ),
        "{out}"
    );
}

#[derive(Default)]
struct Woken(std::sync::atomic::AtomicBool);

impl std::task::Wake for Woken {
    fn wake(self: Arc<Self>) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

impl Woken {
    fn take(&self) -> bool {
        self.0.swap(false, std::sync::atomic::Ordering::SeqCst)
    }
}

#[test]
fn a_waiting_record_is_woken_once_its_last_hole_closes() {
    let props = WordProps {
        text: "late",
        ratio: 1.0,
    };
    let mut page = Page::new();
    let first = page.hole("default");
    let second = page.hole("head");
    let record = page.render_to(
        &mut String::new(),
        layout(&LayoutProps { title: "T" }, Slots::default(), ""),
    );
    let woken = Arc::new(Woken::default());
    let waker = Waker::from(Arc::clone(&woken));
    let mut cx = Context::from_waker(&waker);
    let mut script = std::pin::pin!(record.script("p"));
    assert!(script.as_mut().poll(&mut cx).is_pending());
    let _ = first.fill([part(&props)]);
    assert!(!woken.take());
    assert!(script.as_mut().poll(&mut cx).is_pending());
    drop(second);
    assert!(woken.take());
    let Poll::Ready(out) = script.as_mut().poll(&mut cx) else {
        panic!("the record is written once every hole is closed");
    };
    assert!(
        out.contains(
            r#""slots":{"default":[{"c":"Word","p":{"text":"late","ratio":1.0}}],"head":[]}"#
        ),
        "{out}"
    );
}

#[test]
fn a_page_s_parts_show_what_they_record_in_debug() {
    let props = WordProps {
        text: "a",
        ratio: 1.0,
    };
    assert_eq!(
        format!("{:?}", part(&props)),
        r#"Part { name: "Word", props: "{\"text\":\"a\",\"ratio\":1.0}", .. }"#
    );
    let mut page = Page::new();
    let slot = page.slot("head", [part(&props)]);
    let hole = page.hole("default");
    assert_eq!(format!("{slot:?}"), "PageSlot { .. }");
    assert_eq!(format!("{hole:?}"), "PageHole { index: 1, open: true, .. }");
}

#[test]
#[should_panic(expected = "a hole of the page is not filled yet")]
fn a_page_with_a_hole_open_is_not_written_at_once() {
    let mut page = Page::new();
    let _hole = page.hole("default");
    let record = page.render_to(
        &mut String::new(),
        layout(&LayoutProps { title: "T" }, Slots::default(), ""),
    );
    record.script_into(&mut String::new(), "p");
}

#[cfg(feature = "stream")]
#[tokio::test(start_paused = true)]
async fn a_streamed_page_writes_its_record_after_its_holes() {
    use std::time::Duration;

    use futures_core::Stream;

    let mut page = Page::new();
    let late = page.hole("default");
    let mut out = String::from(r#"<div id="app">"#);
    let slots = Slots {
        head: None,
        default: Some(late.slot()),
    };
    let record = page.render_to(&mut out, layout(&LayoutProps { title: "T" }, slots, ""));
    out.push_str("</div>");
    crate::page::hole().render_to(&mut out);
    let mut stream = crate::web::HtmlStream::new(out)
        .hole(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let text = String::from("slow");
            late.fill([Part::new(
                "Word",
                Html::markup_owned(
                    WordProps {
                        text: &text,
                        ratio: 1.0,
                    },
                    word,
                ),
            )])
        })
        .hole(record.script("__fv_page"));
    let mut sent = String::new();
    tokio::time::timeout(Duration::from_secs(60), async {
        while let Some(chunk) = std::future::poll_fn(|cx| Pin::new(&mut stream).poll_next(cx)).await
        {
            sent.push_str(std::str::from_utf8(&chunk.unwrap()).unwrap());
        }
    })
    .await
    .expect("the stream ends once the record is written");
    assert_eq!(
        sent,
        concat!(
            r#"<div id="app"><header><!--[-->T<!--]--></header><main><!--[--><i>slow 1</i><!--]--></main></div>"#,
            r#"<script type="application/json" id="__fv_page">{"props":{"title":"T"},"slots":{"default":[{"c":"Word","p":{"text":"slow","ratio":1.0}}]}}</script>"#,
        )
    );
}

#[test]
fn the_record_carries_where_the_layout_and_each_part_hold_dates() {
    let words = [
        WordProps {
            text: "a",
            ratio: 1.0,
        },
        WordProps {
            text: "b",
            ratio: 2.0,
        },
    ];
    let mut page = Page::new();
    let parts = page.slot(
        "default",
        [
            Part::new("Word", Html::markup(&words[0], word).dates(r#"[{"at":1}]"#)),
            part(&words[1]),
        ],
    );
    let props = LayoutProps { title: "t" };
    let mut out = String::new();
    let slots = Slots {
        head: None,
        default: Some(parts.slot()),
    };
    let record = page.render_to(&mut out, layout(&props, slots, "").dates("[[1]]"));
    record.script_into(&mut out, "r");
    assert_eq!(
        script_body(&out, "r"),
        concat!(
            r#"{"props":{"title":"t"},"slots":{"default":[{"c":"Word","p":{"text":"a","ratio":1.0},"d":[{"at":1}]},"#,
            r#"{"c":"Word","p":{"text":"b","ratio":2.0}}]},"dates":[[1]]}"#
        )
    );
}

mod chunks {
    use super::*;

    const MANIFEST: &str = r#"{
        "client/main.ts": { "file": "assets/main.js", "isEntry": true, "css": ["assets/main.css"], "dynamicImports": ["client/app.ts"] },
        "client/app.ts": { "file": "assets/app.js", "isDynamicEntry": true, "imports": ["_vue.js"], "dynamicImports": ["client/components/Cart.vue", "client/components/Reviews.vue"] },
        "client/components/Cart.vue": { "file": "assets/Cart.js", "isDynamicEntry": true, "imports": ["_vue.js", "_money.js", "client/main.ts"] },
        "client/components/Reviews.vue": { "file": "assets/Reviews.js", "isDynamicEntry": true, "imports": ["_vue.js"], "dynamicImports": ["client/components/Stars.vue"] },
        "client/components/Stars.vue": { "file": "assets/Stars.js", "isDynamicEntry": true },
        "_money.js": { "file": "assets/money.js", "imports": ["_vue.js"] },
        "_vue.js": { "file": "assets/vue.js" }
    }"#;

    const ISLANDS: &str = r#"{
        "Cart": "assets/Cart.js",
        "Reviews": "assets/Reviews.js",
        "Unbuilt": "assets/Unbuilt.js"
    }"#;

    fn chunks() -> Chunks {
        Chunks::from_manifest(MANIFEST, ISLANDS).unwrap()
    }

    #[test]
    fn an_island_needs_its_chunk_and_what_it_imports_but_never_the_entry() {
        assert_eq!(
            chunks().for_islands(["Cart"]),
            ["/assets/Cart.js", "/assets/vue.js", "/assets/money.js"]
        );
    }

    #[test]
    fn dynamic_imports_are_left_to_load_when_asked_for() {
        assert_eq!(
            chunks().for_islands(["Reviews"]),
            ["/assets/Reviews.js", "/assets/vue.js"]
        );
    }

    #[test]
    fn islands_sharing_a_chunk_need_it_once() {
        assert_eq!(
            chunks().for_islands(["Reviews", "Cart", "Reviews"]),
            [
                "/assets/Reviews.js",
                "/assets/vue.js",
                "/assets/Cart.js",
                "/assets/money.js"
            ]
        );
    }

    #[test]
    fn names_that_are_no_built_island_need_nothing() {
        assert!(chunks().for_islands(["Unbuilt", "Nowhere"]).is_empty());
    }

    #[test]
    fn the_app_the_entry_loads_dynamically() {
        assert_eq!(
            chunks().for_source("client/app.ts"),
            ["/assets/app.js", "/assets/vue.js"]
        );
        assert!(chunks().for_source("client/main.ts").is_empty());
        assert!(chunks().for_source("client/missing.ts").is_empty());
    }

    #[test]
    fn the_files_are_served_under_the_base() {
        assert_eq!(
            chunks().with_base("/static/").for_islands(["Reviews"]),
            ["/static/assets/Reviews.js", "/static/assets/vue.js"]
        );
    }

    #[test]
    fn a_page_links_each_url_once_across_head_and_body() {
        let chunks = chunks().with_base("/a&b/");
        let mut preloads = chunks.preloads();
        let mut head = String::new();
        preloads.source_into(&mut head, "client/app.ts");
        preloads.islands_into(&mut head, ["Reviews"]);
        let mut body = String::new();
        preloads.islands_into(&mut body, ["Cart", "Reviews"]);
        assert_eq!(
            head,
            concat!(
                r#"<link rel="modulepreload" href="/a&amp;b/assets/app.js">"#,
                r#"<link rel="modulepreload" href="/a&amp;b/assets/vue.js">"#,
                r#"<link rel="modulepreload" href="/a&amp;b/assets/Reviews.js">"#,
            )
        );
        assert_eq!(
            body,
            concat!(
                r#"<link rel="modulepreload" href="/a&amp;b/assets/Cart.js">"#,
                r#"<link rel="modulepreload" href="/a&amp;b/assets/money.js">"#,
            )
        );
    }

    #[test]
    fn an_island_bundled_into_a_shared_chunk_is_found_by_its_file() {
        let manifest = r#"{
            "client/main.ts": { "file": "assets/main.js", "isEntry": true, "dynamicImports": ["_Badge-1.js", "client/components/Card.vue"] },
            "client/components/Card.vue": { "file": "assets/Card-2.js", "isDynamicEntry": true, "imports": ["_Badge-1.js"] },
            "_Badge-1.js": { "file": "assets/Badge-1.js", "name": "Badge", "imports": ["client/main.ts"] }
        }"#;
        let islands = r#"{ "Badge": "assets/Badge-1.js", "Card": "assets/Card-2.js" }"#;
        let chunks = Chunks::from_manifest(manifest, islands).unwrap();
        assert_eq!(chunks.for_islands(["Badge"]), ["/assets/Badge-1.js"]);
        assert_eq!(
            chunks.for_islands(["Card", "Badge"]),
            ["/assets/Card-2.js", "/assets/Badge-1.js"]
        );
    }

    #[test]
    fn what_is_not_a_manifest_is_refused() {
        let error = Chunks::from_manifest(r#"{"a.js": {"imports": []}}"#, ISLANDS).unwrap_err();
        assert!(
            error
                .to_string()
                .starts_with("not a Vite manifest: missing field `file`"),
            "{error}"
        );
        let source = std::error::Error::source(&error).map(ToString::to_string);
        assert!(
            source
                .as_deref()
                .is_some_and(|s| s.starts_with("missing field `file`")),
            "{source:?}"
        );
        assert!(Chunks::from_manifest("[", ISLANDS).is_err());
        let error = Chunks::from_manifest(MANIFEST, r#"{"Cart": 1}"#).unwrap_err();
        assert!(
            error.to_string().starts_with("not ferrovue's islands: "),
            "{error}"
        );
    }
}

mod teleport {
    use super::*;

    #[test]
    fn teleported_content_goes_to_its_target_in_the_order_vue_collects_it() {
        let teleports = Teleports::new();
        let mut out = String::from("<main>");
        teleport_into(
            &mut out,
            &teleports,
            "#modals",
            false,
            &|out: &mut String| {
                out.push_str("<div>outer");
                teleport_into(out, &teleports, "#modals", false, &|out: &mut String| {
                    out.push_str("<p>inner</p>")
                });
                out.push_str("</div>");
            },
        );
        teleport_into(&mut out, &teleports, "body", true, &|out: &mut String| {
            out.push_str("<i>here</i>")
        });
        out.push_str("</main>");
        assert_eq!(
            out,
            "<main><!--teleport start--><!--teleport end--><!--teleport start--><i>here</i><!--teleport end--></main>"
        );
        assert_eq!(
            teleports.get("#modals").unwrap(),
            "<!--teleport start anchor--><div>outer<!--teleport start--><!--teleport end--></div><!--teleport anchor--><!--teleport start anchor--><p>inner</p><!--teleport anchor-->"
        );
        assert_eq!(
            teleports.get("body").unwrap(),
            "<!--teleport start anchor--><!--teleport anchor-->"
        );
        assert_eq!(teleports.into_targets().len(), 2);
    }
}

mod state {
    use super::*;

    #[test]
    fn the_state_scripts_numbers_that_are_not_finite_are_written_as_javascript_writes_them() {
        let mut out = String::new();
        state_script_into(&mut out, "s", &[f64::NAN, f64::INFINITY, 1.0]);
        assert_eq!(
            out,
            r#"<script type="application/json" id="s">[NaN,Infinity,1.0]</script>"#
        );
    }

    #[test]
    fn the_state_script_cannot_be_closed_by_a_value_and_reads_back_whole() {
        let state = serde_json::json!({ "prefs": { "label": "</script><script>alert(1)</script>&\u{2028}" } });
        let mut out = String::new();
        state_script_into(&mut out, "__pinia", &state);
        let body = out
            .strip_prefix(r#"<script type="application/json" id="__pinia">"#)
            .and_then(|b| b.strip_suffix("</script>"))
            .expect("one script element");
        assert!(!body.contains(['<', '>', '&', '\u{2028}']), "{body}");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(body).unwrap(),
            state
        );
    }

    #[test]
    fn the_state_script_escapes_exactly_the_two_line_separators() {
        let state = serde_json::json!(["a\u{2029}b\u{2028}c\u{2069}\u{2027}\u{2029}"]);
        let mut out = String::new();
        state_script_into(&mut out, "s", &state);
        assert_eq!(
            out,
            "<script type=\"application/json\" id=\"s\">[\"a\\u2029b\\u2028c\u{2069}\u{2027}\\u2029\"]</script>"
        );
    }

    #[test]
    fn the_state_script_id_is_escaped() {
        let mut out = String::new();
        state_script_into(&mut out, "a\"b", &serde_json::json!({}));
        assert_eq!(
            out,
            r#"<script type="application/json" id="a&quot;b">{}</script>"#
        );
    }
}
