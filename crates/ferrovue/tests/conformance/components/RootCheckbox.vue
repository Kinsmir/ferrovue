<script setup lang="ts">
const on = defineModel<boolean>({ required: true });
</script>

<template>
  <input type="checkbox" v-model="on" />
</template>
