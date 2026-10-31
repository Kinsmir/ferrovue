<script setup lang="ts">
import LABEL, { loud } from "./exported";
import { GREETING, LABEL as NAMED, ORDERS, Tone, yell } from "./exported-all";

defineProps<{ name: string; tone: "calm" | "loud" }>();
</script>

<template>
  <p :class="tone === Tone.Loud ? Tone.Loud : Tone.Calm" :title="name">{{ GREETING }}, {{ tone === Tone.Loud ? loud(name) : name }} {{ yell(NAMED) }}</p>
  <span v-for="s in ORDERS" :key="s" :data-label="LABEL">{{ s }} {{ name }}</span>
</template>
