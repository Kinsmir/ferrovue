default: check

# Every check the pull request template lists, as CI runs them.
check: ts rust generated deny

# Type check, lint (oxlint, fallow) and the TypeScript tests.
ts:
    pnpm typecheck
    pnpm lint
    pnpm test

# The Rust tests, Clippy and rustfmt.
rust:
    cargo test --workspace --all-features --locked
    cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
    cargo fmt --all --check

# The committed generated Rust is what the compiler writes today.
generated:
    pnpm conformance:check
    node scripts/ferrovue-in.ts examples/greeting --check
    node scripts/ferrovue-in.ts examples/dioxus --check
    node scripts/ferrovue-in.ts crates/ferrovue-contract --check

# Licences, advisories, duplicate crates and sources (deny.toml).
deny:
    cargo deny check
