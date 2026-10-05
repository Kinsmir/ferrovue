<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <div class="frame"><header><slot name="head">{{ title }}</slot></header><main><slot>nothing here</slot></main></div>
</template>
