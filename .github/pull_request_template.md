## What this changes

<!-- What the change does and why. Link the issue it fixes: "Fixes #123". -->

## How it was checked

<!-- Delete the lines that do not apply. -->

- [ ] `pnpm test` and `pnpm typecheck` pass
- [ ] `cargo test --workspace --all-features` and `cargo clippy --workspace --all-targets --all-features -- -D warnings` pass
- [ ] New Vue support has a conformance component and fixtures (including a hostile one), recorded with `pnpm conformance:record`, and the recorded HTML was read before committing
- [ ] Anything ferrovue refuses has a test in `compiler.test.ts` naming the error
- [ ] Generated code is regenerated (`pnpm conformance:generate`) and the example is current
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`
- [ ] README updated if what a component may use changed

## Notes for the reviewer

<!-- Anything surprising: a Vue behaviour this reproduces, a fixture whose recorded HTML changed, a trade-off. -->
