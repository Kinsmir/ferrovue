What ferrovue supports, which releases receive fixes, and where to report a problem.

This page states the policy as it is written in the repository's README, RELEASING.md and
SECURITY.md, and as releases have followed it so far.

# One version line

ferrovue is one npm package, `ferrovue` (the compiler, the command, the Vite plugin and the browser
client), and four crates, `ferrovue`, `ferrovue-core`, `ferrovue-router` and `ferrovue-i18n`. All of
them are released together and share one version. `ferrovue` depends on the other three at exactly
its own version.

Use the npm package and the crates of one release. Generated code is written against the runtime of
its own release, and the top of every generated `mod.rs` checks that the crate accepts it:
[the version check](crate::guide::generated_code#the-version-check).

# Versions before 1.0

Until 1.0, versions are 0.MINOR.PATCH. Raising MINOR (0.9.2 to 0.10.0) may change the
configuration, the generated code and the crates' API. Raising PATCH (0.10.0 to 0.10.1) breaks none
of them. The [CHANGELOG](https://github.com/Kinsmir/ferrovue/blob/main/CHANGELOG.md) lists what each
release changes, and the guide has an upgrade page for each minor release, newest first in
[the guide's index](crate::guide).

What counts as API is written down: [`generated_code`](crate::guide::generated_code#what-is-stable)
lists the items of generated modules an application may rely on, the crates' API is what their
documentation shows, checked against the last release with `cargo-semver-checks` before each
release, and the npm package's exports, configuration keys and command-line options are checked
in the repository so that a change to them shows in review.

# Which releases receive fixes

Fixes go into the newest release: a fix ships as a patch of the newest minor version. ferrovue is
before 1.0, so there are no long-term support branches, and an earlier minor version receives no
further releases. To get a fix, upgrade to the newest minor version, with the upgrade pages as a
guide. Security fixes follow the same rule (SECURITY.md).

# Vue and its integrations

Byte-identical output depends on Vue's own SSR compiler, so the npm package compiles with an exact
version of `@vue/compiler-sfc`, and its conformance fixtures are recorded from one version of Vue
and of each integration (vue-router, Pinia, vue-i18n and `@unhead/vue`). A project may use any
later patch of the same minor. The README's
[Versions](https://github.com/Kinsmir/ferrovue#versions) table names each supported range and the
version its fixtures are recorded from, and the npm package's `peerDependencies` declare the same
ranges.

A new minor version of Vue or of an integration needs a ferrovue release that records the fixtures
from it. A weekly CI job records them again from the newest patch each range allows and hydrates
the committed HTML with it, so a patch that changes what Vue writes or hydrates is caught early,
and a ferrovue patch follows when one does.

The package's other peers are optional and needed for one entry each: Vite for `ferrovue/vite`,
vitest for `ferrovue/testing`, and `@vue/language-core` for `ferrovue/volar`. `peerDependencies` in
the package's `package.json` gives their ranges.

# Node.js

Node runs only at build time: the compiler, the Vite plugin and the tests. The server that renders
needs none. The npm package's `engines` field names the oldest Node it supports, `>=22.18`, and CI
tests the package on Node 22.18, the newest 22, 24 and 26, and on Windows and macOS. Releases are
built and published on Node 26, the active LTS from 2026-10-28.

# Rust

The crates' minimum supported Rust version is the `rust-version` in their manifests, which Cargo
checks and crates.io shows; the crate's front page states it under
[Rust version](crate#rust-version). CI tests that version and the latest stable Rust. The crate
that includes the generated code uses edition 2024, because that code uses let-chains. A release
that changes the minimum version says so in the CHANGELOG.

# Deprecations

What ferrovue stops supporting is deprecated for at least one minor release before it is removed,
and each release's CHANGELOG lists what it deprecates under "Deprecated":

- a crate item carries `#[deprecated]`;
- a configuration key warns with `warning[FV1117]` and a command-line option with
  `warning[FV1118]`, each naming the replacement, and the JSON Schema marks a deprecated key for
  editors.

Before 1.0, a minor release removes what an earlier minor release deprecated, and lists it under
"Removed". The README's [Deprecations](https://github.com/Kinsmir/ferrovue#deprecations) section
and RELEASING.md hold the policy.

# From 1.0

These parts of the policy are already written down for releases from 1.0 on:

- a change that breaks a crate's public API needs a new major version; the release workflow's
  `cargo-semver-checks` stops a release whose version is too small;
- a deprecated item, key or option is removed only in a major release, after at least one minor
  release of deprecation;
- within a major version, a newer compiler keeps every item of generated code that
  [`generated_code`](crate::guide::generated_code#what-is-stable) lists.

# Security reports

Report a vulnerability privately, through GitHub's
[security advisories](https://github.com/Kinsmir/ferrovue/security/advisories/new); a public
issue would show it to everyone before a fix exists. The repository's
[SECURITY.md](https://github.com/Kinsmir/ferrovue/blob/main/SECURITY.md) says what to include and
what to expect, and [`security`](crate::guide::security) is the threat model: every place ferrovue
writes data that may come from a reader, the guarantee there, and what is inherited from Vue.

# Reporting a bug or a refusal

Open an issue on [Kinsmir/ferrovue](https://github.com/Kinsmir/ferrovue/issues/new/choose), with
one of its templates:

- **Bug report**: the generated Rust renders other HTML than Vue, the browser reports a hydration
  mismatch, the compiler crashes or writes Rust that does not compile, or it refuses something it
  should accept or gives a confusing error. Include the smallest component that shows it, the
  props, slots and route it renders with, what Vue renders and what ferrovue renders or the error,
  `ferrovue.config.json`, and the versions (`pnpm ferrovue --version`).
- **Vue feature support**: a construct the compiler refuses that you need it to translate. Name the
  construct and the error code, give a small example component, and say why it matters. Check the
  README's [What a component may use](https://github.com/Kinsmir/ferrovue#what-a-component-may-use)
  and [`errors_and_limits`](crate::guide::errors_and_limits) first: some refusals are permanent,
  such as locale formatting with `Intl`, whose output differs between browsers.
- **Feature request**: anything else, such as the command, the configuration, the Rust API or the
  documentation.

A construct is supported once it renders exactly as Vue renders it, held to fixtures recorded from
Vue. Until then, [`porting`](crate::guide::porting#6-work-through-what-the-compiler-refuses) lists
the ways around a refusal.
