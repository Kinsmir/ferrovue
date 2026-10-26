<script setup lang="ts">
import { computed } from "vue";
import UnionBadge from "./UnionBadge.vue";
import UnionMoodCard from "./UnionMoodCard.vue";
import { NEXT_MOOD, type Mood } from "../types/tables";

const props = defineProps<{ mood: Mood; on: boolean; count: number; label: string }>();
const picked = computed((): Mood => (props.on ? "loud" : "calm"));
const stepped = computed((): Mood => {
  if (props.count > 2) return "<q>&\"x'";
  return props.on ? "calm" : "loud";
});
const next = computed<Mood>(() => NEXT_MOOD[props.mood]);
const kept = computed((): Mood => (props.label === "" ? "calm" : props.mood));
</script>

<template>
  <section :title="label">
    <UnionMoodCard :mood="picked" :label="label" />
    <UnionMoodCard :mood="stepped" :card="{ mood: stepped, spare: next, note: label }" :label="label" />
    <UnionBadge :mood="next" :label="label" />
    <UnionBadge :mood="kept" :label="`${kept}`" />
    <p :data-picked="picked">{{ picked }}|{{ stepped }}|{{ next }}|{{ kept }}|{{ picked === "loud" }}</p>
  </section>
</template>
