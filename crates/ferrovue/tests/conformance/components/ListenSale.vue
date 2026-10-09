<script setup lang="ts">
defineProps<{ label: string; onSale?: boolean }>();
</script>

<template>
  <b>{{ label }}<i v-if="onSale"> on sale</i></b>
</template>
