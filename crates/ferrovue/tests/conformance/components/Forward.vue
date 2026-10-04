<script setup lang="ts">
/* Its own slot handed on as another component's: content arrives from outside, or nothing does and
 * the inner fallback shows. */
import Frame from "./Frame.vue";

defineProps<{ title: string }>();
</script>

<template>
  <section><Frame :title="title"><slot /></Frame></section>
</template>
