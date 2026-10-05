/* Release chores, shared by a maintainer's machine and the release workflow.
 *
 *   node scripts/release.ts bump 0.2.0 [--pr]  set the version in every manifest, update the lockfile,
 *                                              and move the changelog's [Unreleased] notes under it;
 *                                              with --pr, commit on a release branch and open a PR
 *   node scripts/release.ts check v0.2.0       exit 1 unless the tag, every manifest and the changelog agree
 *   node scripts/release.ts notes 0.2.0        print that version's changelog notes, for the GitHub release
 *   node scripts/release.ts members            exit 1 unless both workspaces list every member by its path
 *   node scripts/release.ts crates             print the crates in the order they are published
 *
 * The crates and the npm package are released together and always share one version. */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const CARGO = join(ROOT, "Cargo.toml");
const PACKAGE = join(ROOT, "packages/ferrovue/package.json");
const CHANGELOG = join(ROOT, "CHANGELOG.md");
const CRATES_DIR = join(ROOT, "crates");

/** The crates published to crates.io, in the order they are published: each one before the crates
 * that depend on it, which crates.io must already have. */
export const CRATES = ["ferrovue-core", "ferrovue-router", "ferrovue-i18n", "ferrovue"];

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

/** `[workspace.dependencies]`'s body, from its header to the next section, or null. */
function workspaceDependencies(toml: string): { start: number; end: number } | null {
  const header = /^\[workspace\.dependencies\]$/m.exec(toml);
  if (!header) return null;
  const start = header.index + header[0].length;
  const next = /^\[/m.exec(toml.slice(start));
  return { start, end: next ? start + next.index : toml.length };
}

/** A line of `[workspace.dependencies]` naming one of the runtime's crates and its version. */
const REQUIREMENT = /^(ferrovue[\w-]*)(\s*=\s*\{[^}\n]*\bversion\s*=\s*")([^"]*)(")/gm;

/** What each of the runtime's own crates is required at in `[workspace.dependencies]`. The crates
 * depend on one another at exactly the release's version: `"=0.2.0"`. */
export function cargoRequirements(toml: string): Map<string, string> {
  const deps = workspaceDependencies(toml);
  const found = new Map<string, string>();
  if (deps) for (const m of toml.slice(deps.start, deps.end).matchAll(REQUIREMENT)) found.set(m[1]!, m[3]!);
  return found;
}

/** The workspace's version set, which every crate inherits, and the requirements on the runtime's
 * own crates set to exactly it. */
export function setCargoVersion(toml: string, version: string): string {
  const old = cargoVersion(toml);
  const at = toml.indexOf("[workspace.package]");
  const head = toml.slice(0, at);
  const out = head + toml.slice(at).replace(`version = "${old}"`, `version = "${version}"`);
  const deps = workspaceDependencies(out);
  if (!deps) return out;
  const body = out.slice(deps.start, deps.end).replace(REQUIREMENT, `$1$2=${version}$4`);
  return out.slice(0, deps.start) + body + out.slice(deps.end);
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

/** The files a release is checked against. `crates` holds each crate's manifest, by the name of its
 * directory under `crates/`. */
export interface ReleaseFiles {
  cargo: string;
  pkg: string;
  changelog: string;
  crates?: Record<string, string>;
}

/** What disagrees between a tag and the repository, if anything. */
export function checkRelease(tag: string, files: ReleaseFiles): string[] {
  const problems: string[] = [];
  const version = tag.replace(/^v/, "");
  if (!tag.startsWith("v") || !isVersion(version)) problems.push(`${tag} is not a release tag (v1.2.3 or v1.2.3-rc.1)`);
  const cargo = cargoVersion(files.cargo);
  const pkg = packageVersion(files.pkg);
  if (cargo !== version) problems.push(`Cargo.toml is at ${cargo}, the tag at ${version}`);
  for (const [name, requirement] of cargoRequirements(files.cargo)) {
    if (requirement !== `=${version}`) problems.push(`Cargo.toml requires ${name} at "${requirement}", the tag at "=${version}"`);
  }
  if (files.crates) {
    for (const [dir, manifest] of Object.entries(files.crates)) {
      if (!/^version\.workspace\s*=\s*true$/m.test(manifest)) problems.push(`crates/${dir}/Cargo.toml has a version of its own, not the workspace's`);
      if (!CRATES.includes(dir)) problems.push(`crates/${dir} is not in release.ts's CRATES, so no release would publish it`);
    }
    for (const name of CRATES) if (!(name in files.crates)) problems.push(`CRATES names ${name}, which crates/ does not hold`);
  }
  if (pkg !== version) problems.push(`packages/ferrovue/package.json is at ${pkg}, the tag at ${version}`);
  const notes = changelogNotes(files.changelog, version);
  if (!notes) problems.push(`CHANGELOG.md has no notes for ${version}`);
  return problems;
}

/** The members a workspace lists: Cargo.toml's `members`, or pnpm-workspace.yaml's `packages`. */
export function workspaceMembers(text: string, kind: "cargo" | "pnpm"): string[] {
  if (kind === "cargo") {
    const list = /^members\s*=\s*\[([^\]]*)\]/m.exec(text)?.[1] ?? "";
    return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  }
  const block = /^packages:\n((?:[ \t]+-[^\n]*\n?|[ \t]*#[^\n]*\n?)*)/m.exec(text)?.[1] ?? "";
  return [...block.matchAll(/^[ \t]+-[ \t]*['"]?([^'"\n#]+?)['"]?[ \t]*$/gm)].map((m) => m[1]!);
}

/** What is wrong with a workspace's list of members: a wildcard, a member that is not there, or a
 * crate or package directory it leaves out. `dirs` are the directories that hold a manifest. */
export function checkMembers(file: string, members: string[], dirs: string[]): string[] {
  const problems: string[] = [];
  for (const m of members) {
    if (/[*?[]/.test(m)) problems.push(`${file} lists "${m}": list each member by its path, not by a wildcard`);
    else if (!dirs.includes(m)) problems.push(`${file} lists ${m}, which holds no manifest`);
  }
  for (const d of dirs) if (!members.includes(d)) problems.push(`${d} is not listed in ${file}`);
  return problems;
}

/** The workspaces' member lists against the directories that hold a manifest, under the folders
 * the workspaces draw from. */
function memberProblems(): string[] {
  const withManifest = (manifest: string): string[] =>
    ["crates", "examples", "packages"].flatMap((top) =>
      readdirSync(join(ROOT, top), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(ROOT, top, d.name, manifest)))
        .map((d) => `${top}/${d.name}`),
    );
  return [
    ...checkMembers("Cargo.toml", workspaceMembers(readFileSync(CARGO, "utf8"), "cargo"), withManifest("Cargo.toml")),
    ...checkMembers("pnpm-workspace.yaml", workspaceMembers(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"), "pnpm"), withManifest("package.json")),
  ];
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
}

function main(argv: string[]): number {
  const [command, arg, ...flags] = argv;
  const read = (): ReleaseFiles => ({
    cargo: readFileSync(CARGO, "utf8"),
    pkg: readFileSync(PACKAGE, "utf8"),
    changelog: readFileSync(CHANGELOG, "utf8"),
    crates: Object.fromEntries(
      readdirSync(CRATES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => [d.name, readFileSync(join(CRATES_DIR, d.name, "Cargo.toml"), "utf8")]),
    ),
  });
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
      console.log(`ferrovue is at ${arg}: the crates ${CRATES.join(", ")} and the npm package`);
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
    case "members": {
      const problems = memberProblems();
      for (const p of problems) console.error(p);
      if (!problems.length) console.log("Cargo.toml and pnpm-workspace.yaml list every member by its path");
      return problems.length ? 1 : 0;
    }
    case "check": {
      if (!arg) {
        console.error("usage: release.ts check <tag>");
        return 2;
      }
      const problems = [...checkRelease(arg, read()), ...memberProblems()];
      for (const p of problems) console.error(p);
      if (!problems.length) console.log(`${arg} matches every manifest and the changelog`);
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
    case "crates":
      console.log(CRATES.join(" "));
      return 0;
    default:
      console.error("usage: release.ts bump <version> [--pr] | check <tag> | notes <version> | crates");
      return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
