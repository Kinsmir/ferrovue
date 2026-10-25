<script setup lang="ts">
import type { Mood } from "../types/tables";

defineProps<{ mood?: Mood; label: string }>();
</script>

<template>
  <b :class="mood" :data-mood="mood">{{ label }} {{ mood }}</b>
</template>
