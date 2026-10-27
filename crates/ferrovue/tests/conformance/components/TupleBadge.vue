<script setup lang="ts">
defineProps<{ pair: [string, number]; rest?: [string, number][] }>();
</script>

<template>
  <b :data-n="pair[1]">{{ pair[0] }}<i v-for="([k, n], i) in rest ?? []" :key="i">{{ i }}:{{ k }}={{ n }}</i></b>
</template>
