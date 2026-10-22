import { expect, it } from "vitest";
import { generateCase, printComponent } from "../fuzz/generate.ts";

it("prints a generated component the same way every time", () => {
  for (const seed of [1, 20261020]) {
    for (let i = 0; i < 300; i++) {
      const { component } = generateCase(seed, i);
      expect(printComponent(component), `seed ${seed} case ${i}`).toBe(printComponent(component));
    }
  }
});

it("generates computeds whose bodies hold statements", () => {
  const printed = Array.from({ length: 300 }, (_, i) => printComponent(generateCase(1, i).component));
  expect(printed.some((p) => /computed\(\(\) => \{\n {2}const l\d+_\d+ = /.test(p))).toBe(true);
  expect(printed.some((p) => /\n {2}if \(.*\) return .*;\n/.test(p))).toBe(true);
});

it("generates local functions, called from the template and from computeds", () => {
  const printed = Array.from({ length: 300 }, (_, i) => printComponent(generateCase(1, i).component));
  expect(printed.some((p) => /\nfunction fn0\(a0_0: (?:string|number|boolean)[^)]*\): (?:string|number|boolean) \{\n/.test(p))).toBe(true);
  expect(printed.some((p) => /<template>[^]*\bfn\d\(/.test(p))).toBe(true);
});
