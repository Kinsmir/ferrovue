<script setup lang="ts">
import { ref } from "vue";
import UnionBadge from "./UnionBadge.vue";
import { MOOD_LABEL, MOOD_PREVIEW, NEXT_MOOD, PLAIN_MOOD, SOME_MOOD, type Mood, type MoodChoice } from "../types/tables";

const props = defineProps<{ mood: Mood; pick?: Mood; on: boolean; label: string }>();
const choice = ref<MoodChoice>(props.pick ?? "");
const other = ref<MoodChoice>(props.on ? props.mood : "");
</script>

<template>
  <section :title="label">
    <UnionBadge :mood="NEXT_MOOD[mood]" :label="label" />
    <UnionBadge :mood="PLAIN_MOOD[mood]" :label="MOOD_LABEL[choice]" />
    <UnionBadge :mood="SOME_MOOD[mood]" :label="label" />
    <UnionBadge :mood="MOOD_PREVIEW[choice]" :label="MOOD_LABEL[other]" />
    <UnionBadge :mood="NEXT_MOOD[MOOD_PREVIEW[other]]" :label="label" />
    <p :data-choice="choice">{{ MOOD_LABEL[NEXT_MOOD[mood]] }} {{ choice }} {{ other }}</p>
    <i v-if="NEXT_MOOD[mood] === 'loud'">loud next</i>
    <select v-model="choice">
      <option value="">none</option>
      <option value="calm">calm</option>
      <option value="loud">loud</option>
      <option value="<q>&amp;&quot;x'">odd</option>
    </select>
  </section>
</template>
