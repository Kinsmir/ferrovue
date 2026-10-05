import { describe, expect, it } from "vitest";
import {
  CRATES,
  cargoRequirements,
  cargoVersion,
  changelogNotes,
  checkRelease,
  isPrerelease,
  isVersion,
  packageVersion,
  releaseChangelog,
  setCargoVersion,
  setPackageVersion,
  checkMembers,
  workspaceMembers,
} from "./release.ts";

const CARGO = `[workspace]
members = ["crates/ferrovue-core", "crates/ferrovue-router", "crates/ferrovue"]

[workspace.package]
version = "0.1.0"
edition = "2024"

[workspace.dependencies]
ferrovue-core = { path = "crates/ferrovue-core", version = "=0.1.0" }
ferrovue-router = { path = "crates/ferrovue-router", version = "=0.1.0" }
serde = { version = "0.1.0" }

[workspace.lints.rust]
unsafe_code = "forbid"
`;

const CRATE_MANIFESTS = Object.fromEntries(
  CRATES.map((name) => [name, `[package]\nname = "${name}"\nversion.workspace = true\n`]),
);

const PKG = `{
  "name": "ferrovue",
  "version": "0.1.0",
  "dependencies": { "x": "0.1.0" }
}
`;

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- A thing.

## [0.1.0] - 2026-10-04

- First.
`;

describe("release chores", () => {
  it("knows a version from a pre-release and from nonsense", () => {
    expect(isVersion("0.2.0")).toBe(true);
    expect(isVersion("1.0.0-rc.1")).toBe(true);
    expect(isVersion("01.0.0")).toBe(false);
    expect(isVersion("v1.0.0")).toBe(false);
    expect(isPrerelease("1.0.0-rc.1")).toBe(true);
    expect(isPrerelease("1.0.0")).toBe(false);
  });

  it("sets the workspace version and the runtime crates' requirements on each other, and only those", () => {
    const toml = setCargoVersion(CARGO, "0.2.0");
    expect(cargoVersion(toml)).toBe("0.2.0");
    expect(cargoRequirements(toml)).toEqual(
      new Map([
        ["ferrovue-core", "=0.2.0"],
        ["ferrovue-router", "=0.2.0"],
      ]),
    );
    expect(toml).toContain('edition = "2024"');
    expect(toml).toContain('serde = { version = "0.1.0" }');
    expect(toml.match(/0\.2\.0/g)).toHaveLength(3);
  });

  it("sets the package version in place, leaving dependencies alone", () => {
    const json = setPackageVersion(PKG, "0.2.0");
    expect(packageVersion(json)).toBe("0.2.0");
    expect(json).toContain('"x": "0.1.0"');
    expect(json.split("\n")).toHaveLength(PKG.split("\n").length);
  });

  it("moves the unreleased notes under the new version, and leaves an empty section", () => {
    const out = releaseChangelog(CHANGELOG, "0.2.0", "2026-11-01");
    expect(changelogNotes(out, "0.2.0")).toBe("### Added\n\n- A thing.");
    expect(changelogNotes(out, "Unreleased")).toBe("");
    expect(changelogNotes(out, "0.1.0")).toBe("- First.");
    expect(out).toContain("## [0.2.0] - 2026-11-01");
  });

  it("refuses a release with no notes, or one already released", () => {
    const empty = releaseChangelog(CHANGELOG, "0.2.0", "2026-11-01");
    expect(() => releaseChangelog(empty, "0.3.0", "2026-12-01")).toThrow(/empty/);
    expect(() => releaseChangelog(CHANGELOG, "0.1.0", "2026-12-01")).toThrow(/already has/);
  });

  it("checks a tag against every manifest and the changelog", () => {
    const files = { cargo: CARGO, pkg: PKG, changelog: CHANGELOG, crates: CRATE_MANIFESTS };
    expect(checkRelease("v0.1.0", files)).toEqual([]);
    const problems = checkRelease("v0.2.0", files).join("\n");
    expect(problems).toMatch(/Cargo\.toml is at 0\.1\.0/);
    expect(problems).toMatch(/Cargo\.toml requires ferrovue-core at "=0\.1\.0", the tag at "=0\.2\.0"/);
    expect(problems).toMatch(/Cargo\.toml requires ferrovue-router at "=0\.1\.0"/);
    expect(problems).toMatch(/package\.json is at 0\.1\.0/);
    expect(problems).toMatch(/no notes for 0\.2\.0/);
    expect(checkRelease("0.1.0", files).join("\n")).toMatch(/not a release tag/);
  });

  it("refuses a requirement on a runtime crate that is not exactly the release's version", () => {
    const caret = CARGO.replace('version = "=0.1.0" }', 'version = "0.1.0" }');
    const files = { cargo: caret, pkg: PKG, changelog: CHANGELOG };
    expect(checkRelease("v0.1.0", files)).toEqual(['Cargo.toml requires ferrovue-core at "0.1.0", the tag at "=0.1.0"']);
  });

  it("refuses a crate with a version of its own, a crate no release publishes, and a missing one", () => {
    const { "ferrovue-i18n": _, ...rest } = CRATE_MANIFESTS;
    const crates = {
      ...rest,
      ferrovue: `[package]\nname = "ferrovue"\nversion = "0.1.0"\n`,
      "ferrovue-extra": `[package]\nname = "ferrovue-extra"\nversion.workspace = true\n`,
    };
    expect(checkRelease("v0.1.0", { cargo: CARGO, pkg: PKG, changelog: CHANGELOG, crates })).toEqual([
      "crates/ferrovue/Cargo.toml has a version of its own, not the workspace's",
      "crates/ferrovue-extra is not in release.ts's CRATES, so no release would publish it",
      "CRATES names ferrovue-i18n, which crates/ does not hold",
    ]);
  });

  it("publishes each crate after the crates it depends on", () => {
    expect(CRATES.indexOf("ferrovue-core")).toBeLessThan(CRATES.indexOf("ferrovue-router"));
    expect(CRATES.indexOf("ferrovue-core")).toBeLessThan(CRATES.indexOf("ferrovue-i18n"));
    expect(CRATES.at(-1)).toBe("ferrovue");
  });
});

describe("workspace members", () => {
  it("reads Cargo.toml's members and pnpm-workspace.yaml's packages", () => {
    expect(workspaceMembers(CARGO, "cargo")).toEqual(["crates/ferrovue-core", "crates/ferrovue-router", "crates/ferrovue"]);
    const pnpm = "# a comment\npackages:\n  # listed one by one\n  - packages/ferrovue\n  - 'examples/fullstack'\n\nallowBuilds:\n  esbuild: true\n";
    expect(workspaceMembers(pnpm, "pnpm")).toEqual(["packages/ferrovue", "examples/fullstack"]);
  });

  it("refuses a wildcard, a member that is not there, and a directory left out", () => {
    expect(checkMembers("Cargo.toml", ["crates/a", "crates/b"], ["crates/a", "crates/b"])).toEqual([]);
    expect(checkMembers("Cargo.toml", ["crates/*"], ["crates/a"])).toEqual([
      'Cargo.toml lists "crates/*": list each member by its path, not by a wildcard',
      "crates/a is not listed in Cargo.toml",
    ]);
    expect(checkMembers("pnpm-workspace.yaml", ["packages/gone"], ["packages/ferrovue"])).toEqual([
      "pnpm-workspace.yaml lists packages/gone, which holds no manifest",
      "packages/ferrovue is not listed in pnpm-workspace.yaml",
    ]);
  });
});
