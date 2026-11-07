<script setup lang="ts">
defineProps<{ label: string; name: string }>();
</script>

<template>
  <span class="tagline-word">by</span>
  <a :href="`/u/${name}`">{{ name }}</a>
  <!-- tag -->
  <b v-if="label">{{ label }}</b>
  <div>{{ label }}</div>
  <span>{{ name }}</span>
</template>
