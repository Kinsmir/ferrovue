<script setup lang="ts">
import type { Owner } from "../types/models";

export interface Row {
  label: string;
  hint?: string;
}

defineProps<{ title: string; rows: Row[]; owner: Owner }>();
</script>

<template>
  <section>
    <h2>{{ title }}</h2>
    <ul>
      <li v-for="(row, index) in rows" :key="row.label"><slot name="row" :row="row" :index="index">{{ row.label }}</slot></li>
    </ul>
    <slot name="count" :n="rows.length" />
    <slot />
    <small>{{ owner.name }}</small>
  </section>
</template>
