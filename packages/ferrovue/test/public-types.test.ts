/* `ferrovue/types` is what components import their special types from; `pnpm typecheck` holds these
 * assertions, and the test proves the module loads. */
import { expect, expectTypeOf, it } from "vitest";
import type { Float, TrustedHtml } from "../src/types.ts";
import * as types from "../src/types.ts";

it("exports TrustedHtml, a branded string, and Float, a number", () => {
  expectTypeOf<TrustedHtml>().toMatchTypeOf<string>();
  expectTypeOf<string>().not.toMatchTypeOf<TrustedHtml>();
  expectTypeOf<Float>().toEqualTypeOf<number>();
  // Types only: nothing exists at run time.
  expect(Object.keys(types)).toEqual([]);
});
