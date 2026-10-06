<script setup lang="ts">
defineProps<{ words: string; on: boolean }>();
</script>

<template>
  <p :title="words.split(' ').map((w) => (on ? w.toUpperCase() : w)).join('-')">{{ words.split(" ").map((w) => (on ? $t("common.app") : w)).join("|") }}</p>
</template>
