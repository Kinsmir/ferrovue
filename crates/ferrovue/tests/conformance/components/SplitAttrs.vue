<script setup lang="ts">
defineProps<{ s: string }>();
</script>

<template>
  <input :value="String('a'.split(''))" :title="String(s.split(''))" :data-parts="String(s.split('-'))" />
</template>
