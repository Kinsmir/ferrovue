# Contributing to ferrovue

Thanks for helping! ferrovue makes one promise: for every component it accepts, the generated Rust
writes exactly the bytes Vue's server renderer writes, and anything it cannot reproduce is refused
with an error naming the construct. Every change is judged against that.

## Setting up

You need Node 22.18 or newer with pnpm, and the latest stable Rust.

```sh
pnpm install
pnpm test                    # compiler, CLI, vectors, router, the Vue half of conformance
pnpm typecheck
pnpm lint                    # oxlint (type-aware, on TypeScript 7), and fallow for unused files, exports and dependencies
cargo test --workspace --all-features
```

`pnpm lint:fix` applies the fixes both tools can make on their own; review the diff before committing.

[TESTING.md](TESTING.md) explains how the suite fits together.

## Adding support for a Vue construct

1. **Look at what Vue does.** `node scripts/inspect.ts X.vue '{"prop":"value"}'` prints Vue's SSR
   compilation of a component, Vue's render, and what ferrovue generates today. Read the matching
   `@vue/server-renderer`, `@vue/shared` or vue-router source in `node_modules` too: the rules you
   reproduce come from there, not from documentation.
2. **Translate it** in `packages/ferrovue/src/compiler.ts`, with runtime support in
   `crates/ferrovue/src/` if generated code needs it.
3. **Prove it with conformance.** Add a component under `crates/ferrovue/tests/conformance/components/`
   and fixtures beside the others: a typical case, an empty or falsy one, and a hostile one with
   markup-breaking characters in every prop that reaches the page. Run `pnpm conformance:generate`
   and `pnpm conformance:record`, read the recorded HTML, then run `cargo test`.
4. **Refuse the edges.** Whatever part of the construct you do not translate exactly must be an
   error. Add a case to `refused` in `packages/ferrovue/test/compiler.test.ts`.
5. **Document it** in the README's "What a component may use" table and in `CHANGELOG.md` under
   `[Unreleased]`.

Never re-record a fixture to make a failing test pass. A changed `.html` means Vue changed or the
compiler did, and that diff is what a reviewer needs to see.

## Pull requests

- Keep a pull request to one change; the template's checklist covers what CI cannot.
- Commit messages are short and say what changed (`compiler: support v-show on the root`), with
  detail in the body when the why is not obvious.
- CI must be green: tests on Node 22 and 24 and on stable Rust and the declared minimum, `pnpm lint`,
  clippy and rustfmt, docs, the example, and both packages packing cleanly.

## Licence

ferrovue is dual-licensed under MIT or Apache-2.0. Unless you explicitly state otherwise, any
contribution you intentionally submit for inclusion in this work, as defined in the Apache-2.0
licence, is dual-licensed as above, without any additional terms or conditions.
