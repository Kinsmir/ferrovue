<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <span class="circle">{{ label }}<slot /></span>
</template>

<style scoped>
.circle {
  border-radius: 50%;
}

:slotted(i) {
  color: plum;
}
</style>
