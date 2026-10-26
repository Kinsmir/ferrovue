<script setup lang="ts">
import type { HueSet } from "../types/unions";

defineProps<{ set: HueSet; label: string }>();
</script>

<template>
  <ol :title="label"><li v-for="(h, i) in set.hues" :key="i" :class="h">{{ h }}</li><li>{{ set.note }}</li></ol>
</template>
