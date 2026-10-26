<script setup lang="ts">
import { loadFound } from "./loaders";

const props = defineProps<{ term: string }>();
const [found] = await Promise.all([loadFound({ term: props.term, lang: null })]);
</script>

<template>
  <ul :title="term.replace(/\s+/g, '-')"><li v-for="f in found" :key="f">{{ f }}</li></ul>
</template>
