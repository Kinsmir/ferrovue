import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RouteEntry, RouterOptions } from "../src/fixture.ts";

export { clientRenderDifference, HEAD, hydrationBody, placeHead, recordedHead, renderFixture, TELEPORTS } from "../src/conformance.ts";
export { headRendered } from "../src/settle.ts";

export const ROOT = join(import.meta.dirname, "../../../crates/ferrovue/tests/conformance");
const FIXTURES = join(ROOT, "fixtures");
export const ROUTES = JSON.parse(readFileSync(join(ROOT, "routes.json"), "utf8")) as RouteEntry[];
const CONFIG = JSON.parse(readFileSync(join(ROOT, "ferrovue.config.json"), "utf8")) as {
  i18n?: { messages: string; locale?: string; fallbackLocale?: string | string[] };
};
const I18N = CONFIG.i18n && {
  messages: Object.fromEntries(
    readdirSync(join(ROOT, CONFIG.i18n.messages))
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f.slice(0, -".json".length), JSON.parse(readFileSync(join(ROOT, CONFIG.i18n!.messages, f), "utf8")) as unknown]),
  ),
  locale: CONFIG.i18n.locale ?? "en",
  ...(CONFIG.i18n.fallbackLocale !== undefined ? { fallbackLocale: CONFIG.i18n.fallbackLocale } : {}),
};
export const OPTIONS: RouterOptions = I18N ? { i18n: I18N } : {};

export const VUE_DISAGREES = new Set(["Hollow/absent.json", "Hollow/absent-on.json", "Hollow/whitespace.json", "Hollow/js-whitespace.json", "App/empty-view.json"]);

export const UNHEAD_REWRITES = new Set(["HeadPage/hostile.json", "HeadLater/hostile.json", "HeadNest/hostile.json"]);

export const CLIENT_ONLY: Record<string, string> = { ClientSide: 'class="gauge measured" max="100"' };

export interface Case {
  component: string;
  name: string;
  base: string;
  json: Record<string, unknown>;
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
        }
        return { component: d.name, name: f, base, json: JSON.parse(readFileSync(`${base}.json`, "utf8")) as Record<string, unknown>, html };
      }),
  );
