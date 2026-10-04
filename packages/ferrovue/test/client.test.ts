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

it("leaves Pinia alone when the page carries no state", () => {
  document.body.innerHTML = "";
  const pinia = createPinia();
  hydrateState(pinia);
  expect(pinia.state.value).toEqual({});
});
