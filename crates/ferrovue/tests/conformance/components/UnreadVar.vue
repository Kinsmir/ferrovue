<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ show: boolean; word: string; width: number }>();
const padded = computed(() => props.word.padStart(props.width, "."));
</script>

<template>
  <p v-if="show" class="var">{{ word }}</p>
</template>

<style>
.var {
  width: v-bind(padded);
}
</style>
