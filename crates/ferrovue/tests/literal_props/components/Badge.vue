<script setup lang="ts">
defineProps<{ label?: string; count?: number }>();
</script>

<template>
  <span class="badge">{{ label ?? "new" }}<b v-if="count">{{ count }}</b></span>
</template>
