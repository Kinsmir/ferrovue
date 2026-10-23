use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::time::{Instant, sleep};

use super::*;

struct Args(Vec<Arg>);

enum Arg {
    Str(&'static str),
    Int(i64),
    Float(f64),
    Bool(bool),
    Null,
}

impl Load for Args {
    const NAME: &'static str = "f";
    type Output = ();
    fn args(&self, key: &mut LoadKey) {
        for arg in &self.0 {
            match arg {
                Arg::Str(s) => key.str(s),
                Arg::Int(n) => key.int(*n),
                Arg::Float(x) => key.float(*x),
                Arg::Bool(b) => key.bool(*b),
                Arg::Null => key.null(),
            };
        }
    }
}

#[test]
fn keys_are_written_as_json_stringify_writes_the_name_and_arguments() {
    let key = |args: Vec<Arg>| load_key(&Args(args));
    assert_eq!(key(vec![]), r#"["f"]"#);
    assert_eq!(key(vec![Arg::Int(1)]), r#"["f",1]"#);
    assert_eq!(
        key(vec![Arg::Int(-9_007_199_254_740_991)]),
        r#"["f",-9007199254740991]"#
    );
    assert_eq!(
        key(vec![Arg::Str(
            "a\"b\\c\n\t\u{1}\u{1f}\u{7f} é 😀 \u{2028} </script>"
        )]),
        "[\"f\",\"a\\\"b\\\\c\\n\\t\\u0001\\u001f\u{7f} é 😀 \u{2028} </script>\"]"
    );
    assert_eq!(
        key(vec![
            Arg::Float(1.5),
            Arg::Float(1.0),
            Arg::Float(0.1 + 0.2),
            Arg::Float(1e21),
            Arg::Float(1e-7),
            Arg::Float(-0.0),
            Arg::Float(123_456_789_012_345_680_000.0),
            Arg::Float(5e-324),
        ]),
        r#"["f",1.5,1,0.30000000000000004,1e+21,1e-7,0,123456789012345680000,5e-324]"#
    );
    assert_eq!(
        key(vec![
            Arg::Float(f64::NAN),
            Arg::Float(f64::INFINITY),
            Arg::Float(f64::NEG_INFINITY)
        ]),
        r#"["f",null,null,null]"#
    );
    assert_eq!(
        key(vec![Arg::Bool(true), Arg::Bool(false), Arg::Null]),
        r#"["f",true,false,null]"#
    );
}

#[test]
fn arguments_are_written_by_their_type() {
    struct Typed;
    impl Load for Typed {
        const NAME: &'static str = "typed";
        type Output = ();
        fn args(&self, key: &mut LoadKey) {
            key.arg("s")
                .arg(&String::from("t"))
                .arg(&Cow::Borrowed("u"))
                .arg(&3_i64)
                .arg(&2.5_f64)
                .arg(&true)
                .arg(&Some(4_i64))
                .arg(&None::<&str>);
        }
    }
    assert_eq!(
        load_key(&Typed),
        r#"["typed","s","t","u",3,2.5,true,4,null]"#
    );
}

struct Wait {
    name: &'static str,
    ms: u64,
}

impl Load for Wait {
    const NAME: &'static str = "wait";
    type Output = String;
    fn args(&self, key: &mut LoadKey) {
        key.str(self.name).int(self.ms as i64);
    }
}

#[derive(Default)]
struct App {
    started: Mutex<Vec<(&'static str, u64)>>,
    calls: AtomicUsize,
}

impl App {
    async fn wait(&self, call: Wait, at: Instant) -> Result<String, &'static str> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.started
            .lock()
            .unwrap()
            .push((call.name, at.elapsed().as_millis() as u64));
        sleep(Duration::from_millis(call.ms)).await;
        if call.name == "fail" {
            return Err("no such post");
        }
        Ok(format!("{}:{}", call.name, call.ms))
    }

    fn dispatch<'a>(&'a self, at: Instant) -> impl FnMut(LoadCall) -> LoadFuture<'a, &'static str> {
        move |call| call.run(move |c: Wait| self.wait(c, at))
    }
}

fn section(
    out: &mut String,
    loads: &Loads<'_>,
    name: &'static str,
    ms: u64,
    children: impl FnOnce(&mut String),
) {
    let Some(v) = loads.get(Wait { name, ms }) else {
        return;
    };
    out.push_str("<section><b>");
    out.push_str(v);
    out.push_str("</b>");
    children(out);
    out.push_str("</section>");
}

#[tokio::test(start_paused = true)]
async fn loaders_start_when_vues_server_starts_them_and_the_last_render_has_every_result() {
    let app = App::default();
    let at = Instant::now();
    let renders = AtomicUsize::new(0);
    let html = load(
        |loads| {
            renders.fetch_add(1, Ordering::SeqCst);
            let mut out = String::from("<main>");
            section(&mut out, loads, "A", 50, |out| {
                section(out, loads, "Inner", 30, |_| {});
                out.push_str("<i>A1</i>");
            });
            section(&mut out, loads, "B", 10, |_| {});
            out.push_str("<i>C</i></main>");
            out
        },
        app.dispatch(at),
    )
    .await
    .unwrap();
    assert_eq!(
        html,
        "<main><section><b>A:50</b><section><b>Inner:30</b></section><i>A1</i></section><section><b>B:10</b></section><i>C</i></main>"
    );
    assert_eq!(
        *app.started.lock().unwrap(),
        [("A", 0), ("B", 0), ("Inner", 50)]
    );
    assert_eq!(renders.load(Ordering::SeqCst), 4);
    assert_eq!(at.elapsed(), Duration::from_millis(80));
}

#[tokio::test(start_paused = true)]
async fn the_awaits_of_one_component_run_in_order() {
    let app = App::default();
    let at = Instant::now();
    let html = load(
        |loads| {
            let mut out = String::new();
            let Some(a) = loads.get(Wait { name: "a", ms: 20 }) else {
                return out;
            };
            let Some(b) = loads.get(Wait { name: "b", ms: 20 }) else {
                return out;
            };
            out.push_str(a);
            out.push_str(b);
            out
        },
        app.dispatch(at),
    )
    .await
    .unwrap();
    assert_eq!(html, "a:20b:20");
    assert_eq!(*app.started.lock().unwrap(), [("a", 0), ("b", 20)]);
}

#[tokio::test(start_paused = true)]
async fn loads_that_finish_together_are_taken_by_one_render() {
    let app = App::default();
    let renders = AtomicUsize::new(0);
    let html = load(
        |loads| {
            renders.fetch_add(1, Ordering::SeqCst);
            let mut out = String::new();
            for i in 0..50 {
                section(&mut out, loads, ["x", "y"][i % 2], i as u64 % 5, |_| {});
            }
            out
        },
        app.dispatch(Instant::now()),
    )
    .await
    .unwrap();
    assert_eq!(html.matches("<section>").count(), 50);
    assert_eq!(app.calls.load(Ordering::SeqCst), 10);
    assert_eq!(renders.load(Ordering::SeqCst), 6);

    let ready = AtomicUsize::new(0);
    let renders = AtomicUsize::new(0);
    load(
        |loads| {
            renders.fetch_add(1, Ordering::SeqCst);
            (0..50)
                .filter(|i| {
                    loads
                        .get(Wait {
                            name: "now",
                            ms: *i,
                        })
                        .is_some()
                })
                .count()
        },
        |call| {
            ready.fetch_add(1, Ordering::SeqCst);
            call.run(|c: Wait| async move { Ok::<_, Infallible>(c.name.to_owned()) })
        },
    )
    .await
    .unwrap();
    assert_eq!(ready.load(Ordering::SeqCst), 50);
    assert_eq!(renders.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_render_with_no_loaders_runs_once() {
    let renders = AtomicUsize::new(0);
    let html = load(
        |loads| {
            renders.fetch_add(1, Ordering::SeqCst);
            let mut out = String::from("<p>static</p>");
            loads.script_into(&mut out);
            out
        },
        |_| -> LoadFuture<'_, Infallible> { unreachable!() },
    )
    .await
    .unwrap();
    assert_eq!(
        html,
        r#"<p>static</p><script type="application/json" data-fv-loads>{}</script>"#
    );
    assert_eq!(renders.load(Ordering::SeqCst), 1);
}

struct Dropped(Arc<AtomicBool>);

impl Drop for Dropped {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[tokio::test(start_paused = true)]
async fn the_first_failure_ends_the_render_and_drops_the_loads_still_running() {
    let dropped = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let at = Instant::now();
    let error = load(
        |loads| {
            let slow = loads
                .get(Wait {
                    name: "slow",
                    ms: 1000,
                })
                .is_some();
            let fail = loads
                .get(Wait {
                    name: "fail",
                    ms: 5,
                })
                .is_some();
            slow && fail
        },
        |call| {
            let (dropped, finished) = (Arc::clone(&dropped), Arc::clone(&finished));
            call.run(move |c: Wait| async move {
                let _guard = Dropped(dropped);
                sleep(Duration::from_millis(c.ms)).await;
                if c.name == "fail" {
                    return Err("no such post");
                }
                finished.store(true, Ordering::SeqCst);
                Ok(String::new())
            })
        },
    )
    .await
    .unwrap_err();
    assert_eq!(error.loader, "wait");
    assert_eq!(error.key, r#"["wait","fail",5]"#);
    assert_eq!(error.error, "no such post");
    assert_eq!(
        error.to_string(),
        r#"the loader `wait` failed for ["wait","fail",5]: no such post"#
    );
    assert!(dropped.load(Ordering::SeqCst));
    assert!(!finished.load(Ordering::SeqCst));
    assert_eq!(at.elapsed(), Duration::from_millis(5));
}

#[tokio::test]
async fn the_payload_holds_each_result_read_once_in_order_and_cannot_close_its_script() {
    let calls = AtomicUsize::new(0);
    let html = load(
        |loads| {
            let mut out = String::new();
            for name in ["b", "a", "b"] {
                if let Some(v) = loads.get(Wait { name, ms: 0 }) {
                    out.push_str(&v.len().to_string());
                }
            }
            loads.script_into(&mut out);
            out
        },
        |call| {
            calls.fetch_add(1, Ordering::SeqCst);
            call.run(|c: Wait| async move {
                Ok::<_, Infallible>(format!("</script>&{}\u{2028}", c.name))
            })
        },
    )
    .await
    .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(
        html,
        concat!(
            "141414",
            r#"<script type="application/json" data-fv-loads>"#,
            r#"{"[\"wait\",\"b\",0]":"\u003c/script\u003e\u0026b\u2028","#,
            r#""[\"wait\",\"a\",0]":"\u003c/script\u003e\u0026a\u2028"}"#,
            "</script>",
        )
    );
}

#[tokio::test]
async fn the_payload_writes_numbers_json_cannot_carry_as_javascript_writes_them() {
    struct Ratio;
    impl Load for Ratio {
        const NAME: &'static str = "ratio";
        type Output = Vec<f64>;
        fn args(&self, _: &mut LoadKey) {}
    }
    let html = load(
        |loads| {
            let mut out = String::new();
            loads.get(Ratio);
            loads.script_into(&mut out);
            out
        },
        |call| {
            call.run(|_: Ratio| async { Ok::<_, Infallible>(vec![f64::NAN, f64::INFINITY, 0.5]) })
        },
    )
    .await
    .unwrap();
    assert_eq!(
        html,
        r#"<script type="application/json" data-fv-loads>{"[\"ratio\"]":[NaN,Infinity,0.5]}</script>"#
    );
}

#[test]
#[should_panic(expected = "a call of `wait` was run as `ratio`")]
fn a_call_run_as_another_loader_panics() {
    struct Ratio;
    impl Load for Ratio {
        const NAME: &'static str = "ratio";
        type Output = ();
        fn args(&self, _: &mut LoadKey) {}
    }
    let call = LoadCall {
        name: Wait::NAME,
        key: String::new(),
        call: Box::new(Wait { name: "x", ms: 0 }),
    };
    let _ = call.run(|_: Ratio| async { Ok::<_, Infallible>(()) });
}

#[test]
fn the_driver_is_send_when_its_closures_are() {
    fn send<T: Send>(_: &T) {}
    let app = App::default();
    let props = String::from("props");
    let page = load(
        |loads| {
            let mut out = props.clone();
            section(&mut out, loads, "A", 1, |_| {});
            out
        },
        app.dispatch(Instant::now()),
    );
    send(&page);
}

#[tokio::test(start_paused = true)]
async fn a_components_html_takes_the_loads_of_a_render() {
    fn html<'p>(
        props: &'p String,
        loads: &'p Loads<'p>,
    ) -> crate::Html<'p, String, impl Fn(&mut String, &String) + 'p> {
        crate::Html::markup(props, move |out: &mut String, props: &String| {
            out.push_str(props);
            section(out, loads, "A", 5, |_| {});
        })
    }
    let app = App::default();
    let props = String::from("<hr>");
    let html = load(
        |loads| {
            let mut out = String::new();
            html(&props, loads).render_to(&mut out);
            out
        },
        app.dispatch(Instant::now()),
    )
    .await
    .unwrap();
    assert_eq!(html, "<hr><section><b>A:5</b></section>");
}

#[tokio::test]
async fn the_payload_carries_where_each_loader_s_results_hold_dates() {
    struct Days(i64);
    impl Load for Days {
        const NAME: &'static str = "days";
        type Output = Vec<crate::JsDate>;
        const DATES: &'static str = "[[1]]";
        fn args(&self, key: &mut LoadKey) {
            key.int(self.0);
        }
    }
    struct Plain;
    impl Load for Plain {
        const NAME: &'static str = "plain";
        type Output = String;
        fn args(&self, _: &mut LoadKey) {}
    }
    let html = load(
        |loads| {
            let mut out = String::new();
            loads.get(Days(1));
            loads.get(Plain);
            loads.get(Days(2));
            loads.script_into(&mut out);
            out
        },
        |call| match call.name() {
            "days" => call.run(|d: Days| async move {
                Ok::<_, Infallible>(vec![
                    crate::JsDate::from_millis(d.0 as f64),
                    crate::JsDate::INVALID,
                ])
            }),
            _ => call.run(|_: Plain| async { Ok::<_, Infallible>(String::from("<p>")) }),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        html,
        concat!(
            r#"<script type="application/json" data-fv-loads>{"[\"days\",1]":["1970-01-01T00:00:00.001Z",NaN],"[\"plain\"]":"\u003cp\u003e","#,
            r#""[\"days\",2]":["1970-01-01T00:00:00.002Z",NaN],"dates":{"days":[[1]]}}</script>"#
        )
    );
}
