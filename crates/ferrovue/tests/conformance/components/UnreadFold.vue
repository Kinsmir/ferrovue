<script setup lang="ts">
defineProps<{ open?: boolean; label?: string }>();
</script>

<template>
  <div class="fold"><b v-if="label">{{ label }}</b><slot v-if="open" /></div>
</template>
