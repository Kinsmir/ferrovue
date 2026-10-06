import { defineStore } from "pinia";
import { computed, ref } from "vue";

export const useTally = defineStore("tally", () => {
  const count = ref(0);
  const open = ref(false);
  const best = ref<number | null>(null);
  const doubled = computed(() => count.value * 2);
  return { count, open, best, doubled };
});
