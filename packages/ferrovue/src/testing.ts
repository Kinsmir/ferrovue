import type { Component } from "vue";
import { registerConformance } from "./conformance.ts";
import type { RouterOptions } from "./testing-browser.ts";
import { peer } from "./peer.ts";

/** What `conformanceSuite` checks: the project, its components and its fixtures. `pinia`,
 * `vueRouter` and `vueI18n` are the application's own modules (`pinia: await import("pinia")`),
 * which the fixtures install so that its stores and composables find them. */
export interface ConformanceOptions extends Pick<RouterOptions, "pinia" | "vueRouter" | "vueI18n"> {
  /** The project's `ferrovue.config.json`. */
  config: string;
  /** Every component in the configured `components` directory, by file name or by the path
   * `import.meta.glob` gives it: `import.meta.glob("../components/*.vue", { eager: true })`; and
   * with a folder of pages, every page, by the path `import.meta.glob("../pages/**\/*.vue")` gives
   * it or by its component name (`BooksId`). */
  components: Record<string, Component | { default: Component }>;
  /** The fixtures, one directory per component holding `<case>.json` and `<case>.html`:
   * `fixtures` beside the configuration when not given. */
  fixtures?: string;
  /** Write each fixture's `.html` from Vue's render, with no comparison: when
   * `FERROVUE_FIXTURES_WRITE=1` is set, if not given. */
  record?: boolean | undefined;
  /** Check that a fresh client render of each fixture shows its recorded HTML, which an
   * application that navigates between pages relies on: on when `clientDiffers` is given. */
  clientRender?: boolean;
  /** The fixtures (`Component/case.json`) whose fresh client render Vue itself makes differ from
   * its server render, which the check of client renders then expects to differ: a `v-model`
   * `<select>` whose value matches no option, which the client leaves with none selected; an
   * attribute such as `disabled` bound on an element with no such property, which the client
   * writes as `"true"`; a `<TransitionGroup>`'s `name`, which only the server writes; a slot's scope
   * ids; and an async component beside a `<ClientOnly>`, whose content shows by the time the
   * component has loaded. */
  clientDiffers?: string[];
}

/** Register vitest tests holding a project's components to Vue, as ferrovue's own suite does:
 * every component has fixtures and every fixture a component, the generated Rust is what the
 * generator writes now, Vue renders each fixture to its recorded `.html` (or records it, with
 * `FERROVUE_FIXTURES_WRITE=1`), each recorded `.html` hydrates with no warning and the server's
 * nodes kept. With `clientRender` or `clientDiffers`, a fresh client render of each fixture shows
 * its recorded `.html`, as `clientRenderDifference` compares them, except the fixtures listed in
 * `clientDiffers`: what an application that navigates between pages relies on when it renders the
 * next page from its record. Await it at the top of a test file run in a DOM environment such as happy-dom. */
export async function conformanceSuite(options: ConformanceOptions): Promise<void> {
  const vitest = await peer("vitest", "`conformanceSuite` registers vitest tests", () => import("vitest"));
  registerConformance(vitest, options);
}
