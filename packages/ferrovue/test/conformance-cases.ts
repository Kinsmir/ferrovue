/* The conformance suite's inputs, as both of its Vue halves read them: the fixtures with their
 * recorded HTML, the routes and locales of `crates/ferrovue/tests/conformance/`, and the page a
 * fixture's HTML is hydrated in — in happy-dom (`conformance.test.ts`) and in real browsers
 * (`packages/ferrovue/browser/`). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RouteEntry, RouterOptions } from "../src/fixture.ts";

export const ROOT = join(import.meta.dirname, "../../../crates/ferrovue/tests/conformance");
const FIXTURES = join(ROOT, "fixtures");
export const ROUTES = JSON.parse(readFileSync(join(ROOT, "routes.json"), "utf8")) as RouteEntry[];
const CONFIG = JSON.parse(readFileSync(join(ROOT, "ferrovue.config.json"), "utf8")) as {
  i18n?: { messages: string; locale?: string; fallbackLocale?: string | string[] };
};
/** The project's locales, as vue-i18n is given them. */
const I18N = CONFIG.i18n && {
  messages: Object.fromEntries(
    readdirSync(join(ROOT, CONFIG.i18n.messages))
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f.slice(0, -".json".length), JSON.parse(readFileSync(join(ROOT, CONFIG.i18n!.messages, f), "utf8")) as unknown]),
  ),
  locale: CONFIG.i18n.locale ?? "en",
  ...(CONFIG.i18n.fallbackLocale !== undefined ? { fallbackLocale: CONFIG.i18n.fallbackLocale } : {}),
};
/** The options `fixtureApp` is given for every fixture. */
export const OPTIONS: RouterOptions = I18N ? { i18n: I18N } : {};
/** Where a fixture's recorded HTML continues with what was teleported, as JSON by target. */
export const TELEPORTS = "<!--fv-teleports-->";

export interface Case {
  component: string;
  /** The fixture's file name, `case.json`. */
  name: string;
  /** Its path without the extension, where the `.json` and `.html` sit. */
  base: string;
  json: Record<string, unknown>;
  /** The recorded HTML, empty for a new fixture. */
  html: string;
}

export const cases: Case[] = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(join(FIXTURES, d.name))
      .filter((f) => f.endsWith(".json"))
      .toSorted()
      .map((f) => {
        const base = join(FIXTURES, d.name, f.slice(0, -".json".length));
        let html = "";
        try {
          html = readFileSync(`${base}.html`, "utf8");
        } catch {
          // A new fixture: only a write run can supply its expected output.
        }
        return { component: d.name, name: f, base, json: JSON.parse(readFileSync(`${base}.json`, "utf8")) as Record<string, unknown>, html };
      }),
  );

/** The body of the page a fixture's recorded HTML is hydrated in: the render in `#root`, and
 * teleported content in its targets, as a page places it — a teleport to `body` from the body's
 * first node, which is where Vue hydrates it from. */
export function hydrationBody(html: string): string {
  const [main, teleported] = html.split(TELEPORTS);
  const targets = Object.entries(JSON.parse(teleported ?? "{}") as Record<string, string>);
  const intoBody = targets.filter(([t]) => t === "body").map(([, content]) => content).join("");
  const elsewhere = targets
    .filter(([t]) => t !== "body")
    .map(([t, content]) => `<div id="${t.replace(/^#/, "")}">${content}</div>`)
    .join("");
  return `${intoBody}<div id="root">${main}</div>${elsewhere}`;
}
