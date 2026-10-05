<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<template>
  <div class="plain">
    <p>{{ text }}</p>
    <slot />
  </div>
</template>
