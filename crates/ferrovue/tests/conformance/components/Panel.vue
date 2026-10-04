<script setup lang="ts">
/* Named slots, a fallback that interpolates, and markup shown only when the parent filled a slot. */
export interface Props {
  title: string;
  count?: number;
}

defineProps<Props>();
</script>

<template>
  <section class="panel">
    <header><slot name="title">{{ title }}<small v-if="count !== undefined"> ({{ count }})</small></slot></header>
    <div class="body"><slot /></div>
    <footer v-if="$slots.footer"><slot name="footer" /></footer>
  </section>
</template>
