<script setup lang="ts">
/* A root bound to a class that may be absent and to a style given as text: Vue merges the root's
 * attributes with what its parent passes (`mergeProps`) even when that is nothing, which leaves an
 * absent class out and parses the text into properties. */
defineProps<{ cls?: string; css: string }>();
</script>

<template>
  <span :class="cls" :style="css">binds</span>
</template>
