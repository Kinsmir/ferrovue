import { expect, it } from "vitest";
import { componentShrinks, fixtureJson, fixtureShrinks, generateCase, helperFiles, printComponent, withLoads } from "../fuzz/generate.ts";
import { compileFailure } from "../fuzz/classify.ts";
import { GenError, GenErrors } from "../src/errors.ts";

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

it("generates components that await loaders, and children that await their own", () => {
  const cases = Array.from({ length: 300 }, (_, i) => generateCase(1, i));
  const printed = cases.map((c) => printComponent(c.component));
  const files = cases.flatMap((c) => helperFiles(c.component));
  expect(printed.some((p) => /\nconst ld\d+ = await fzLoad\d+\(.*props\.\w+/.test(p))).toBe(true);
  expect(printed.some((p) => /\nconst \{ [^}]+ \} = await fzLoad\d+\(/.test(p))).toBe(true);
  expect(printed.some((p) => /\nawait fzLoad\d+\(/.test(p))).toBe(true);
  expect(printed.some((p) => /\nconst ld\d+ = await fzLoad\d+\([^)]*\b(?:ld|dz)\d+\b/.test(p))).toBe(true);
  expect(files.some(([f, text]) => f === "FzLd0.vue" && text.includes("<FzLd1 ") && text.includes("await fzLoad"))).toBe(true);
  expect(files.some(([f, text]) => f === "fz-loaders.ts" && /\w+: \w+ \| null/.test(text) && /p\d\?: /.test(text))).toBe(true);
});

it("gives each fixture a result for exactly the calls its render makes, the same every time", () => {
  let loaded = 0;
  for (let i = 0; i < 300; i++) {
    const first = generateCase(20261020, i);
    const again = generateCase(20261020, i);
    expect(helperFiles(again.component)).toEqual(helperFiles(first.component));
    first.fixtures.forEach((f, n) => {
      expect(fixtureJson(again.fixtures[n]!)).toBe(fixtureJson(f));
      expect(fixtureJson(withLoads(first.component, f))).toBe(fixtureJson(f));
      if (!f.$loads) return;
      loaded++;
      for (const key of Object.keys(f.$loads)) expect(key).toMatch(/^\["fzLoad\d+"[,\]]/);
    });
  }
  expect(loaded).toBeGreaterThan(100);
});

it("shrinks a fixture's results, and settles the calls after a prop shrinks", () => {
  const cases = Array.from({ length: 300 }, (_, i) => generateCase(1, i));
  const c = cases.find((x) => x.component.loads?.awaits.some((a) => a.args.some((g) => g.k === "ref" && g.path[0] === "props")))!;
  const f = c.fixtures[0]!;
  const shrinks = fixtureShrinks(c.component, f);
  expect(shrinks.some((s) => JSON.stringify(s.$loads) !== JSON.stringify(f.$loads))).toBe(true);
  for (const s of shrinks) expect(fixtureJson(withLoads(c.component, s))).toBe(fixtureJson(s));
  for (const x of componentShrinks(c.component)) {
    const fitted = withLoads(x, f);
    expect(fixtureJson(withLoads(x, fitted))).toBe(fixtureJson(fitted));
  }
});

it("counts a GenError out of the compiler as a refusal, and any other throw as a crash with its stack", () => {
  const one = new GenError("FV0601", "components/X.vue:1:1: `x` is not available");
  expect(compileFailure(one)).toEqual({ k: "refused", message: one.message });
  expect(compileFailure(new GenErrors([one]))).toEqual({ k: "refused", message: one.message });
  expect(compileFailure(new TypeError("Cannot read properties of undefined (reading 'typeAnnotation')"))).toEqual({
    k: "crash",
    stack: expect.stringMatching(/^TypeError: Cannot read properties of undefined \(reading 'typeAnnotation'\)\n {4}at /),
  });
  expect(compileFailure(new SyntaxError("Unexpected token"))).toEqual({ k: "crash", stack: expect.stringMatching(/^SyntaxError: Unexpected token\n {4}at /) });
  expect(compileFailure("thrown text")).toEqual({ k: "crash", stack: "a thrown value that is no Error: 'thrown text'" });
  expect(compileFailure(Object.create(null))).toEqual({ k: "crash", stack: "a thrown value that is no Error: [Object: null prototype] {}" });
});
