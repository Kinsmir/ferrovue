<script setup lang="ts">
const picked = defineModel<string>({ required: true });
</script>

<template>
  <select v-model="picked" name="size"><option value="s">small</option><option value="m">medium</option></select>
</template>
