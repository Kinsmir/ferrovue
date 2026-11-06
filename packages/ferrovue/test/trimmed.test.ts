import { join } from "node:path";
import { describe, it } from "vitest";
import type { Component } from "vue";
import { registerConformance } from "../src/conformance.ts";

const components = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/trimmed/components/*.vue", { eager: true });

registerConformance({ describe, it }, { config: join(import.meta.dirname, "../../../crates/ferrovue/tests/trimmed/ferrovue.config.json"), components, clientRender: true });
