<script setup lang="ts">
/* Scoped, its root a `<Transition>` around one element, which takes the inherited ids. */
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
