<script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{ tone: string }>();
</script>

<template>
  <div class="bound" v-bind="$attrs">{{ tone }}</div>
</template>

<style>
.bound { color: v-bind(tone); }
</style>
