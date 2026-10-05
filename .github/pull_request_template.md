## What this changes

<!-- What the change does and why. Link the issue it fixes: "Fixes #123". -->

## How it was checked

<!-- Delete the lines that do not apply. -->

- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass
- [ ] `cargo test --workspace --all-features` and `cargo clippy --workspace --all-targets --all-features -- -D warnings` pass
- [ ] New Vue support has a conformance component and fixtures (including a hostile one), recorded with `pnpm conformance:record`, and the recorded HTML was read before committing
- [ ] Anything ferrovue refuses has a case in `refused` in `compiler.test.ts` and a stable code in `src/errors.ts`, with the guide's `error_codes` page rewritten by `pnpm errors:generate`
- [ ] Generated code is regenerated (`pnpm conformance:generate`) and the example is current
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`
- [ ] README updated if what a component may use changed, and the crate guide (`crates/ferrovue/docs/`) if generated code or the runtime changed

## Notes for the reviewer

<!-- Anything surprising: a Vue behaviour this reproduces, a fixture whose recorded HTML changed, a trade-off. -->
