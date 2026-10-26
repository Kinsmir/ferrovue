<script setup lang="ts">
const text = defineModel<string>({ required: true });
</script>

<template>
  <textarea v-model="text" rows="3" />
</template>
