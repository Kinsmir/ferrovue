use crate::{json, page};
use serde::Serialize;
use std::any::Any;
use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::future::{Future, poll_fn};
use std::pin::Pin;
use std::task::Poll;

/// One call of a loader, as a component's `await` makes it: the loader's name, what it returns,
/// and its arguments. The generated `loaders` module has one per loader.
///
/// The call is the loader's key, as the client finds the result in the page's payload:
/// `JSON.stringify([name, ...args])`, written by [`load_key`].
#[doc(hidden)]
pub trait Load: Send + 'static {
    /// The loader's name, as `defineLoader` names it in the client's module.
    const NAME: &'static str;
    /// What the loader returns, which the component renders from and the payload carries.
    type Output: Serialize + Send + 'static;
    /// Where the result holds dates, as the compiler wrote it: the payload carries it for the
    /// client to turn each one back into a `Date`. Empty for a result that holds none.
    #[doc(hidden)]
    const DATES: &'static str = "";
    /// Write each argument into `key`, in order.
    fn args(&self, key: &mut LoadKey);
}

/// An argument of a loader, written into its key as `JSON.stringify` writes it.
#[doc(hidden)]
pub trait LoadArg {
    /// Write the argument as the next item of `key`.
    fn arg_into(&self, key: &mut LoadKey);
}

/// A loader's key being written: a JSON array of its name and its arguments, written as
/// `JSON.stringify` writes them, so the client computes the same key from the same call.
#[derive(Debug)]
#[doc(hidden)]
pub struct LoadKey {
    json: String,
}

impl LoadKey {
    fn new(name: &str) -> Self {
        let mut key = LoadKey {
            json: String::from("["),
        };
        key.json.push_str(&json_string(name));
        key
    }

    /// Add an argument.
    pub fn arg(&mut self, value: &(impl LoadArg + ?Sized)) -> &mut Self {
        value.arg_into(self);
        self
    }

    /// Add a string.
    pub fn str(&mut self, s: &str) -> &mut Self {
        self.json.push(',');
        self.json.push_str(&json_string(s));
        self
    }

    /// Add an integer.
    pub fn int(&mut self, n: i64) -> &mut Self {
        self.json.push(',');
        ferrovue_core::push_int(&mut self.json, n);
        self
    }

    /// Add a number, as JavaScript writes it, with `null` for `NaN` and the infinities.
    pub fn float(&mut self, x: f64) -> &mut Self {
        if !x.is_finite() {
            return self.null();
        }
        self.json.push(',');
        ferrovue_core::push_number(&mut self.json, x);
        self
    }

    /// Add a boolean.
    pub fn bool(&mut self, b: bool) -> &mut Self {
        self.json.push_str(if b { ",true" } else { ",false" });
        self
    }

    /// Add `null`, which is also what `JSON.stringify` writes for `undefined` in an array.
    pub fn null(&mut self) -> &mut Self {
        self.json.push_str(",null");
        self
    }

    fn finish(mut self) -> String {
        self.json.push(']');
        self.json
    }
}

fn json_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

impl LoadArg for str {
    fn arg_into(&self, key: &mut LoadKey) {
        key.str(self);
    }
}

impl LoadArg for String {
    fn arg_into(&self, key: &mut LoadKey) {
        key.str(self);
    }
}

impl LoadArg for Cow<'_, str> {
    fn arg_into(&self, key: &mut LoadKey) {
        key.str(self);
    }
}

impl LoadArg for i64 {
    fn arg_into(&self, key: &mut LoadKey) {
        key.int(*self);
    }
}

impl LoadArg for f64 {
    fn arg_into(&self, key: &mut LoadKey) {
        key.float(*self);
    }
}

impl LoadArg for bool {
    fn arg_into(&self, key: &mut LoadKey) {
        key.bool(*self);
    }
}

impl<T: LoadArg> LoadArg for Option<T> {
    fn arg_into(&self, key: &mut LoadKey) {
        match self {
            Some(value) => value.arg_into(key),
            None => {
                key.null();
            }
        }
    }
}

impl<T: LoadArg + ?Sized> LoadArg for &T {
    fn arg_into(&self, key: &mut LoadKey) {
        (**self).arg_into(key);
    }
}

/// The key of `call`, as the client's `JSON.stringify([name, ...args])` writes it.
///
/// # Example
///
/// ```
/// use ferrovue::loaders::{Load, LoadKey, load_key};
///
/// struct LoadPost {
///     id: i64,
///     draft: Option<bool>,
/// }
///
/// impl Load for LoadPost {
///     const NAME: &'static str = "loadPost";
///     type Output = String;
///     fn args(&self, key: &mut LoadKey) {
///         key.arg(&self.id).arg(&self.draft);
///     }
/// }
///
/// assert_eq!(load_key(&LoadPost { id: 7, draft: None }), r#"["loadPost",7,null]"#);
/// ```
#[doc(hidden)]
pub fn load_key<L: Load>(call: &L) -> String {
    let mut key = LoadKey::new(L::NAME);
    call.args(&mut key);
    key.finish()
}

struct Done {
    value: Box<dyn Any + Send>,
    json: String,
    name: &'static str,
    dates: &'static str,
}

/// A call a render asked for whose result the driver does not have yet, for the generated
/// `loaders` module to hand to the app's loader with [`LoadCall::run`].
#[doc(hidden)]
pub struct LoadCall {
    name: &'static str,
    key: String,
    call: Box<dyn Any + Send>,
}

impl fmt::Debug for LoadCall {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LoadCall")
            .field("name", &self.name)
            .field("key", &self.key)
            .finish_non_exhaustive()
    }
}

impl LoadCall {
    /// The loader's name: [`Load::NAME`].
    pub fn name(&self) -> &'static str {
        self.name
    }

    /// The call's key: [`load_key`].
    pub fn key(&self) -> &str {
        &self.key
    }

    /// Run the call as a `L`, with `loader`, the app's loader for it.
    ///
    /// # Panics
    ///
    /// When the call is not a `L`: the generated `loaders` module runs each call as the loader its
    /// [`name`](LoadCall::name) is.
    pub fn run<'a, L, E, F>(self, loader: impl FnOnce(L) -> F) -> LoadFuture<'a, E>
    where
        L: Load,
        F: Future<Output = Result<L::Output, E>> + Send + 'a,
    {
        let Ok(call) = self.call.downcast::<L>() else {
            panic!("a call of `{}` was run as `{}`", self.name, L::NAME);
        };
        let loading = loader(*call);
        LoadFuture(Box::pin(async move {
            let value = loading.await?;
            Ok(Done {
                json: json::to_string_or_null(&value),
                value: Box::new(value),
                name: L::NAME,
                dates: L::DATES,
            })
        }))
    }
}

/// A running call of a loader, as [`LoadCall::run`] starts it.
#[doc(hidden)]
pub struct LoadFuture<'a, E>(Pin<Box<dyn Future<Output = Result<Done, E>> + Send + 'a>>);

impl<E> fmt::Debug for LoadFuture<'_, E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("LoadFuture")
    }
}

/// The loaders' results a render reads, given to every component that awaits a loader or renders
/// one that does. [`load`] makes one for each render.
pub struct Loads<'c> {
    done: &'c HashMap<String, Done>,
    running: &'c HashSet<String>,
    calls: RefCell<Vec<LoadCall>>,
    used: RefCell<Vec<String>>,
    seen: RefCell<HashSet<String>>,
    blocked: Cell<bool>,
}

impl fmt::Debug for Loads<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Loads")
            .field("done", &self.done.len())
            .field("running", &self.running.len())
            .field("blocked", &self.blocked.get())
            .finish_non_exhaustive()
    }
}

impl<'c> Loads<'c> {
    fn new(done: &'c HashMap<String, Done>, running: &'c HashSet<String>) -> Self {
        Loads {
            done,
            running,
            calls: RefCell::new(Vec::new()),
            used: RefCell::new(Vec::new()),
            seen: RefCell::new(HashSet::new()),
            blocked: Cell::new(false),
        }
    }

    /// The result of `call`, or `None` when the driver does not have it yet: the component then
    /// returns, as Vue's server stops at the `await`, and [`load`] renders again once it has it.
    ///
    /// # Panics
    ///
    /// When two loaders share a name and return different types.
    #[doc(hidden)]
    pub fn get<L: Load>(&self, call: L) -> Option<&'c L::Output> {
        let key = load_key(&call);
        if let Some(done) = self.done.get(&key) {
            if self.seen.borrow_mut().insert(key.clone()) {
                self.used.borrow_mut().push(key);
            }
            let Some(value) = done.value.downcast_ref::<L::Output>() else {
                panic!("two loaders are called `{}`", L::NAME);
            };
            return Some(value);
        }
        self.blocked.set(true);
        let mut calls = self.calls.borrow_mut();
        if !self.running.contains(&key) && !calls.iter().any(|c| c.key == key) {
            calls.push(LoadCall {
                name: L::NAME,
                key,
                call: Box::new(call),
            });
        }
        None
    }

    /// Write the results this render has read as the payload the client hydrates from: a
    /// `<script type="application/json" data-fv-loads>` holding an object from each key to its
    /// result, in the order the render first read them, and under `dates` where the results of
    /// each loader hold dates, for the client to read them back as such. `<`, `>`, `&` and the two line separators
    /// are written as JSON escapes, as [`state_script_into`](crate::page::state_script_into) writes them.
    ///
    /// Write it after the components, so that it holds what they read.
    pub fn script_into(&self, out: &mut String) {
        let mut payload = String::from("{");
        for (i, key) in self.used.borrow().iter().enumerate() {
            if i > 0 {
                payload.push(',');
            }
            payload.push_str(&json_string(key));
            payload.push(':');
            payload.push_str(&self.done[key].json);
        }
        let mut dated: Vec<&Done> = Vec::new();
        for key in self.used.borrow().iter() {
            let done = &self.done[key];
            if !done.dates.is_empty() && dated.iter().all(|d| d.name != done.name) {
                dated.push(done);
            }
        }
        for (i, done) in dated.iter().enumerate() {
            payload.push_str(if i == 0 { ",\"dates\":{" } else { "," });
            payload.push_str(&json_string(done.name));
            payload.push(':');
            payload.push_str(done.dates);
        }
        if !dated.is_empty() {
            payload.push('}');
        }
        payload.push('}');
        out.push_str("<script type=\"application/json\" data-fv-loads>");
        page::json_escaped_into(out, &payload);
        out.push_str("</script>");
    }

    fn finish(self) -> (Vec<LoadCall>, bool) {
        (self.calls.into_inner(), self.blocked.get())
    }
}

/// A loader that failed, which fails the whole render, as a rejected `async setup` rejects Vue's
/// `renderToString`.
#[derive(Debug)]
pub struct LoadError<E> {
    /// The loader's name.
    pub loader: &'static str,
    /// The call's key.
    pub key: String,
    /// What the loader returned.
    pub error: E,
}

impl<E: fmt::Display> fmt::Display for LoadError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "the loader `{}` failed for {}: {}",
            self.loader, self.key, self.error
        )
    }
}

impl<E: std::error::Error + 'static> std::error::Error for LoadError<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

struct Running<'a, E> {
    name: &'static str,
    key: String,
    future: LoadFuture<'a, E>,
}

/// Render with loaders: call `render` with the results so far, start every call it asked for that
/// is not running with `dispatch`, wait until at least one has finished, take every one that has,
/// and render again, until a render reads every result it asks for. That render's value is
/// returned.
///
/// A call is asked for when the render reaches it, so each loader starts when Vue's server would
/// start it: siblings together, a component's children once its own loads have finished, the
/// awaits of one component in order. Each render after the first follows at least one finished
/// call, so there are at most one more renders than calls, and usually far fewer, since every
/// call finished by the time of a render is taken by it. A call is made once per key in a render.
///
/// The first loader to fail ends the render: the others still running are dropped, and the
/// error is returned.
///
/// # Example
///
/// ```
/// # use std::convert::Infallible;
/// # use ferrovue::loaders::{Load, LoadKey, Loads};
/// # struct LoadName(i64);
/// # impl Load for LoadName {
/// #     const NAME: &'static str = "loadName";
/// #     type Output = String;
/// #     fn args(&self, key: &mut LoadKey) {
/// #         key.int(self.0);
/// #     }
/// # }
/// # fn greeting(out: &mut String, id: i64, loads: &Loads<'_>) {
/// #     let Some(name) = loads.get(LoadName(id)) else { return };
/// #     out.push_str("<p>Hello, ");
/// #     ferrovue::core::escape_into(out, name);
/// #     out.push_str("!</p>");
/// # }
/// // Greeting.vue: const name = await loadName(props.id); <p>Hello, {{ name }}!</p>
/// let page = ferrovue::loaders::load(
///     |loads| {
///         let mut out = String::new();
///         greeting(&mut out, 1, loads);
///         loads.script_into(&mut out);
///         out
///     },
///     // The generated `loaders` module hands each call to the app's loader.
/// #   |call| match call.name() {
/// #       LoadName::NAME => call.run(|c: LoadName| async move { Ok::<_, Infallible>(format!("user {}", c.0)) }),
/// #       name => unreachable!("{name}"),
/// #   },
/// );
/// # let page = tokio::runtime::Builder::new_current_thread().build().unwrap().block_on(page);
/// assert_eq!(
///     page.unwrap(),
///     r#"<p>Hello, user 1!</p><script type="application/json" data-fv-loads>{"[\"loadName\",1]":"user 1"}</script>"#
/// );
/// ```
pub async fn load<'a, T, E>(
    mut render: impl FnMut(&Loads<'_>) -> T,
    mut dispatch: impl FnMut(LoadCall) -> LoadFuture<'a, E>,
) -> Result<T, LoadError<E>> {
    let mut done = HashMap::new();
    let mut keys = HashSet::new();
    let mut running: Vec<Running<'a, E>> = Vec::new();
    loop {
        let calls = {
            let loads = Loads::new(&done, &keys);
            let value = render(&loads);
            let (calls, blocked) = loads.finish();
            if !blocked {
                return Ok(value);
            }
            calls
        };
        for call in calls {
            keys.insert(call.key.clone());
            running.push(Running {
                name: call.name,
                key: call.key.clone(),
                future: dispatch(call),
            });
        }
        let finished = poll_fn(|cx| {
            let mut finished = Vec::new();
            let mut i = 0;
            while i < running.len() {
                if let Poll::Ready(result) = running[i].future.0.as_mut().poll(cx) {
                    finished.push((running.remove(i), result));
                } else {
                    i += 1;
                }
            }
            if finished.is_empty() {
                Poll::Pending
            } else {
                Poll::Ready(finished)
            }
        })
        .await;
        for (run, result) in finished {
            keys.remove(&run.key);
            match result {
                Ok(value) => {
                    done.insert(run.key, value);
                }
                Err(error) => {
                    return Err(LoadError {
                        loader: run.name,
                        key: run.key,
                        error,
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
