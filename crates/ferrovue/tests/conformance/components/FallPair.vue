<script setup lang="ts">
defineProps<{ first: string }>();
</script>

<template>
  <dt>{{ first }}</dt>
  <dd>second</dd>
</template>
