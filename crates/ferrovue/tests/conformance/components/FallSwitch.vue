<script setup lang="ts">
defineProps<{ mode: "on" | "off" | "none" }>();
</script>

<template>
  <b v-if="mode === 'on'" class="on" title="own">on</b>
  <i v-else-if="mode === 'off'">off</i>
</template>
