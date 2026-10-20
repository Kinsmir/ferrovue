//! A guide to ferrovue: from a `.vue` file to a page a browser hydrates.
//!
//! Read them in order the first time:
//!
//! 1. [`quick_start`]: install both halves, configure, generate, render.
//! 2. [`generated_code`]: what the compiler writes, module by module, and the shape of a
//!    component's API: `Props`, `render`, `html`, `island`.
//! 3. [`props`]: how each TypeScript prop type becomes a Rust type, and how to build props;
//!    dictionaries, with [`Record`](crate::Record).
//! 4. [`slots`]: slot content from Rust, named and scoped slots, fallbacks.
//! 5. [`scoped_styles`]: `<style scoped>` ids, matching `@vitejs/plugin-vue`, and `:slotted()`;
//!    `v-bind()` in `<style>`; CSS modules.
//! 6. [`routing`]: `<RouterLink>`, `<RouterView>` and `useRoute()`, with [`Router`](crate::Router)
//!    and [`Route`](crate::Route); routes from a folder of pages.
//! 7. [`i18n`]: vue-i18n's `$t`, with [`I18n`](crate::I18n).
//! 8. [`teleports`]: `<Teleport>`, with [`Teleports`](crate::Teleports).
//! 9. [`pinia`]: Pinia state on the server, and handing it to the client.
//! 10. [`provide_inject`]: `provide` and `inject`, resolved through the component tree.
//! 11. [`head`]: the page head from `useHead` and `useSeoMeta`, with [`Head`](crate::Head).
//! 12. [`islands_and_hydration`]: what the browser does with the page, and when each island
//!     hydrates.
//! 13. [`streaming`]: holes, for sending a page in the order its parts are ready.
//! 14. [`web_frameworks`]: responding with a component or a streamed page from axum or
//!     actix-web.
//! 15. [`numbers`]: JavaScript's number semantics in Rust.
//! 16. [`strings`]: JavaScript's strings in Rust: UTF-16 indices, halves of pairs, ordering,
//!     conversions to and from numbers.
//! 17. [`dates_and_prices`]: dates from ISO strings and numbers, read in UTC, and prices and
//!     formatted dates written in Rust or translated, since `Intl` differs between browsers.
//! 18. [`escaping`]: what is escaped, where, and the one way to write raw HTML.
//! 19. [`security`]: the threat model: every place data from readers is written, the guarantee
//!     there, and what is inherited from Vue.
//! 20. [`testing`]: holding your own components to Vue, with fixtures and two calls.
//! 21. [`errors_and_limits`]: what the compiler refuses, and what can still go wrong at run time.
//! 22. [`error_codes`]: every error code the compiler raises.
#![cfg_attr(
    feature = "dioxus",
    doc = "23. [`dioxus`]: islands in a page that Dioxus renders, with the `dioxus` feature."
)]
//!
//! Moving an existing app, and what is supported:
//!
//! - [`porting`]: moving a Vue 3 server-rendered app to ferrovue, from configuration to checking
//!   the output against Vue.
//! - [`support`]: the versions of Vue, Node and Rust supported, which releases receive fixes,
//!   deprecations, and where to report a problem.
//!
//! Upgrading a project from an earlier release, newest first:
//!
//! - [`upgrading_to_0_9`]: from 0.8 to 0.9.
//! - [`upgrading_to_0_8`]: from 0.7 to 0.8.

#[doc = include_str!("../docs/guide/quick_start.md")]
pub mod quick_start {}

#[doc = include_str!("../docs/guide/generated_code.md")]
pub mod generated_code {}

#[doc = include_str!("../docs/guide/props.md")]
pub mod props {}

#[doc = include_str!("../docs/guide/slots.md")]
pub mod slots {}

#[doc = include_str!("../docs/guide/scoped_styles.md")]
pub mod scoped_styles {}

#[cfg(feature = "router")]
#[cfg_attr(docsrs, doc(cfg(feature = "router")))]
#[doc = include_str!("../docs/guide/routing.md")]
pub mod routing {}

#[cfg(feature = "i18n")]
#[cfg_attr(docsrs, doc(cfg(feature = "i18n")))]
#[doc = include_str!("../docs/guide/i18n.md")]
pub mod i18n {}

#[doc = include_str!("../docs/guide/teleports.md")]
pub mod teleports {}

#[doc = include_str!("../docs/guide/pinia.md")]
pub mod pinia {}

#[doc = include_str!("../docs/guide/provide_inject.md")]
pub mod provide_inject {}

#[doc = include_str!("../docs/guide/head.md")]
pub mod head {}

#[doc = include_str!("../docs/guide/islands_and_hydration.md")]
pub mod islands_and_hydration {}

#[doc = include_str!("../docs/guide/streaming.md")]
pub mod streaming {}

#[doc = include_str!("../docs/guide/web_frameworks.md")]
pub mod web_frameworks {}

#[doc = include_str!("../docs/guide/numbers.md")]
pub mod numbers {}

#[doc = include_str!("../docs/guide/strings.md")]
pub mod strings {}

#[doc = include_str!("../docs/guide/dates_and_prices.md")]
pub mod dates_and_prices {}

#[doc = include_str!("../docs/guide/escaping.md")]
pub mod escaping {}

#[doc = include_str!("../docs/guide/security.md")]
pub mod security {}

#[doc = include_str!("../docs/guide/testing.md")]
pub mod testing {}

#[doc = include_str!("../docs/guide/errors_and_limits.md")]
pub mod errors_and_limits {}

#[doc = include_str!("../docs/guide/error_codes.md")]
pub mod error_codes {}

#[cfg(feature = "dioxus")]
#[cfg_attr(docsrs, doc(cfg(feature = "dioxus")))]
#[doc = include_str!("../docs/guide/dioxus.md")]
pub mod dioxus {}

#[doc = include_str!("../docs/guide/porting.md")]
pub mod porting {}

#[doc = include_str!("../docs/guide/support.md")]
pub mod support {}

#[doc = include_str!("../docs/guide/upgrading_to_0_9.md")]
pub mod upgrading_to_0_9 {}

#[doc = include_str!("../docs/guide/upgrading_to_0_8.md")]
pub mod upgrading_to_0_8 {}
