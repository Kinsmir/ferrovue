import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const CARGO = join(ROOT, "Cargo.toml");
const PACKAGE = join(ROOT, "packages/ferrovue/package.json");
const CHANGELOG = join(ROOT, "CHANGELOG.md");
const CRATES_DIR = join(ROOT, "crates");

export const CRATES = ["ferrovue-core", "ferrovue-router", "ferrovue-i18n", "ferrovue"];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function isVersion(v: string): boolean {
  return SEMVER.test(v);
}

export function isPrerelease(v: string): boolean {
  return v.includes("-");
}

export function cargoVersion(toml: string): string {
  const section = /^\[workspace\.package\]$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml);
  const version = section && /^version\s*=\s*"([^"]+)"/m.exec(section[1]!);
  if (!version) throw new Error("Cargo.toml has no [workspace.package] version");
  return version[1]!;
}

function workspaceDependencies(toml: string): { start: number; end: number } | null {
  const header = /^\[workspace\.dependencies\]$/m.exec(toml);
  if (!header) return null;
  const start = header.index + header[0].length;
  const next = /^\[/m.exec(toml.slice(start));
  return { start, end: next ? start + next.index : toml.length };
}

const REQUIREMENT = /^(ferrovue[\w-]*)(\s*=\s*\{[^}\n]*\bversion\s*=\s*")([^"]*)(")/gm;

export function cargoRequirements(toml: string): Map<string, string> {
  const deps = workspaceDependencies(toml);
  const found = new Map<string, string>();
  if (deps) for (const m of toml.slice(deps.start, deps.end).matchAll(REQUIREMENT)) found.set(m[1]!, m[3]!);
  return found;
}

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

export function setPackageVersion(json: string, version: string): string {
  return json.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
}

export function changelogNotes(changelog: string, version: string): string | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && (l.startsWith("## [") || LINK.test(l)));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

/** The subsections a version's notes may have, in the order they come. */
export const SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

/** What is wrong with the subsections of a version's notes: one that is not in `SECTIONS`, or one
 * out of their order. */
export function sectionProblems(notes: string, version: string): string[] {
  const headings = [...notes.matchAll(/^### (.*)$/gm)].map((m) => m[1]!.trim());
  const problems = headings.filter((h) => !SECTIONS.includes(h)).map((h) => `CHANGELOG.md's ${version} has a section "${h}": it takes ${SECTIONS.join(", ")}`);
  const known = headings.filter((h) => SECTIONS.includes(h));
  if (known.some((h, i) => i > 0 && SECTIONS.indexOf(h) <= SECTIONS.indexOf(known[i - 1]!))) {
    problems.push(`CHANGELOG.md's ${version} has its sections as ${known.join(", ")}: each once, in the order ${SECTIONS.join(", ")}`);
  }
  return problems;
}

/** A link reference at the changelog's foot: `[0.6.0]: https://…/compare/v0.5.0...v0.6.0`. */
const LINK = /^\[([^\]]+)\]:\s*(\S+)\s*$/;
const UNRELEASED_LINK = /^\[Unreleased\]:\s*(\S+)\/compare\/(v[^.\s]\S*?)\.\.\.HEAD\s*$/m;

/** The changelog's links once `version` is released: `[Unreleased]` compares from its tag, and
 * `version` gets a link of its own, comparing with the tag `[Unreleased]` compared from. A
 * changelog with no `[Unreleased]` link is left as it is. */
export function releaseLinks(changelog: string, version: string): string {
  const unreleased = UNRELEASED_LINK.exec(changelog);
  if (!unreleased) return changelog;
  const [line, base, previous] = unreleased;
  return changelog.replace(line, `[Unreleased]: ${base}/compare/v${version}...HEAD\n[${version}]: ${base}/compare/${previous}...v${version}`);
}

export function releaseChangelog(changelog: string, version: string, date: string): string {
  if (changelogNotes(changelog, version) !== null) throw new Error(`CHANGELOG.md already has ${version}`);
  const unreleased = changelogNotes(changelog, "Unreleased");
  if (unreleased === null) throw new Error("CHANGELOG.md has no [Unreleased] section");
  if (!unreleased) throw new Error("CHANGELOG.md's [Unreleased] section is empty: write the notes first");
  const problems = sectionProblems(unreleased, "Unreleased");
  if (problems.length) throw new Error(problems.join("\n"));
  return releaseLinks(changelog.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] - ${date}`), version);
}

export interface ReleaseFiles {
  cargo: string;
  pkg: string;
  changelog: string;
  crates?: Record<string, string>;
}

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
      if (/^publish\s*=\s*false$/m.test(manifest)) continue;
      if (!/^version\.workspace\s*=\s*true$/m.test(manifest)) problems.push(`crates/${dir}/Cargo.toml has a version of its own, not the workspace's`);
      if (!CRATES.includes(dir)) problems.push(`crates/${dir} is not in release.ts's CRATES, so no release would publish it`);
    }
    for (const name of CRATES) if (!(name in files.crates)) problems.push(`CRATES names ${name}, which crates/ does not hold`);
  }
  if (pkg !== version) problems.push(`packages/ferrovue/package.json is at ${pkg}, the tag at ${version}`);
  const notes = changelogNotes(files.changelog, version);
  if (!notes) problems.push(`CHANGELOG.md has no notes for ${version}`);
  else problems.push(...sectionProblems(notes, version));
  const links = files.changelog.split("\n").filter((l) => LINK.test(l));
  if (links.length && !links.some((l) => l.startsWith(`[${version}]:`))) problems.push(`CHANGELOG.md has no link for ${version}: \`release.ts bump\` writes it`);
  return problems;
}

export function workspaceMembers(text: string, kind: "cargo" | "pnpm"): string[] {
  if (kind === "cargo") {
    const list = /^members\s*=\s*\[([^\]]*)\]/m.exec(text)?.[1] ?? "";
    return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  }
  const block = /^packages:\n((?:[ \t]+-[^\n]*\n?|[ \t]*#[^\n]*\n?)*)/m.exec(text)?.[1] ?? "";
  return [...block.matchAll(/^[ \t]+-[ \t]*['"]?([^'"\n#]+?)['"]?[ \t]*$/gm)].map((m) => m[1]!);
}

export function checkMembers(file: string, members: string[], dirs: string[]): string[] {
  const problems: string[] = [];
  for (const m of members) {
    if (/[*?[]/.test(m)) problems.push(`${file} lists "${m}": list each member by its path, not by a wildcard`);
    else if (!dirs.includes(m)) problems.push(`${file} lists ${m}, which holds no manifest`);
  }
  for (const d of dirs) if (!members.includes(d)) problems.push(`${d} is not listed in ${file}`);
  return problems;
}

const DEPENDENCY_TABLE = /^(?:target\..+\.)?(?:dev-|build-)?dependencies(?:\.([\w-]+))?$/;

export function checkInheritedDependencies(file: string, manifest: string): string[] {
  const problems: string[] = [];
  const declaresItself = (name: string): string =>
    `${file} declares ${name} itself: write it in [workspace.dependencies] and use \`workspace = true\``;
  let table: RegExpExecArray | null = null;
  let inherited = false;
  const closeTable = (): void => {
    if (table?.[1] && !inherited) problems.push(declaresItself(table[1]));
  };
  for (const line of manifest.split("\n")) {
    const header = /^\[\[?([^\]]+)\]\]?\s*$/.exec(line);
    if (header) {
      closeTable();
      table = DEPENDENCY_TABLE.exec(header[1]!.replace(/\s/g, ""));
      inherited = false;
      continue;
    }
    const entry = table && /^\s*([\w-]+)(\.workspace)?\s*=\s*(.*)$/.exec(line);
    if (!table || !entry) continue;
    if (table[1]) {
      if (entry[1] === "workspace" && entry[3]!.trim() === "true") inherited = true;
    } else if (entry[2] ? entry[3]!.trim() !== "true" : !/^\{.*\bworkspace\s*=\s*true\b/.test(entry[3]!)) {
      problems.push(declaresItself(entry[1]!));
    }
  }
  closeTable();
  return problems;
}

function memberProblems(): string[] {
  const withManifest = (manifest: string): string[] =>
    ["crates", "examples", "packages"].flatMap((top) =>
      readdirSync(join(ROOT, top), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(ROOT, top, d.name, manifest)))
        .map((d) => `${top}/${d.name}`),
    );
  const cargoMembers = workspaceMembers(readFileSync(CARGO, "utf8"), "cargo");
  return [
    ...checkMembers("Cargo.toml", cargoMembers, withManifest("Cargo.toml")),
    ...cargoMembers
      .filter((m) => existsSync(join(ROOT, m, "Cargo.toml")))
      .flatMap((m) => checkInheritedDependencies(`${m}/Cargo.toml`, readFileSync(join(ROOT, m, "Cargo.toml"), "utf8"))),
    ...checkMembers("pnpm-workspace.yaml", workspaceMembers(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"), "pnpm"), withManifest("package.json")),
  ];
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
}

/** Set the crates' and the npm package's version, leaving the changelog alone. */
function setVersion(files: ReleaseFiles, version: string): void {
  writeFileSync(CARGO, setCargoVersion(files.cargo, version));
  writeFileSync(PACKAGE, setPackageVersion(files.pkg, version));
  run("cargo", ["update", "--workspace", "--offline"]);
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
      setVersion(files, arg);
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
      if (!problems.length) console.log("Cargo.toml and pnpm-workspace.yaml list every member by its path, and every crate takes its dependencies from the workspace");
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
    case "version":
      console.log(cargoVersion(read().cargo));
      return 0;
    case "set-version": {
      // For the release dry run, which packs and stages a version nobody publishes.
      if (!arg || !isVersion(arg)) {
        console.error("usage: release.ts set-version <version>");
        return 2;
      }
      setVersion(read(), arg);
      return 0;
    }
    default:
      console.error("usage: release.ts bump <version> [--pr] | check <tag> | notes <version> | crates | version | set-version <version>");
      return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
