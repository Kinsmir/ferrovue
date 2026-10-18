import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LAUNCHERS = { chromium, firefox, webkit };
const BROWSERS = (process.env.FERROVUE_BROWSERS ?? "chromium,firefox,webkit").split(",") as (keyof typeof LAUNCHERS)[];
const ZONES = ["Pacific/Kiritimati", "America/St_Johns", "Asia/Kathmandu", "UTC"];

type Vector = [string, string, unknown];

const VECTORS = (JSON.parse(readFileSync(join(import.meta.dirname, "../../../crates/ferrovue/tests/vectors/dates.json"), "utf8")) as Vector[]).filter(
  ([op, , want]) => op !== "parse" || want !== null,
);

function differences(vectors: Vector[]): string[] {
  const shown = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));
  const run = (op: string, input: string): unknown => {
    if (op === "parse") return shown(Date.parse(input));
    if (op === "Date") return shown(new Date(Number(input)).getTime());
    const date = new Date(Number(input)) as unknown as Record<string, () => unknown>;
    try {
      const got = date[op]!.call(date);
      return typeof got === "string" ? got : shown(got as number);
    } catch (e) {
      return e instanceof RangeError ? { throws: "RangeError" } : String(e);
    }
  };
  return vectors.flatMap(([op, input, want]) => {
    const got = run(op, input);
    return JSON.stringify(got) === JSON.stringify(want) ? [] : [`${op}(${JSON.stringify(input)}): ${JSON.stringify(got)}, recorded ${JSON.stringify(want)}`];
  });
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

  for (const zone of ZONES) {
    it(`reads every date ferrovue accepts as Node does, in ${zone}`, async ({ skip }) => {
      if (!browser) skip();
      const context = await browser!.newContext({ timezoneId: zone });
      const page = await context.newPage();
      const found = await page.evaluate(`(${differences.toString()})(${JSON.stringify(VECTORS)})`);
      await context.close();
      expect(found).toEqual([]);
    });
  }
});
