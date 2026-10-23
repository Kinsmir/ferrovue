<script setup lang="ts">
import LoadedStamp from "./LoadedStamp.vue";

defineProps<{ year: number }>();
</script>

<template>
  <section><LoadedStamp :year="year" /><LoadedStamp :year="year + 1" /></section>
</template>
