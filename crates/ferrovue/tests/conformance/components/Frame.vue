<script setup lang="ts">
/* A box with a heading slot, whose fallback is the title, and a body slot, whose fallback says it
 * is empty. */
defineProps<{ title: string }>();
</script>

<template>
  <div class="frame"><header><slot name="head">{{ title }}</slot></header><main><slot>nothing here</slot></main></div>
</template>
