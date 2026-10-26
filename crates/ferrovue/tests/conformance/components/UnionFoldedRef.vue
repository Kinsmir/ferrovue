<script setup lang="ts">
import { ref } from "vue";
import UnionBadge from "./UnionBadge.vue";
import UnionChoiceTag from "./UnionChoiceTag.vue";
import UnionMoodCard from "./UnionMoodCard.vue";
import type { Mood } from "../types/tables";

const K = "y";
const loud = ref<Mood | "">(K === "x" ? "calm" : "loud");
const odd = ref<Mood | "">(K === "y" ? "<q>&\"x'" : "");
const none = ref<Mood | "">(K === "x" ? "loud" : "");

defineProps<{ label: string }>();
</script>

<template>
  <section :title="label">
    <UnionBadge :mood="loud || undefined" :label="label" />
    <UnionBadge :mood="none || undefined" :label="label" />
    <UnionMoodCard :mood="loud || 'calm'" :label="label" />
    <UnionMoodCard :mood="odd || 'calm'" :label="label" />
    <UnionMoodCard :mood="none || 'calm'" :label="label" />
    <UnionMoodCard :mood="none === '' ? 'calm' : none" :card="{ mood: loud || 'calm', spare: odd || undefined, note: label }" :label="label" />
    <UnionChoiceTag :choice="loud" :label="label" />
    <UnionChoiceTag :choice="odd" :label="label" />
    <UnionChoiceTag :choice="none" :label="label" />
    <p :data-loud="loud">{{ loud }}|{{ odd }}|{{ none }}|{{ none === "" }}|{{ loud !== "loud" }}|{{ odd === "calm" }}</p>
  </section>
</template>
