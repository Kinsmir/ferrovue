<script setup lang="ts">
/* A root with attributes of its own — a class, an id, a title, a style, `v-show` — which the
 * attributes a parent passes merge with: a class joined, a style merged, any other replaced where
 * it stands. */
withDefaults(defineProps<{ label: string; shown?: boolean; note?: string }>(), { shown: true });
</script>

<template>
  <p class="leaf" id="own" :title="note" style="color: blue; margin: 0" v-show="shown">{{ label }}</p>
</template>
