import { resolve } from "node:path";

const [project, ...args] = process.argv.slice(2);
if (!project) {
  console.error("usage: node scripts/ferrovue-in.ts <project directory> [ferrovue arguments]");
  process.exit(2);
}
process.chdir(resolve(import.meta.dirname, "..", project));
process.argv.splice(2, process.argv.length, ...args);
await import("../packages/ferrovue/src/cli.ts");
