<script setup lang="ts">
import { ref } from "vue";
import UnionBadge from "./UnionBadge.vue";
import UnionMoodCard from "./UnionMoodCard.vue";
import { MOOD_PREVIEW, NEXT_MOOD, SOME_MOOD, type Mood } from "../types/tables";

const props = defineProps<{ start?: Mood; on: boolean; label: string }>();
const mood = ref<Mood | "">(props.start ?? "");
const QUIET = { calm: true, loud: false, "<q>&\"x'": false } as const;
</script>

<template>
  <section :title="label">
    <UnionMoodCard :mood="NEXT_MOOD[mood || 'calm']" :label="label" />
    <UnionMoodCard :mood="NEXT_MOOD[mood !== '' ? mood : 'loud']" :card="{ mood: MOOD_PREVIEW[mood || 'loud'], note: label }" :label="label" />
    <UnionBadge :mood="NEXT_MOOD[on ? 'loud' : 'calm']" :label="label" />
    <UnionBadge :mood="SOME_MOOD[mood || 'calm']" :label="label" />
    <p :data-next="NEXT_MOOD[mood || 'calm']">{{ NEXT_MOOD[mood || "<q>&\"x'"] }}|{{ QUIET[mood || "loud"] }}|{{ SOME_MOOD[mood || "calm"] ?? "none" }}</p>
  </section>
</template>
