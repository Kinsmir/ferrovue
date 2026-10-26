<script setup lang="ts">
import { ref } from "vue";
import UnionBadge from "./UnionBadge.vue";
import UnionMoodCard from "./UnionMoodCard.vue";
import { MOOD_PREVIEW, NEXT_MOOD, type Mood } from "../types/tables";

const props = defineProps<{ start?: Mood; label: string }>();
const mood = ref<Mood | "">(props.start ?? "");
</script>

<template>
  <section :title="label">
    <UnionBadge :mood="mood || undefined" :label="label" />
    <UnionBadge :mood="mood === '' ? undefined : mood" :label="label" />
    <UnionBadge :mood="mood === 'calm' ? undefined : mood || undefined" :label="label" />
    <UnionMoodCard :mood="mood || 'calm'" :label="label" />
    <UnionMoodCard :mood="mood !== '' ? mood : 'loud'" :label="label" />
    <UnionMoodCard :mood="MOOD_PREVIEW[mood]" :card="{ mood: mood || 'loud', spare: mood || undefined, note: label }" :label="label" />
    <UnionMoodCard v-if="mood" :mood="mood" :card="{ mood, spare: mood, note: `${mood}!` }" :label="label" />
    <i v-else>{{ label }} none</i>
    <i v-if="mood === ''">empty</i>
    <UnionMoodCard v-else-if="mood === 'calm'" :mood="mood" label="calm" />
    <UnionMoodCard v-else :mood="NEXT_MOOD[mood]" :label="label" />
    <template v-if="mood !== 'loud'">
      <UnionBadge :mood="mood || undefined" :label="`${mood}`" />
      <UnionBadge :mood="mood === '' ? undefined : mood" :label="label" />
    </template>
    <UnionMoodCard v-if="label !== '' && mood !== '' && mood !== 'calm'" :mood="mood" :label="label" />
  </section>
</template>
