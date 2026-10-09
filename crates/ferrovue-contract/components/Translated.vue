<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <p>{{ $t("hello", { name }) }}</p>
</template>
