<script setup lang="ts">
/* A root that is a component given nothing of its own: what this one is passed reaches it as it is,
 * not merged, and so does `$attrs` bound alone in that one. */
import FallUse from "./FallUse.vue";
</script>

<template>
  <FallUse />
</template>
