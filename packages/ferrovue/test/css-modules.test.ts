import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { expect, it } from "vitest";
import type { CssModulesConfig, ScopeIdMode } from "../src/context.ts";
import { componentModules, scopedNames } from "../src/plugins/css-modules.ts";
import { componentId } from "../src/plugins/scoped.ts";

const DIR = join(import.meta.dirname, "css-modules");
const REPO = join(import.meta.dirname, "../../..");
const CASES = join(import.meta.dirname, "css-modules.json");
const EXPECTED = join(import.meta.dirname, "css-modules.expected.json");
const FILES = ["Card.vue", "Theme.vue", "sub/Deep.vue"];

type Case = CssModulesConfig & { scopeId?: ScopeIdMode };
type Modules = Record<string, Record<string, Record<string, string>>>;

const cases = JSON.parse(readFileSync(CASES, "utf8")) as Case[];

function viteModules(c: Case): Modules {
  const args = [DIR, FILES, c].map((a) => JSON.stringify(a));
  return JSON.parse(execFileSync(process.execPath, [join(import.meta.dirname, "css-modules-build.ts"), ...args], { cwd: REPO, encoding: "utf8" })) as Modules;
}

it("records the class names Vite gives each CSS module, as each case configures `css.modules`", () => {
  const recorded = cases.map(viteModules);
  if (process.env.FERROVUE_VECTORS_WRITE === "1") {
    writeFileSync(EXPECTED, JSON.stringify(recorded, null, 2) + "\n");
    return;
  }
  expect(recorded).toEqual(JSON.parse(readFileSync(EXPECTED, "utf8")));
}, 120_000);

it("names each CSS module's classes as Vite does", () => {
  const expected = JSON.parse(readFileSync(EXPECTED, "utf8")) as Modules[];
  expect(expected).toHaveLength(cases.length);
  cases.forEach((c, i) => {
    const names = scopedNames(c, REPO);
    for (const f of FILES) {
      const file = join(DIR, f);
      const source = readFileSync(file, "utf8");
      const modules = componentModules(parseSfc(source, { filename: file }).descriptor, file, componentId(file, source, c.scopeId ?? "filepath-source", DIR), names, (_, why) => {
        throw new Error(why);
      });
      expect(Object.fromEntries(modules), `${c.generateScopedName} ${f}`).toEqual(expected[i]![f]);
    }
  });
});
