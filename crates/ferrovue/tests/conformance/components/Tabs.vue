<script setup lang="ts">
import { computed, provide, reactive, ref } from "vue";
import { SelectKey, TabsKey } from "../types/keys";

const props = defineProps<{ active: string; count: number; title: string }>();
const active = computed(() => props.active);
const chosen = ref("");
provide(TabsKey, reactive({ active, count: props.count }));
provide(SelectKey, (name: string) => {
  chosen.value = name;
});
</script>

<template>
  <div class="tabs">
    <h2>{{ title }}</h2>
    <slot />
  </div>
</template>
