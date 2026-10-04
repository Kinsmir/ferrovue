# Releasing ferrovue

The crate (`ferrovue` on crates.io) and the compiler (`ferrovue` on npm) are released together and
always share one version. A release is one pull request and one tag. CI checks everything and stages
both packages; nothing becomes public until a maintainer approves it, once on each registry.

## Cutting a release

1. Make sure `CHANGELOG.md`'s `[Unreleased]` section describes what is shipping.
2. Choose the version. While the crate is at 0.x, a release that breaks its public API bumps the
   minor version (0.1.3 to 0.2.0) and one that does not bumps the patch (0.2.0 to 0.2.1), as Cargo
   reads versions. `cargo semver-checks -p ferrovue` (`cargo install cargo-semver-checks --locked`)
   compares the crate with the last version on crates.io and says which the changes need; the
   release workflow runs the same check and stops a release whose version is too small.
3. Bump the version and open the release pull request:

   ```sh
   node scripts/release.ts bump 0.2.0 --pr
   ```

   This sets the version in `Cargo.toml` and `packages/ferrovue/package.json`, updates
   `Cargo.lock`, moves the changelog notes under `## [0.2.0] - <today>`, and opens a
   `release/v0.2.0` pull request. Without `--pr` it only edits the files.
4. When CI is green, merge it, then tag the merge commit and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.2.0 -m "ferrovue 0.2.0"
   git push origin v0.2.0
   ```

5. The **Release** workflow then:
   - checks the tag against both manifests and the changelog (`node scripts/release.ts check v0.2.0`);
   - checks the crate's public API against the newest version on crates.io not newer than the tag
     (`cargo-semver-checks`, the kind of release read from the two versions): breaking changes need
     a new minor version before 1.0, a new major version after;
   - runs the full CI on the tag;
   - **stages** the npm package, which is not public yet;
   - **waits** for approval of the `release` environment before publishing the crate;
   - creates the GitHub release with the changelog notes and both packages attached.
6. **Approve both:**
   - **npm:** `npm stage list ferrovue`, then `npm stage approve <id>`, which asks for your 2FA.
   - **crates.io:** open the workflow run on GitHub and approve the waiting `release` deployment.

A tag with a pre-release suffix (`v0.2.0-rc.1`) stages to npm under the `next` tag instead of
`latest`, and the GitHub release is marked as a pre-release.

Every publishing step skips a version its registry already has, so a run that failed halfway can
simply be re-run.

## One-time setup

Neither registry holds a token for this repository: each trusts the workflow through GitHub's
short-lived OIDC token.

### crates.io

On https://crates.io/crates/ferrovue/settings, add a **trusted publisher**:

| Field | Value |
|---|---|
| Repository owner | `Kinsmir` |
| Repository name | `ferrovue` |
| Workflow filename | `release.yml` |
| Environment | `release` |

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
cargo publish -p ferrovue
cd packages/ferrovue && pnpm publish --access public   # asks for your npm 2FA
```

Then create the GitHub release from the tag, with `node scripts/release.ts notes 0.2.0` as the notes.
