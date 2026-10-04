import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { Float } from "ferrovue/types";

/* A setup store: its returned refs are the state, its computeds the getters, its functions actions. */
export const useCounter = defineStore("counter", () => {
  const count = ref(0);
  const step = ref<Float>(0.5);
  const label = ref("clicks");
  const history = ref<number[]>([]);
  const owner = ref<string>();
  const secret = ref("not returned, so not state");
  const doubled = computed(() => count.value * 2);
  const summary = computed(() => {
    return `${doubled.value} ${label.value}`;
  });
  function increment() {
    count.value += 1;
    history.value.push(count.value);
    void secret.value;
  }
  return { count, step, label, history, owner, doubled, summary, increment };
});
