<script setup lang="ts">
import { computed, ref } from "vue";
import type { User } from "../types/models";

interface Row {
  id: number;
  name: string;
}

defineProps<{ title: string }>();
const rows = ref<Row[]>([]);
const users = ref<User[]>([]);
const names = ref<string[]>([]);
const picked = ref<Row | undefined>();
const note = ref<string>();
const total = ref<number | undefined>(undefined);
const shown = computed(() => names.value.join(", "));
</script>

<template>
  <section>
    <h2>{{ title }}</h2>
    <ul><li v-for="r in rows" :key="r.id">{{ r.name }}</li></ul>
    <p v-for="u in users" :key="u.id">{{ u.name }}</p>
    <p v-if="picked">{{ picked.name }}</p>
    <p v-else>{{ note ?? "nothing picked" }} {{ total ?? 0 }} {{ rows.length }} [{{ shown }}]</p>
  </section>
</template>
