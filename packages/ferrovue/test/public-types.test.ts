import { expect, expectTypeOf, it } from "vitest";
import type { Float, InlineHtml, TrustedHtml } from "../src/types.ts";
import * as types from "../src/types.ts";

it("exports TrustedHtml, a branded string, and Float, a number", () => {
  expectTypeOf<TrustedHtml>().toMatchTypeOf<string>();
  expectTypeOf<string>().not.toMatchTypeOf<TrustedHtml>();
  expectTypeOf<Float>().toEqualTypeOf<number>();
  expect(Object.keys(types)).toEqual([]);
});

it("exports InlineHtml, a TrustedHtml that no other TrustedHtml is", () => {
  expectTypeOf<InlineHtml>().toMatchTypeOf<TrustedHtml>();
  expectTypeOf<TrustedHtml>().not.toMatchTypeOf<InlineHtml>();
  expectTypeOf<string>().not.toMatchTypeOf<InlineHtml>();
});
