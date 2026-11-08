<script setup lang="ts">
import type { Fielded } from "../types/fielded";

defineProps<{ card: Fielded; rest?: Fielded[] }>();
</script>

<template>
  <article>
    <h3>{{ card.title }}</h3>
    <div v-html="card.body"></div>
    <dl><template v-for="(n, k) in card.counts" :key="k"><dt>{{ k }}</dt><dd>{{ n }}</dd></template></dl>
    <p>{{ Object.entries(card.labels).map(([k, v]) => k + "=" + v).join(";") }}</p>
    <ul><li v-for="(r, i) in rest ?? []" :key="i">{{ r.title }}:{{ Object.keys(r.labels).length }}</li></ul>
  </article>
</template>
