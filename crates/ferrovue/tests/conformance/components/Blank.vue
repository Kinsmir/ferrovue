<script setup lang="ts">
defineProps<{ show: boolean }>();
</script>

<template>
  <b v-if="show">shown</b>
</template>
