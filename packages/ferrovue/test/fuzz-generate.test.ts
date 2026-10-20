import { expect, it } from "vitest";
import { generateCase, printComponent } from "../fuzz/generate.ts";

// The pruner reads the printed text to drop the props a component never reads,
// so printing must draw nothing from the generator's random stream. The nightly
// fuzz of 2026-10-20 printed `[...l1, ...l0]` after l0 had been pruned.
it("prints a generated component the same way every time", () => {
  for (const seed of [1, 20261020]) {
    for (let i = 0; i < 300; i++) {
      const { component } = generateCase(seed, i);
      expect(printComponent(component), `seed ${seed} case ${i}`).toBe(printComponent(component));
    }
  }
});
