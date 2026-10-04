/* What the browser does with a page ferrovue rendered. */
import type { Pinia } from "pinia";

/** Give Pinia the state the server rendered with — what `ferrovue::state_script_into` wrote — before
 * the app mounts, so every store starts from it and the hydrated markup agrees with the server's. */
export function hydrateState(pinia: Pinia, id = "__pinia", doc: Document = document): void {
  const text = doc.getElementById(id)?.textContent;
  if (text) pinia.state.value = JSON.parse(text) as Pinia["state"]["value"];
}
