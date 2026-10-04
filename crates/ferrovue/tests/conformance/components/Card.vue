<script setup lang="ts">
/* Reads no store itself: the state reaches `Badge` through here, inside `Frame`'s slot. */
import Badge from "./Badge.vue";
import Frame from "./Frame.vue";

defineProps<{ title: string }>();
</script>

<template>
  <article><Frame :title="title"><Badge :title="title" /></Frame></article>
</template>
