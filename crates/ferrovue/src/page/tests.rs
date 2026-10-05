use super::*;
use crate::{escape_into, push_number, slot_into, slot_into_slotted};

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
    assert_eq!(crate::split_holes(&out).len(), 1, "{out}");
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
        crate::split_holes(&out),
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
    first.fill([part(&props)]);
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
    crate::hole().render_to(&mut out);
    let mut stream = crate::HtmlStream::new(out)
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
    while let Some(chunk) = std::future::poll_fn(|cx| Pin::new(&mut stream).poll_next(cx)).await {
        sent.push_str(std::str::from_utf8(&chunk.unwrap()).unwrap());
    }
    assert_eq!(
        sent,
        concat!(
            r#"<div id="app"><header><!--[-->T<!--]--></header><main><!--[--><i>slow 1</i><!--]--></main></div>"#,
            r#"<script type="application/json" id="__fv_page">{"props":{"title":"T"},"slots":{"default":[{"c":"Word","p":{"text":"slow","ratio":1.0}}]}}</script>"#,
        )
    );
}
