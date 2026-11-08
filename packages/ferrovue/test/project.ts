import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { generate } from "../src/compiler.ts";

export const roots: string[] = [];

export const CONFIG = { components: "components", out: "out" };

export const compile = (project: string) => generate(project, CONFIG);

export function island(source: string, others: Record<string, string> = {}): string {
  const made = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(made);
  const dir = join(made, "components");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "X.vue"), source);
  for (const [name, text] of Object.entries(others)) writeFileSync(join(dir, `${name}.vue`), text);
  return made;
}

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});
