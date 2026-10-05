import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generate } from "../src/compiler.ts";
import {
  type Case,
  type Component,
  caseSize,
  componentShrinks,
  fixtureJson,
  fixtureShrinks,
  generateCase,
  helperFiles,
  printComponent,
} from "./generate.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const env = process.env;
const seed = env.FERROVUE_FUZZ_SEED ? Number(env.FERROVUE_FUZZ_SEED) : Math.floor(Math.random() * 2 ** 32);
const count = Number(env.FERROVUE_FUZZ_COUNT ?? 200);
const perComponent = Number(env.FERROVUE_FUZZ_FIXTURES ?? 4);
const only = env.FERROVUE_FUZZ_CASE !== undefined ? Number(env.FERROVUE_FUZZ_CASE) : null;
const plant = env.FERROVUE_FUZZ_PLANT === "1";
const shrinkMax = Number(env.FERROVUE_FUZZ_SHRINK_MAX ?? 24);
const keep = env.FERROVUE_FUZZ_KEEP === "1";
const dry = env.FERROVUE_FUZZ_DRY === "1";
if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(count)) throw new Error("FERROVUE_FUZZ_SEED and FERROVUE_FUZZ_COUNT are integers");

const WORK = join(REPO, "target/fuzz", String(seed));
const HARNESS = join(REPO, "target/fuzz/harness");
const CARGO_TARGET = join(REPO, "target/fuzz-target");
const FAILURES = plant ? join(REPO, "target/fuzz/planted-failures") : join(REPO, "fuzz/failures");

const log = (s: string): void => void process.stdout.write(s + "\n");

interface Item {
  id: string;
  component: Component;
  fixtures: Record<string, unknown>[];
}

type Outcome =
  | { k: "match"; html: string }
  | { k: "mismatch"; vue: string; rust: string }
  | { k: "vue-error"; err: string }
  | { k: "rust-error"; err: string; vue: string };

interface Evaluated {
  refused: string | null;
  compileError: string | null;
  outcomes: Outcome[];
}

function plantBug(rust: string): string {
  return rust.replace(/fv::escape_into\(out, (.*)\);/, "out.push_str($1);");
}

function run(cmd: string, args: string[], opts: { env?: Record<string, string>; cwd?: string } = {}): { status: number; output: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO,
    env: { ...env, ...opts.env },
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (r.error) throw r.error;
  return { status: r.status ?? 1, output: `${r.stdout}${r.stderr}` };
}

const HARNESS_TOML = `# Written by packages/ferrovue/fuzz/run.ts: the Rust half of one fuzzing batch.
[package]
name = "ferrovue-fuzz-harness"
version = "0.0.0"
edition = "2024"
publish = false

# Not a member of the repository's workspace.
[workspace]

[dependencies]
ferrovue = { path = "${join(REPO, "crates/ferrovue")}" }
serde = { version = "1", features = ["derive"] }
# Exact float parsing, so a fixture's number reaches the renderer as JavaScript read it.
serde_json = { version = "1", features = ["float_roundtrip"] }

[profile.dev]
debug = 0
`;

function harnessLib(mods: { id: string; dir: string }[]): string {
  const lines = ["// Written by packages/ferrovue/fuzz/run.ts.", "#![allow(warnings, clippy::all)]", ""];
  for (const m of mods) lines.push(`#[rustfmt::skip]`, `#[path = ${JSON.stringify(join(m.dir, "generated/mod.rs"))}]`, `mod ${m.id};`);
  lines.push(
    "",
    "#[cfg(test)]",
    "fn dispatch(module: &str, component: &str, json: &str) -> Result<String, String> {",
    "    match module {",
    ...mods.map((m) => `        ${JSON.stringify(m.id)} => ${m.id}::render_json(component, json),`),
    '        _ => Err(format!("no module {module}")),',
    "    }",
    "}",
    "",
    `#[test]
fn render_all() {
    let cases: Vec<(String, String, String, String)> =
        serde_json::from_str(&std::fs::read_to_string(std::env::var("FERROVUE_FUZZ_CASES").unwrap()).unwrap()).unwrap();
    std::panic::set_hook(Box::new(|_| {}));
    let mut out = serde_json::Map::new();
    for (key, module, component, json) in cases {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| dispatch(&module, &component, &json)));
        let v = match r {
            Ok(Ok(html)) => serde_json::json!({ "ok": html }),
            Ok(Err(e)) => serde_json::json!({ "err": e }),
            Err(p) => serde_json::json!({ "err": format!("panic: {}", p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()) }),
        };
        out.insert(key, v);
    }
    std::fs::write(std::env::var("FERROVUE_FUZZ_OUT").unwrap(), serde_json::to_string(&out).unwrap()).unwrap();
}
`,
  );
  return lines.join("\n");
}

function evaluate(batch: string, items: Item[]): Map<string, Evaluated> {
  rmSync(batch, { recursive: true, force: true });
  const results = new Map<string, Evaluated>();
  const live: Item[] = [];
  for (const item of items) {
    const dir = join(batch, item.id);
    mkdirSync(join(dir, "components"), { recursive: true });
    mkdirSync(join(dir, "generated"), { recursive: true });
    writeFileSync(join(dir, "components", `${item.component.name}.vue`), printComponent(item.component));
    for (const [file, text] of helperFiles(item.component)) writeFileSync(join(dir, "components", file), text);
    item.fixtures.forEach((f, i) => writeFileSync(join(dir, `fixture${i}.json`), fixtureJson(f)));
    const ev: Evaluated = { refused: null, compileError: null, outcomes: [] };
    results.set(item.id, ev);
    try {
      for (const [file, text] of generate(dir, { components: "components", out: "generated", scopeId: "filepath", viteRoot: import.meta.dirname, trustedHtml: "ferrovue::BasicHtml" })) {
        writeFileSync(join(dir, "generated", file), plant && file !== "mod.rs" ? plantBug(text) : text);
      }
      live.push(item);
    } catch (e) {
      ev.refused = (e as Error).message;
    }
  }
  if (!live.length || dry) return results;

  const vueCases = live.flatMap((item) =>
    item.fixtures.map((f, i) => ({
      key: `${item.id}/${i}`,
      file: join(batch, item.id, "components", `${item.component.name}.vue`),
      name: item.component.name,
      json: fixtureJson(f),
    })),
  );
  writeFileSync(join(batch, "vue-cases.json"), JSON.stringify(vueCases));
  const vueOut = join(batch, "vue-out.json");
  const vitest = run(join(REPO, "node_modules/.bin/vitest"), ["run", "--config", "packages/ferrovue/fuzz/vitest.config.ts"], {
    env: { FERROVUE_FUZZ_VUE_CASES: join(batch, "vue-cases.json"), FERROVUE_FUZZ_VUE_OUT: vueOut },
  });
  if (!existsSync(vueOut)) throw new Error(`the Vue renderer failed:\n${vitest.output}`);
  const vue = JSON.parse(readFileSync(vueOut, "utf8")) as Record<string, { ok?: string; err?: string }>;

  mkdirSync(join(HARNESS, "src"), { recursive: true });
  if (!existsSync(join(HARNESS, "Cargo.toml")) || readFileSync(join(HARNESS, "Cargo.toml"), "utf8") !== HARNESS_TOML) {
    writeFileSync(join(HARNESS, "Cargo.toml"), HARNESS_TOML);
  }
  if (!existsSync(join(HARNESS, "Cargo.lock"))) copyFileSync(join(REPO, "Cargo.lock"), join(HARNESS, "Cargo.lock"));
  let building = [...live];
  const rustOut = join(batch, "rust-out.json");
  for (let attempt = 0; ; attempt++) {
    writeFileSync(join(HARNESS, "src/lib.rs"), harnessLib(building.map((i) => ({ id: i.id, dir: join(batch, i.id) }))));
    const cases = building.flatMap((item) => item.fixtures.map((f, i) => [`${item.id}/${i}`, item.id, item.component.name, fixtureJson(f)]));
    writeFileSync(join(batch, "rust-cases.json"), JSON.stringify(cases));
    rmSync(rustOut, { force: true });
    const cargo = run("cargo", ["test", "--quiet", "--lib", "--message-format=short", "--manifest-path", join(HARNESS, "Cargo.toml"), "--target-dir", CARGO_TARGET], {
      env: { FERROVUE_FUZZ_CASES: join(batch, "rust-cases.json"), FERROVUE_FUZZ_OUT: rustOut, CARGO_TERM_COLOR: "never" },
    });
    if (existsSync(rustOut)) break;
    const bad = new Set<string>();
    for (const m of cargo.output.matchAll(/^(\S+?\.rs):\d+:\d+: error/gm)) {
      const hit = building.find((i) => m[1]!.startsWith(join(batch, i.id) + "/"));
      if (hit) bad.add(hit.id);
    }
    if (!bad.size || attempt > 20) throw new Error(`cargo test failed outside the generated code:\n${cargo.output.slice(-6000)}`);
    for (const id of bad) {
      const errs = [...cargo.output.matchAll(/^(\S+?\.rs:\d+:\d+: error.*)$/gm)].map((m) => m[1]!).filter((l) => l.includes(`/${id}/`));
      results.get(id)!.compileError = errs.slice(0, 5).join("\n").replaceAll(batch + "/", "");
    }
    building = building.filter((i) => !bad.has(i.id));
    if (!building.length) return results;
  }
  const rust = JSON.parse(readFileSync(rustOut, "utf8")) as Record<string, { ok?: string; err?: string }>;

  for (const item of building) {
    const ev = results.get(item.id)!;
    ev.outcomes = item.fixtures.map((_, i): Outcome => {
      const v = vue[`${item.id}/${i}`];
      const r = rust[`${item.id}/${i}`];
      if (!v || v.err !== undefined) return { k: "vue-error", err: v?.err ?? "not rendered" };
      if (!r || r.err !== undefined) return { k: "rust-error", err: r?.err ?? "not rendered", vue: v.ok! };
      return v.ok === r.ok ? { k: "match", html: v.ok! } : { k: "mismatch", vue: v.ok!, rust: r.ok! };
    });
  }
  return results;
}

interface Failure {
  index: number;
  kind: "mismatch" | "rust-error" | "compile-error";
  component: Component;
  fixture: Record<string, unknown>;
  outcome: Outcome | null;
  compileError: string | null;
  offset: number;
  done: boolean;
}

const fit = (c: Component, f: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(f).filter(([k]) => c.props.some((p) => p.name === k)));

const reproduces = (f: Failure, ev: Evaluated | undefined): boolean => {
  if (!ev) return false;
  if (f.kind === "compile-error") return ev.compileError !== null;
  return ev.outcomes[0]?.k === f.kind;
};

const PER_ROUND = 48;

function shrink(failures: Failure[]): void {
  for (let round = 0; failures.some((f) => !f.done) && round < 300; round++) {
    const batch: Item[] = [];
    const owners = new Map<string, { f: Failure; c: Component; fx: Record<string, unknown> }>();
    for (const [fi, f] of failures.entries()) {
      if (f.done) continue;
      const size = caseSize(f.component, f.fixture);
      const all = [
        ...componentShrinks(f.component).map((c) => ({ c, fx: fit(c, f.fixture) })),
        ...(f.kind === "compile-error" ? [] : fixtureShrinks(f.component, f.fixture).map((fx) => ({ c: f.component, fx }))),
      ].filter((x) => caseSize(x.c, x.fx) < size);
      const chunk = all.slice(f.offset, f.offset + PER_ROUND);
      if (!chunk.length) {
        f.done = true;
        continue;
      }
      f.offset += PER_ROUND;
      chunk.forEach((x, ci) => {
        const id = `f${fi}_${ci}`;
        owners.set(id, { f, ...x });
        batch.push({ id, component: x.c, fixtures: [x.fx] });
      });
    }
    if (!batch.length) break;
    const results = evaluate(join(WORK, "shrink"), batch);
    const best = new Map<Failure, { c: Component; fx: Record<string, unknown>; ev: Evaluated; size: number }>();
    for (const [id, o] of owners) {
      const ev = results.get(id);
      if (!reproduces(o.f, ev)) continue;
      const size = caseSize(o.c, o.fx);
      const cur = best.get(o.f);
      if (!cur || size < cur.size) best.set(o.f, { c: o.c, fx: o.fx, ev: ev!, size });
    }
    for (const [f, b] of best) {
      f.component = b.c;
      f.fixture = b.fx;
      f.outcome = b.ev.outcomes[0] ?? null;
      f.compileError = b.ev.compileError;
      f.offset = 0;
    }
    const open = failures.filter((f) => !f.done);
    log(`  shrink round ${round + 1}: ${batch.length} candidates, ${best.size} smaller, ${open.length} still shrinking (sizes ${failures.map((f) => caseSize(f.component, f.fixture)).join(", ")})`);
  }
}

function save(f: Failure): string {
  const dir = join(FAILURES, `${seed}-${f.index}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${f.component.name}.vue`), printComponent(f.component));
  for (const [file, text] of helperFiles(f.component)) writeFileSync(join(dir, file), text);
  writeFileSync(join(dir, "fixture.json"), fixtureJson(f.fixture));
  const o = f.outcome;
  if (o && "vue" in o) writeFileSync(join(dir, "vue.html"), o.vue);
  if (o?.k === "mismatch") writeFileSync(join(dir, "ferrovue.html"), o.rust);
  if (o?.k === "rust-error") writeFileSync(join(dir, "ferrovue.html"), `(error) ${o.err}\n`);
  if (f.compileError) writeFileSync(join(dir, "ferrovue.html"), `(the generated Rust does not compile)\n${f.compileError}\n`);
  writeFileSync(
    join(dir, "about.txt"),
    [
      `kind: ${f.kind}${plant ? " (planted bug: FERROVUE_FUZZ_PLANT=1)" : ""}`,
      `seed: ${seed}, case: ${f.index}`,
      `reproduce the original: FERROVUE_FUZZ_SEED=${seed} FERROVUE_FUZZ_CASE=${f.index}${plant ? " FERROVUE_FUZZ_PLANT=1" : ""} pnpm fuzz`,
      "",
    ].join("\n"),
  );
  return dir;
}

const started = Date.now();
log(`ferrovue fuzz: seed ${seed}, ${only !== null ? `case ${only}` : `${count} components`} × ${perComponent} fixtures${plant ? ", PLANTED BUG" : ""}`);
log(`  reproduce with FERROVUE_FUZZ_SEED=${seed}${only !== null ? ` FERROVUE_FUZZ_CASE=${only}` : ` FERROVUE_FUZZ_COUNT=${count}`}${plant ? " FERROVUE_FUZZ_PLANT=1" : ""} pnpm fuzz`);
rmSync(WORK, { recursive: true, force: true });

const indices = only !== null ? [only] : Array.from({ length: count }, (_, i) => i);
const cases = new Map<number, Case>(indices.map((i) => [i, generateCase(seed, i, perComponent)]));
const items: Item[] = indices.map((i) => ({ id: `k${i}`, component: cases.get(i)!.component, fixtures: cases.get(i)!.fixtures }));
const results = evaluate(join(WORK, "cases"), items);

const tally = { components: items.length, fixtures: 0, matches: 0, mismatches: 0, refused: 0, compileErrors: 0, vueErrors: 0, rustErrors: 0 };
const refusals = new Map<string, number[]>();
const vueErrors = new Map<string, number[]>();
const compileErrors = new Map<string, number[]>();
const failures: Failure[] = [];
for (const i of indices) {
  const ev = results.get(`k${i}`)!;
  const c = cases.get(i)!;
  tally.fixtures += c.fixtures.length;
  if (ev.refused !== null) {
    tally.refused++;
    const key = ev.refused.split("\n")[0]!.replace(/C\d{4}/g, "C…");
    refusals.set(key, [...(refusals.get(key) ?? []), i]);
    continue;
  }
  if (ev.compileError !== null) {
    tally.compileErrors++;
    const key = ev.compileError.split("\n")[0]!.replace(/^\S+?:\d+:\d+: /, "");
    compileErrors.set(key, [...(compileErrors.get(key) ?? []), i]);
    failures.push({ index: i, kind: "compile-error", component: c.component, fixture: c.fixtures[0]!, outcome: null, compileError: ev.compileError, offset: 0, done: false });
    continue;
  }
  let first = true;
  ev.outcomes.forEach((o, fi) => {
    if (o.k === "match") tally.matches++;
    else if (o.k === "vue-error") {
      tally.vueErrors++;
      const key = o.err.split("\n")[0]!;
      vueErrors.set(key, [...(vueErrors.get(key) ?? []), i]);
    } else {
      if (o.k === "mismatch") tally.mismatches++;
      else tally.rustErrors++;
      if (first) failures.push({ index: i, kind: o.k, component: c.component, fixture: c.fixtures[fi]!, outcome: o, compileError: null, offset: 0, done: false });
      first = false;
    }
  });
}

log("");
log(`components ${tally.components}, fixtures ${tally.fixtures}: ${tally.matches} match, ${tally.mismatches} mismatch, ${tally.rustErrors} Rust errors; ${tally.refused} components refused, ${tally.compileErrors} not compiling, ${tally.vueErrors} fixtures Vue could not render`);
for (const [msg, at] of refusals) log(`  refused ×${at.length} (cases ${at.slice(0, 8).join(", ")}${at.length > 8 ? ", …" : ""}): ${msg}`);
for (const [msg, at] of compileErrors) log(`  not compiling ×${at.length} (cases ${at.slice(0, 8).join(", ")}${at.length > 8 ? ", …" : ""}): ${msg}`);
for (const [msg, at] of vueErrors) log(`  Vue error ×${at.length} (cases ${at.slice(0, 8).join(", ")}): ${msg}`);

if (failures.length) {
  const perError = new Map<string, number>();
  const toShrink = [
    ...failures.filter((f) => f.kind !== "compile-error"),
    ...failures.filter((f) => {
      if (f.kind !== "compile-error") return false;
      const key = f.compileError!.split("\n")[0]!.replace(/^\S+?:\d+:\d+: /, "");
      perError.set(key, (perError.get(key) ?? 0) + 1);
      return perError.get(key)! <= 2;
    }),
  ].slice(0, shrinkMax);
  log(`\nshrinking ${toShrink.length} of ${failures.length} failing components…`);
  shrink(toShrink);
  const signature = (f: Failure): string =>
    `${f.kind} ${f.compileError?.split("\n")[0]!.replace(/^\S+?:\d+:\d+: /, "") ?? ""} ${printComponent(f.component).replace(/'[^']*'/g, "''").replace(/\b[a-z]+\d+\b/g, "v").replace(/\b\d+(\.\d+)?(e[+-]?\d+)?\b/g, "0")}`;
  const seen = new Map<string, number>();
  for (const f of toShrink) {
    const sig = signature(f);
    if (seen.has(sig)) {
      log(`\n── ${f.kind}: seed ${seed} case ${f.index} shrinks to the same case as case ${seen.get(sig)}`);
      continue;
    }
    seen.set(sig, f.index);
    const dir = save(f);
    log(`\n── ${f.kind}: seed ${seed} case ${f.index} → ${dir.slice(REPO.length + 1)}`);
    log(printComponent(f.component).trimEnd());
    log(`fixture: ${fixtureJson(f.fixture).replace(/\s*\n\s*/g, " ").trim()}`);
    const o = f.outcome;
    if (o && "vue" in o) log(`vue:      ${JSON.stringify(o.vue)}`);
    if (o?.k === "mismatch") log(`ferrovue: ${JSON.stringify(o.rust)}`);
    if (o?.k === "rust-error") log(`ferrovue: error ${o.err}`);
    if (f.compileError) log(`rustc: ${f.compileError}`);
  }
  const rest = failures.filter((f) => !toShrink.includes(f));
  if (rest.length) log(`\nnot shrunk (${rest.length}): cases ${rest.map((f) => f.index).join(", ")}`);
}

if (!keep) rmSync(join(WORK, "shrink"), { recursive: true, force: true });
log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)} s. Summary: seed ${seed}, components ${tally.components}, fixtures ${tally.fixtures}, matches ${tally.matches}, mismatches ${tally.mismatches}, rust-errors ${tally.rustErrors}, not-compiling ${tally.compileErrors}, refusals ${tally.refused}, vue-errors ${tally.vueErrors}`);
const compared = dry || tally.matches + tally.mismatches > 0;
if (!compared) log("no fixture was compared");
process.exitCode = tally.mismatches + tally.rustErrors + tally.compileErrors + tally.refused + tally.vueErrors > 0 || !compared ? 1 : 0;
