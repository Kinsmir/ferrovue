<script setup lang="ts">
defineProps<{ tone: string; on: boolean }>();
</script>

<template>
  <template v-if="on"><p>a</p><p>b</p></template>
  <Transition><b v-if="on">c</b></Transition>
  text {{ tone }}
</template>

<style scoped>
p { color: v-bind(tone); }
</style>
