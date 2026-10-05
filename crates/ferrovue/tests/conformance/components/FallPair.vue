<script setup lang="ts">
/* Two roots: Vue gives the attributes a parent passes to neither. */
defineProps<{ first: string }>();
</script>

<template>
  <dt>{{ first }}</dt>
  <dd>second</dd>
</template>
