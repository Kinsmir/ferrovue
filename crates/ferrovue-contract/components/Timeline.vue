<script setup lang="ts">
import type { Moment } from "../types/models";

defineProps<{ moments: Moment[]; days: Date[]; by: Record<string, Date> }>();
</script>

<template>
  <ol>
    <li v-for="(m, i) in moments" :key="i">{{ m.label }} {{ m.at.getTime() }} {{ m.seen.length }}</li>
    <li v-for="(d, i) in days" :key="i">{{ d.getUTCDate() }}</li>
    <li v-for="(d, k) in by" :key="k">{{ k }}={{ d.getUTCFullYear() }}</li>
  </ol>
</template>
