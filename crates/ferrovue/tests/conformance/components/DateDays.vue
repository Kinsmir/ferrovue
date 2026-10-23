<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ days: Date[]; maybe?: Date[]; by: Record<string, Date>; seen: (Date | null)[] }>();
const valid = computed(() => props.days.filter((d) => d.getTime() === d.getTime()));
const sum = computed(() => props.days.reduce((total, d) => total + d.getUTCDate(), 0));
</script>

<template>
  <div>
    <span v-for="(day, i) in days" :key="i">{{ day.getTime() }}</span>
    <p>{{ valid.length }} valid, {{ sum }}, first {{ days[0]?.getTime() }}, last {{ days.at(-1)?.getUTCFullYear() }}, {{ days.some((d) => d.getUTCDay() === 0) ? "a Sunday" : "no Sunday" }}, {{ days.findIndex((d) => d.getUTCMonth() === 1) }}</p>
    <p v-if="maybe">{{ maybe.length }} maybe: {{ maybe.map((d) => d.getTime()).join() }}</p>
    <p>{{ Object.keys(by).join() }} {{ Object.values(by).map((d) => d.getUTCHours()).join() }} {{ JSON.stringify(valid) }}</p>
    <b v-for="(at, k) in seen" :key="k">{{ at !== null ? at.getUTCMinutes() : -1 }}</b>
  </div>
</template>
