<script setup lang="ts">
import { ref } from "vue";
import UnionBadge from "./UnionBadge.vue";
import UnionMoodCard from "./UnionMoodCard.vue";
import { NEXT_MOOD, type Mood } from "../types/tables";

const props = defineProps<{ start?: Mood; note?: string; count?: number; label: string }>();
const mood = ref<Mood | "" | undefined>(props.start);
</script>

<template>
  <section :title="label">
    <UnionMoodCard :mood="mood || 'calm'" :label="label" />
    <UnionMoodCard :mood="mood ? mood : 'loud'" :card="{ mood: mood || 'loud', spare: mood || undefined, note: note || label }" :label="label" />
    <UnionBadge :mood="mood === '' || mood === undefined ? undefined : mood" :label="label" />
    <UnionBadge :mood="NEXT_MOOD[mood || 'calm']" :label="note || '-'" />
    <UnionMoodCard v-if="mood" :mood="mood" :label="`${mood}`" />
    <i v-else>{{ label }} none</i>
    <i v-if="mood === ''">empty</i>
    <UnionBadge v-else-if="mood !== undefined" :mood="mood" :label="label" />
    <p :data-mood="mood || 'none'">{{ mood ? mood : "none" }}|{{ mood === "" }}|{{ note || "no note" }}|{{ count || 7 }}</p>
  </section>
</template>
