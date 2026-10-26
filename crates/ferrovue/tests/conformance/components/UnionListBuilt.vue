<script setup lang="ts">
import { computed } from "vue";
import UnionHueSet from "./UnionHueSet.vue";
import UnionListItem from "./UnionListItem.vue";
import type { Hue } from "../types/unions";

interface Swatch {
  name: string;
  hue: Hue;
}

const props = defineProps<{ swatches: Swatch[]; hues: Hue[]; hue: Hue; label: string }>();
const bright = computed(() => props.hues.filter((h) => h !== "green"));
const named = computed(() => props.swatches.filter((s) => s.name !== "").map((s) => s.hue));
</script>

<template>
  <section :title="label">
    <UnionListItem :hues="swatches.map((s) => s.hue)" :label="label" />
    <UnionListItem :hues="hues.map((h) => h)" :extra="hues.filter((h, i) => i > 0 || h === 'red')" :label="label" />
    <UnionListItem :hues="bright" :extra="named" :label="label" />
    <UnionListItem :hues="[hue, 'green']" :extra="[]" :label="label" />
    <UnionHueSet :set="{ hues: [hue, 'red', hue], note: label }" :label="label" />
    <UnionHueSet :set="{ hues: swatches.map((s) => s.hue), note: `${bright.length}` }" :label="label" />
    <p v-for="h in bright" :key="h" :class="h">{{ h }}</p>
  </section>
</template>
