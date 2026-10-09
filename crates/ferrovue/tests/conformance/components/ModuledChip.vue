<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <b class="chip">{{ label }}</b>
</template>

<style module>
.chip { font-weight: bold; }
</style>
