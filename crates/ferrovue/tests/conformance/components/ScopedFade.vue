<script setup lang="ts">
defineProps<{ open: boolean }>();
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="fade">shown</div>
  </Transition>
</template>

<style scoped>
.fade {
  opacity: 1;
}
</style>
