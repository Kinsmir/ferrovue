<script setup lang="ts">
import { onMounted, ref } from "vue";
const props = defineProps<{ label: string; items: string[] }>();
const fresh = ref(0);
const live = ref(false);
const ready = ref(true);
const ratio = ref(1.5);
const missing = ref(NaN);
const zero = ref(-0);
onMounted(() => {
  fresh.value = 3;
  live.value = true;
  ready.value = false;
  ratio.value = 0;
  missing.value = 1;
  zero.value = 2;
});
</script>

<template>
  <ul :data-live="live" :data-ratio="ratio">
    <li v-if="fresh > 0" :title="fresh + ' new'">+{{ fresh }}</li>
    <li v-else-if="fresh === 0">{{ label }} none</li>
    <li v-for="(item, n) in items" :class="[live && n !== 0 ? 'hidden' : '', ready ? 'ready' : '']">{{ item }}{{ live ? '!' : '' }}</li>
    <li v-if="missing">nan</li>
    <li v-if="!missing && missing !== missing">{{ missing }}|{{ ratio * 2 }}|{{ 1 / zero }}|{{ zero }}</li>
    <li v-show="!live">{{ ratio > 1 ? label : "low" }}</li>
  </ul>
</template>
