import { join } from "node:path";

process.chdir(join(import.meta.dirname, "../crates/ferrovue/tests/conformance"));
await import("../packages/ferrovue/src/cli.ts");
