<script setup lang="ts">
withDefaults(defineProps<{ label: string; shown?: boolean; note?: string }>(), { shown: true });
</script>

<template>
  <p class="leaf" id="own" :title="note" style="color: blue; margin: 0" v-show="shown">{{ label }}</p>
</template>
