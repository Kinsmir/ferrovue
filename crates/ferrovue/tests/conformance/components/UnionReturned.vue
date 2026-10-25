<script setup lang="ts">
import { computed } from "vue";
import { Mark } from "../types/marks";
import type { Mood } from "../types/tables";

const props = defineProps<{ mood: Mood; mark: Mark; spare?: Mood; label: string }>();

function moodText(): string {
  return props.mood;
}
const markText = (): string => props.mark;
const loose = (): Mood | "-" => props.mood;
const shown = computed((): string => props.mood);
const spared = computed((): string | undefined => props.spare);
</script>

<template>
  <section :title="label">
    <p :class="{ dash: moodText() === '-', calm: moodText() === 'calm', other: markText() !== '-' }" :data-mood="shown">{{ moodText() }} {{ markText() }} {{ loose() }}</p>
    <i v-if="loose() === '-'">dash</i>
    <b v-if="shown === label">same</b>
    <em :class="{ none: spared === undefined, dash: spared === '-' }">{{ spared }} {{ `${shown}/${markText()}` }}</em>
  </section>
</template>
