/* Release chores, shared by a maintainer's machine and the release workflow.
 *
 *   node scripts/release.ts bump 0.2.0 [--pr]  set the version in both manifests, update the lockfile,
 *                                              and move the changelog's [Unreleased] notes under it;
 *                                              with --pr, commit on a release branch and open a PR
 *   node scripts/release.ts check v0.2.0       exit 1 unless the tag, both manifests and the changelog agree
 *   node scripts/release.ts notes 0.2.0        print that version's changelog notes, for the GitHub release
 *
 * The crate and the npm package are released together and always share one version. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const CARGO = join(ROOT, "Cargo.toml");
const PACKAGE = join(ROOT, "packages/ferrovue/package.json");
const CHANGELOG = join(ROOT, "CHANGELOG.md");

/** SemVer 2.0: `1.2.3`, with an optional pre-release (`-rc.1`); build metadata is not used here. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function isVersion(v: string): boolean {
  return SEMVER.test(v);
}

export function isPrerelease(v: string): boolean {
  return v.includes("-");
}

/** The version `[workspace.package]` declares, which the crate inherits. */
export function cargoVersion(toml: string): string {
  const section = /^\[workspace\.package\]$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml);
  const version = section && /^version\s*=\s*"([^"]+)"/m.exec(section[1]!);
  if (!version) throw new Error("Cargo.toml has no [workspace.package] version");
  return version[1]!;
}

export function setCargoVersion(toml: string, version: string): string {
  const old = cargoVersion(toml);
  const at = toml.indexOf("[workspace.package]");
  const head = toml.slice(0, at);
  const rest = toml.slice(at).replace(`version = "${old}"`, `version = "${version}"`);
  return head + rest;
}

export function packageVersion(json: string): string {
  return (JSON.parse(json) as { version: string }).version;
}

/** The package's version replaced in place, so the file keeps its formatting. */
export function setPackageVersion(json: string, version: string): string {
  return json.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
}

/** The notes under a version's heading, up to the next heading of the same level. */
export function changelogNotes(changelog: string, version: string): string | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

/** `[Unreleased]`'s notes moved under the new version, dated, with a fresh empty `[Unreleased]`. */
export function releaseChangelog(changelog: string, version: string, date: string): string {
  if (changelogNotes(changelog, version) !== null) throw new Error(`CHANGELOG.md already has ${version}`);
  const unreleased = changelogNotes(changelog, "Unreleased");
  if (unreleased === null) throw new Error("CHANGELOG.md has no [Unreleased] section");
  if (!unreleased) throw new Error("CHANGELOG.md's [Unreleased] section is empty: write the notes first");
  return changelog.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] - ${date}`);
}

/** What disagrees between a tag and the repository, if anything. */
export function checkRelease(tag: string, files: { cargo: string; pkg: string; changelog: string }): string[] {
  const problems: string[] = [];
  const version = tag.replace(/^v/, "");
  if (!tag.startsWith("v") || !isVersion(version)) problems.push(`${tag} is not a release tag (v1.2.3 or v1.2.3-rc.1)`);
  const cargo = cargoVersion(files.cargo);
  const pkg = packageVersion(files.pkg);
  if (cargo !== version) problems.push(`Cargo.toml is at ${cargo}, the tag at ${version}`);
  if (pkg !== version) problems.push(`packages/ferrovue/package.json is at ${pkg}, the tag at ${version}`);
  const notes = changelogNotes(files.changelog, version);
  if (!notes) problems.push(`CHANGELOG.md has no notes for ${version}`);
  return problems;
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
}

function main(argv: string[]): number {
  const [command, arg, ...flags] = argv;
  const read = () => ({ cargo: readFileSync(CARGO, "utf8"), pkg: readFileSync(PACKAGE, "utf8"), changelog: readFileSync(CHANGELOG, "utf8") });
  switch (command) {
    case "bump": {
      if (!arg || !isVersion(arg)) {
        console.error("usage: release.ts bump <version> [--pr]");
        return 2;
      }
      const files = read();
      const date = new Date().toISOString().slice(0, 10);
      writeFileSync(CHANGELOG, releaseChangelog(files.changelog, arg, date));
      writeFileSync(CARGO, setCargoVersion(files.cargo, arg));
      writeFileSync(PACKAGE, setPackageVersion(files.pkg, arg));
      // The lockfile records the workspace's own versions too.
      run("cargo", ["update", "--workspace", "--offline"]);
      console.log(`ferrovue is at ${arg}`);
      if (flags.includes("--pr")) {
        const branch = `release/v${arg}`;
        run("git", ["switch", "-c", branch]);
        run("git", ["commit", "-am", `release: v${arg}`]);
        run("git", ["push", "-u", "origin", branch]);
        const notes = changelogNotes(readFileSync(CHANGELOG, "utf8"), arg) ?? "";
        run("gh", ["pr", "create", "--title", `Release v${arg}`, "--body", `${notes}\n\nMerging this and pushing the tag \`v${arg}\` starts the release.`]);
      } else {
        console.log(`next: review the diff, commit it, merge, then push the tag v${arg}`);
      }
      return 0;
    }
    case "check": {
      if (!arg) {
        console.error("usage: release.ts check <tag>");
        return 2;
      }
      const problems = checkRelease(arg, read());
      for (const p of problems) console.error(p);
      if (!problems.length) console.log(`${arg} matches both manifests and the changelog`);
      return problems.length ? 1 : 0;
    }
    case "notes": {
      const notes = arg ? changelogNotes(read().changelog, arg.replace(/^v/, "")) : null;
      if (notes === null) {
        console.error(`CHANGELOG.md has no section for ${arg ?? "?"}`);
        return 1;
      }
      console.log(notes);
      return 0;
    }
    default:
      console.error("usage: release.ts bump <version> [--pr] | check <tag> | notes <version>");
      return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
