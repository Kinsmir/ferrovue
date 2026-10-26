<script setup lang="ts">
import type { Mood, MoodCard } from "../types/tables";

defineProps<{ mood: Mood; card?: MoodCard; label: string }>();
</script>

<template>
  <b :class="mood" :data-mood="mood">{{ label }} {{ mood }}<i v-if="card" :title="card.mood">{{ card.mood }}|{{ card.spare ?? "none" }}|{{ card.note }}</i></b>
</template>
