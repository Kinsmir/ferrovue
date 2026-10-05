# Releasing ferrovue

The runtime's crates on crates.io and the compiler (`ferrovue` on npm) are released together and
always share one version. The crates are `ferrovue-core` (escaping and numbers), `ferrovue-router`,
`ferrovue-i18n` and `ferrovue`, which depends on the other three at exactly its own version and
re-exports them; `node scripts/release.ts crates` lists them in the order they are published. A
release is one pull request and one tag. CI checks everything and stages every package; nothing
becomes public until a maintainer approves it, once on each registry.

## Cutting a release

1. Make sure `CHANGELOG.md`'s `[Unreleased]` section describes what is shipping.
2. Choose the version. While the crates are at 0.x, a release that breaks a public API bumps the
   minor version (0.1.3 to 0.2.0) and one that does not bumps the patch (0.2.0 to 0.2.1), as Cargo
   reads versions. `cargo semver-checks -p <crate>` (`cargo install cargo-semver-checks --locked`)
   compares a crate with its last version on crates.io and says which the changes need; the
   release workflow runs the same check on every crate crates.io already has, and stops a release
   whose version is too small. It does not follow a re-export from another crate: `ferrovue::Router`
   is checked as `ferrovue_router::Router`, and `crates/ferrovue/tests/paths.rs` holds each path
   `ferrovue` re-exports in place.
3. Bump the version and open the release pull request:

   ```sh
   node scripts/release.ts bump 0.2.0 --pr
   ```

   This sets the version in `Cargo.toml` (the workspace's version, which every crate takes, and
   the `=0.2.0` the crates require one another at) and `packages/ferrovue/package.json`, updates
   `Cargo.lock`, moves the changelog notes under `## [0.2.0] - <today>`, and opens a
   `release/v0.2.0` pull request. Without `--pr` it only edits the files.
4. When CI is green, merge it, then tag the merge commit and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.2.0 -m "ferrovue 0.2.0"
   git push origin v0.2.0
   ```

5. The **Release** workflow then:
   - checks the tag against every manifest and the changelog (`node scripts/release.ts check v0.2.0`);
   - checks each crate's public API against its newest version on crates.io not newer than the tag
     (`cargo-semver-checks`, the kind of release read from the two versions): breaking changes need
     a new minor version before 1.0, a new major version after. A crate crates.io does not have yet
     is skipped;
   - runs the full CI on the tag;
   - **stages** the npm package, which is not public yet;
   - **waits** for approval of the `release` environment before publishing the crates, each after
     the crates it depends on;
   - creates the GitHub release with the changelog notes and every package attached.
6. **Approve both:**
   - **npm:** `npm stage approve <id>`, which asks for your 2FA. The run prints the command, with the
     id when npm reports one, as a notice at the top of its page and in the npm and GitHub release
     jobs' summaries; otherwise `npm stage list ferrovue` shows the id.
   - **crates.io:** open the workflow run on GitHub and approve the waiting `release` deployment.

A tag with a pre-release suffix (`v0.2.0-rc.1`) stages to npm under the `next` tag instead of
`latest`, and the GitHub release is marked as a pre-release.

Every publishing step skips a version its registry already has, crate by crate, so a run that failed
halfway can simply be re-run.

## Signed tags

Only a signed, annotated tag starts a release: the workflow's first job asks GitHub whether the tag
is annotated and its signature verified, and stops before anything is staged or published if not.
Sign tags with a key that is on your GitHub account as a **signing key** (SSH or GPG), and make
signing the default so a plain `git tag -a` signs too:

```sh
git config --global tag.gpgSign true
git tag -s v0.4.0 -m "ferrovue 0.4.0"   # -s is then implied, but harmless
git tag -v v0.4.0                        # check before pushing
```

## One-time setup

Neither registry holds a token for this repository: each trusts the workflow through GitHub's
short-lived OIDC token.

### crates.io

Each crate needs a **trusted publisher** of its own: on `https://crates.io/crates/<crate>/settings`,
for each of `ferrovue-core`, `ferrovue-router`, `ferrovue-i18n` and `ferrovue`, add:

| Field | Value |
|---|---|
| Repository owner | `Kinsmir` |
| Repository name | `ferrovue` |
| Workflow filename | `release.yml` |
| Environment | `release` |

A trusted publisher is added to a crate that exists, so a new crate's first version is published by
hand, with an API token from https://crates.io/settings/tokens (scope `publish-new`, expiring
soon). For the first release with `ferrovue-core`, `ferrovue-router` and `ferrovue-i18n` (0.4.0),
once the release pull request is merged and before the tag is pushed, from `main`:

```sh
cargo publish -p ferrovue-core -p ferrovue-router -p ferrovue-i18n   # with CARGO_REGISTRY_TOKEN set
```

Then add the trusted publisher to each of the three, and revoke the token. The workflow skips the
three versions crates.io then has, and publishes `ferrovue` itself. A crate added later is published
by hand the same way the first time, and goes into `CRATES` in `scripts/release.ts`, after the
crates it depends on.

### npm

```sh
npm trust github ferrovue --repo Kinsmir/ferrovue --file release.yml --allow-stage-publish
```

Grant only `--allow-stage-publish`, never `--allow-publish`: the workflow can then stage a version
but never make it public without your 2FA. Then, on the package's **Access** settings page, choose
"Require two-factor authentication and disallow tokens".

### GitHub

- **Settings → Environments → New environment** `release`:
  - required reviewer: you;
  - deployment branches and tags: tags matching `v*`.
- **Settings → Rules → New tag ruleset** for `v*`: restrict creation to maintainers, so only a
  maintainer can start a release.

## Releasing by hand

If the workflow is unavailable:

```sh
cargo publish -p ferrovue-core -p ferrovue-router -p ferrovue-i18n -p ferrovue
cd packages/ferrovue && pnpm publish --access public   # asks for your npm 2FA
```

Then create the GitHub release from the tag, with `node scripts/release.ts notes 0.2.0` as the notes.
