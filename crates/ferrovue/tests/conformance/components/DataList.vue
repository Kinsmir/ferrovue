<script setup lang="ts">
export interface Row {
  id: number;
  label: string;
  tags: string[];
}

defineProps<{ rows: Row[]; title: string; note?: string }>();
</script>

<template>
  <section>
    <header><slot name="header" :title="title" :note="note">{{ title }}</slot></header>
    <ul v-if="rows.length">
      <li v-for="(r, i) in rows" :key="r.id"><slot name="row" :row="r" :index="i" :label="r.label" :tags="r.tags" :first="i === 0">{{ i }}. {{ r.label }}</slot></li>
    </ul>
    <p v-else><slot name="empty" :title="title">no rows in {{ title }}</slot></p>
    <footer><slot :count="rows.length" :title="title" /></footer>
  </section>
</template>
