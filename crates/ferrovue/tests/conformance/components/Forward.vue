<script setup lang="ts">
import Frame from "./Frame.vue";

defineProps<{ title: string }>();
</script>

<template>
  <section><Frame :title="title"><slot /></Frame></section>
</template>
