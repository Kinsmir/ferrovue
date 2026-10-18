import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const PROJECT = join(ROOT, "target/budget");
const CLI = join(ROOT, "packages/ferrovue/src/cli.ts");

/** How many components the synthetic project has. */
export const COMPONENTS = 500;

/** The most each step may take, in seconds, on a shared CI runner. */
export const BUDGETS = { compiler: 10, dev: 60, release: 90 } as const;

type Step = keyof typeof BUDGETS;

const LABELS: Record<Step, string> = {
  compiler: `ferrovue on ${COMPONENTS} components`,
  dev: "cargo build of the generated modules",
  release: "cargo build --release of the generated modules",
};

const pad = (i: number): string => String(i).padStart(3, "0");
const name = (i: number): string => `Comp${pad(i)}`;

const PROPS = "defineProps<{ title: string; count: number; tags: string[]; on?: boolean }>();";

function script(imports: number[]): string {
  const lines = imports.map((j, k) => `import ${"ABC"[k]} from "./${name(j)}.vue";`);
  return `<script setup lang="ts">\n${[...lines, PROPS].join("\n")}\n</script>\n`;
}

/** The `.vue` source of component `i`: one of five shapes, the last two built from the components
 * before it, so the project nests the way an application's pages, layouts and widgets do. */
export function component(i: number): string {
  switch (i % 5) {
    case 0:
      return `${script([])}
<template>
  <article class="card-${i}" :class="{ active: on, empty: !tags.length }">
    <h2>{{ title }} <small v-if="count > 0">({{ count }})</small><small v-else>none</small></h2>
    <ul><li v-for="(t, n) in tags" :data-n="n">{{ t }}</li></ul>
    <slot>{{ title }} ${i}</slot>
  </article>
</template>
`;
    case 1:
      return `${script([])}
<template>
  <table :id="'t${i}-' + count"><tbody><tr v-for="t in tags"><td>{{ t.slice(0, 3) }}</td><td>{{ t.length }}</td></tr></tbody></table>
  <p :style="{ color: on ? 'red' : 'blue', fontSize: count + 'px' }">{{ count * 2 }} {{ title.trim() }}</p>
</template>
`;
    case 2:
      return `${script([])}
<template>
  <form :aria-label="title" class="form-${i}">
    <label v-for="t in tags" :for="t"><input :id="t" :value="t" :disabled="!on" /> {{ t }}</label>
    <button type="submit" v-show="count !== 0">{{ count === 1 ? "one" : "many" }}</button>
  </form>
</template>
`;
    case 3:
      return `${script([i - 1, i - 2, i - 3])}
<template>
  <section class="group-${i}">
    <A :title="title" :count="count" :tags="tags" :on="on" />
    <B v-for="t in tags" :title="t" :count="count + 1" :tags="tags" />
    <C v-if="on" :title="title" :count="0" :tags="tags"><em>{{ title }}</em></C>
  </section>
</template>
`;
    default:
      return `${script([i - 1])}
<template>
  <div class="layout-${i}">
    <header><slot name="header"><h1>{{ title }}</h1></slot></header>
    <A :title="title" :count="count" :tags="tags" :on="!on" />
    <template v-for="(t, n) in tags"><hr v-if="n > 0" />{{ t }}</template>
    <footer v-if="$slots.footer"><slot name="footer" /></footer>
  </div>
</template>
`;
  }
}

const cargoToml = (): string => `[package]
name = "ferrovue-budget"
version = "0.0.0"
edition = "2024"
publish = false

[dependencies]
ferrovue = { path = ${JSON.stringify(join(ROOT, "crates/ferrovue"))} }
serde = { version = "1", features = ["derive"] }

[workspace]
`;

/** Writes the synthetic project of `count` components into `dir`, leaving its `target` in place. */
export function writeProject(dir: string, count: number): void {
  for (const sub of ["components", "src"]) rmSync(join(dir, sub), { recursive: true, force: true });
  mkdirSync(join(dir, "components"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < count; i++) writeFileSync(join(dir, "components", `${name(i)}.vue`), component(i));
  writeFileSync(join(dir, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "src/generated" }) + "\n");
  writeFileSync(join(dir, "Cargo.toml"), cargoToml());
  writeFileSync(join(dir, "src/lib.rs"), "#[rustfmt::skip]\npub mod generated;\n");
  copyFileSync(join(ROOT, "Cargo.lock"), join(dir, "Cargo.lock"));
}

function seconds(run: () => void): number {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / 1e9;
}

const cargo = (args: string[]): void => {
  execFileSync("cargo", [...args, "--manifest-path", join(PROJECT, "Cargo.toml")], {
    cwd: PROJECT,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, CARGO_INCREMENTAL: "0" },
  });
};

const compile = (): void => {
  rmSync(join(PROJECT, "src/generated"), { recursive: true, force: true });
  execFileSync(process.execPath, [CLI], { cwd: PROJECT, stdio: ["ignore", "ignore", "inherit"] });
};

const profile = (step: Step): string[] => (step === "release" ? ["--release"] : []);

function prepare(): void {
  writeProject(PROJECT, COMPONENTS);
  for (const step of ["dev", "release"] as const) cargo(["build", "--quiet", "-p", "ferrovue", ...profile(step)]);
}

function measure(step: Step): number {
  if (step === "compiler") return seconds(compile);
  cargo(["clean", "--quiet", "-p", "ferrovue-budget", ...profile(step)]);
  return seconds(() => cargo(["build", "--quiet", ...profile(step)]));
}

function main(): number {
  prepare();
  const rows = (Object.keys(BUDGETS) as Step[]).map((step) => {
    let measured = measure(step);
    if (measured > BUDGETS[step]) measured = Math.min(measured, measure(step));
    return { step, measured, budget: BUDGETS[step], over: measured > BUDGETS[step] };
  });
  const table = [
    "| Step | Time | Budget |",
    "|---|---|---|",
    ...rows.map((r) => `| ${LABELS[r.step]} | ${r.measured.toFixed(2)} s | ${r.budget} s${r.over ? " (over)" : ""} |`),
  ].join("\n");
  console.log(table);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, `### Build-time budgets\n\n${table}\n`);
  const over = rows.filter((r) => r.over);
  for (const r of over) console.error(`error: ${LABELS[r.step]} took ${r.measured.toFixed(2)} s twice, over its budget of ${r.budget} s`);
  return over.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
