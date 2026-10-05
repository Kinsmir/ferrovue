<script setup lang="ts">
import Badge from "./Badge.vue";
import Frame from "./Frame.vue";

defineProps<{ title: string }>();
</script>

<template>
  <article><Frame :title="title"><Badge :title="title" /></Frame></article>
</template>
