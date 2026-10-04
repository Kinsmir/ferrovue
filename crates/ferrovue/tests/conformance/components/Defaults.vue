<script setup lang="ts">
/* `withDefaults`: what an absent prop reads as, including the `false` Vue casts a boolean to. */
import { computed } from "vue";

const props = withDefaults(defineProps<{ label?: string; size?: number; on?: boolean; tags?: string[]; plain?: boolean; note?: string }>(), {
  label: "untitled",
  size: -1,
  on: true,
  tags: () => [],
});
const summary = computed(() => props.label + ":" + props.size);
</script>

<template>
  <p :class="['d', on ? 'on' : 'off']" :data-size="size" :hidden="plain">{{ summary }}|{{ label }}|{{ on }}|{{ plain }}|{{ note }}|{{ tags.length }}<b v-for="t in tags">{{ t }}</b></p>
</template>
