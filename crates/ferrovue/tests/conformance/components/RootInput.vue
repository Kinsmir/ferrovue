<script setup lang="ts">
const text = defineModel<string>({ required: true });
</script>

<template>
  <input v-model="text" maxlength="40" />
</template>
