<script setup lang="ts">
const { label: text, note: aside = "none", tag: t, items: rows } = defineProps<{ label: string; note?: string; tag: "em" | "strong"; items: string[] }>();
</script>

<template>
  <component :is="t" :title="text" :data-note="aside">{{ text }}<small v-if="aside">{{ aside }}</small><span v-for="row in rows" :key="row">{{ row }}</span></component>
</template>
