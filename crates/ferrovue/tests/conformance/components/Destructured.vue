<script setup lang="ts">
import { computed } from "vue";

const { title = "Hi", count: n = 0, wide = false, extra } = defineProps<{ title?: string; count?: number; wide?: boolean; extra?: string }>();
const heading = computed(() => `${title} (${n})`);
</script>

<template>
  <h2 :class="{ wide }">{{ heading }}<small v-if="extra">{{ extra }}</small></h2>
</template>
