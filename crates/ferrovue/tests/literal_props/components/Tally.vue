<script setup lang="ts">
import { useTally } from "../stores/tally";

defineProps<{ label: string }>();
const tally = useTally();
</script>

<template>
  <p :class="{ open: tally.open }">{{ label }}: {{ tally.count }} ({{ tally.doubled }}) <b v-if="tally.best !== null">{{ tally.best }}</b></p>
</template>
