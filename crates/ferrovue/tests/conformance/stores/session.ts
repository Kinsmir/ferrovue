import { defineStore } from "pinia";
import { computed, ref } from "vue";

export const useSession = defineStore("session", () => {
  const user = ref<string | null>(null);
  const visits = ref<number | null>(null);
  const greeting = computed(() => user.value ?? "guest");
  function signOut() {
    user.value = null;
  }
  return { user, visits, greeting, signOut };
});
