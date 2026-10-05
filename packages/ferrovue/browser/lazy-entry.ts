import type { Component } from "vue";
import { mountIslands } from "../src/client.ts";

const DIR = "../../../crates/ferrovue/tests/conformance/components";
const eager = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/Text.vue", { eager: true });
const lazy = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/{Attrs,Lists}.vue");

declare global {
  interface Window {
    islands?: Promise<unknown>;
  }
}

window.islands = mountIslands({
  Text: eager[`${DIR}/Text.vue`]!.default,
  Attrs: lazy[`${DIR}/Attrs.vue`]!,
  Lists: lazy[`${DIR}/Lists.vue`]!,
});
