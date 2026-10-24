import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generate } from "./guide.ts";

const site = import.meta.dirname;
for (const dir of ["guide", ".generated"]) rmSync(join(site, dir), { recursive: true, force: true });
const files = generate();
for (const [path, content] of files) {
  mkdirSync(dirname(join(site, path)), { recursive: true });
  writeFileSync(join(site, path), content);
}
console.log(`wrote ${files.size} pages from the guide, the crate's front page, the changelog and the README`);
