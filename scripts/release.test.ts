import { describe, expect, it } from "vitest";
import {
  cargoVersion,
  changelogNotes,
  checkRelease,
  isPrerelease,
  isVersion,
  packageVersion,
  releaseChangelog,
  setCargoVersion,
  setPackageVersion,
} from "./release.ts";

const CARGO = `[workspace]
members = ["crates/ferrovue", "examples/*"]

[workspace.package]
version = "0.1.0"
edition = "2024"

[workspace.lints.rust]
unsafe_code = "forbid"
`;

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

  it("sets the workspace version and only that", () => {
    const toml = setCargoVersion(CARGO, "0.2.0");
    expect(cargoVersion(toml)).toBe("0.2.0");
    expect(toml).toContain('edition = "2024"');
    expect(toml.match(/0\.2\.0/g)).toHaveLength(1);
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

  it("checks a tag against both manifests and the changelog", () => {
    const files = { cargo: CARGO, pkg: PKG, changelog: CHANGELOG };
    expect(checkRelease("v0.1.0", files)).toEqual([]);
    const problems = checkRelease("v0.2.0", files);
    expect(problems.join("\n")).toMatch(/Cargo\.toml is at 0\.1\.0/);
    expect(problems.join("\n")).toMatch(/package\.json is at 0\.1\.0/);
    expect(problems.join("\n")).toMatch(/no notes for 0\.2\.0/);
    expect(checkRelease("0.1.0", files).join("\n")).toMatch(/not a release tag/);
  });
});
