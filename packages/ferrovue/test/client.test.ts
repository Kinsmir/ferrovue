import { expect, it } from "vitest";
import { createPinia } from "pinia";
import { hydrateState } from "../src/client.ts";

it("hands Pinia the state the server escaped into the page", () => {
  // What `state_script_into` writes for a label of `</script>&`.
  document.body.innerHTML =
    '<script type="application/json" id="__pinia">{"prefs":{"label":"\\u003c/script\\u003e\\u0026"}}</script>';
  const pinia = createPinia();
  hydrateState(pinia);
  expect(pinia.state.value).toEqual({ prefs: { label: "</script>&" } });
});

it("reads back the bare NaN and infinities the server writes for numbers JSON cannot carry", () => {
  // What `state_script_into` writes for them, beside strings holding the same letters, quotes,
  // backslashes and NULs, which stay strings.
  document.body.innerHTML =
    '<script type="application/json" id="__pinia">{"m":{"a":NaN,"b":[Infinity,-Infinity,-0.0,1.5],"c":"NaN","d":"\\"Infinity\\\\","e":"\\u0000NaN","f":["\\u0000\\u0000-Infinity",null]}}</script>';
  const pinia = createPinia();
  hydrateState(pinia);
  expect(pinia.state.value).toEqual({
    m: { a: Number.NaN, b: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 1.5], c: "NaN", d: '"Infinity\\', e: "\u0000NaN", f: ["\u0000\u0000-Infinity", null] },
  });
  expect(Object.is((pinia.state.value.m as { b: number[] }).b[2], -0)).toBe(true);
});

it("still refuses what is not JSON when it holds the same letters", () => {
  document.body.innerHTML = '<script type="application/json" id="__pinia">{"a":NaNx}</script>';
  expect(() => hydrateState(createPinia())).toThrow(SyntaxError);
});

it("leaves Pinia alone when the page carries no state", () => {
  document.body.innerHTML = "";
  const pinia = createPinia();
  hydrateState(pinia);
  expect(pinia.state.value).toEqual({});
});
