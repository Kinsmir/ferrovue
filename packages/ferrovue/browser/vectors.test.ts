import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LAUNCHERS = { chromium, firefox, webkit };
const BROWSERS = (process.env.FERROVUE_BROWSERS ?? "chromium,firefox,webkit").split(",") as (keyof typeof LAUNCHERS)[];
const CORE = join(import.meta.dirname, "../../../crates/ferrovue-core/tests/vectors");
const read = (name: string): unknown[] => JSON.parse(readFileSync(join(CORE, name), "utf8")) as unknown[];

const MATH = read("math.json") as [string, string, string, string][];
const URI = read("uri.json") as [string, string, string][];

function differences(math: [string, string, string, string][], uri: [string, string, string][]): string[] {
  const text = (n: number): string => (Object.is(n, -0) ? "-0" : String(n));
  const run = (op: string, x: string, arg: string): string => {
    switch (op) {
      case "round":
        return text(Math.round(Number(x)));
      case "toFixed":
        return Number(x).toFixed(Number(arg));
      case "max":
        return text(Math.max(Number(x), Number(arg)));
      case "min":
        return text(Math.min(Number(x), Number(arg)));
      case "sqrt":
        return text(Math.sqrt(Number(x)));
      case "sign":
        return text(Math.sign(Number(x)));
      case "constant":
        return text((Math as unknown as Record<string, number>)[x]!);
      case "pow":
        return Number(x) ** Number(arg) === Math.pow(Number(x), Number(arg)) ? text(Number(x) ** Number(arg)) : "** and Math.pow differ";
      default:
        return `unknown ${op}`;
    }
  };
  const found = math.flatMap(([op, x, arg, want]) => {
    const got = run(op, x, arg);
    return got === want ? [] : [`${op}(${x}, ${arg}): ${got}, recorded ${want}`];
  });
  for (const [op, input, want] of uri) {
    const got = op === "encodeURI" ? encodeURI(input) : encodeURIComponent(input);
    if (got !== want) found.push(`${op}(${JSON.stringify(input)}): ${got}, recorded ${want}`);
  }
  return found;
}

describe.each(BROWSERS)("%s", (name) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    try {
      browser = await LAUNCHERS[name].launch();
    } catch (e) {
      if (process.env.CI) throw e;
      console.warn(`${name} does not launch here, so its tests are skipped:`, String(e).split("\n")[0]);
    }
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("computes math.json and uri.json as Node recorded them", async ({ skip }) => {
    if (!browser) skip();
    const page = await browser!.newPage();
    const found = await page.evaluate(`(${differences.toString()})(${JSON.stringify(MATH)}, ${JSON.stringify(URI)})`);
    await page.close();
    expect(found).toEqual([]);
  });
});
