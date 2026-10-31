<script setup lang="ts">
import LABEL, { GREETING, ORDERS, Tone, loud } from "./exported";

defineProps<{ name: string; tone: "calm" | "loud" }>();
</script>

<template>
  <p :class="tone === Tone.Loud ? Tone.Loud : Tone.Calm" :title="name">{{ GREETING }}, {{ tone === Tone.Loud ? loud(name) : name }}</p>
  <span v-for="s in ORDERS" :key="s" :data-label="LABEL">{{ s }} {{ name }}</span>
</template>
