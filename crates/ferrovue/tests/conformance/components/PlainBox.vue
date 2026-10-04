<script setup lang="ts">
/* No scoped styles: a scoped parent's id reaches its root alone, and the slot content keeps the
 * parent's own. */
defineProps<{ text: string }>();
</script>

<template>
  <div class="plain">
    <p>{{ text }}</p>
    <slot />
  </div>
</template>
