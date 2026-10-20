<script setup lang="ts">
import { computed, ref } from "vue";

interface Member {
  name: string;
  title?: string;
  score: number;
}

const props = defineProps<{ members: Member[]; lead?: Member; limit: number; unit?: string }>();

const SEPARATOR = " · ";
const shown = ref(3);
const open = ref(false);

function displayName(m: Member): string {
  if (!m.title) return m.name;
  return `${m.title} ${m.name}`;
}

const rating = (score: number, unit = "pts"): string => {
  if (score >= props.limit) return `${score} ${unit}!`;
  return `${score} ${unit}`;
};

function grade({ score }: Member): string {
  switch (true) {
    case score >= 90:
      return "A";
    case score >= 50:
      return "B";
    default:
      return "C";
  }
}

function line(m: Member, unit?: string): string {
  const parts = [displayName(m), rating(m.score, unit), grade(m)];
  return parts.join(SEPARATOR);
}

const visible = computed(() => props.members.slice(0, shown.value).map((m) => line(m, props.unit)));

function toggle() {
  open.value = !open.value;
}
</script>

<template>
  <section @click="toggle">
    <h2 v-if="lead">{{ displayName(lead) }} ({{ rating(lead.score) }})</h2>
    <ul>
      <li v-for="(l, i) in visible" :key="i">{{ l }}</li>
    </ul>
    <p>{{ members.map((m) => grade(m)).join("") }}</p>
  </section>
</template>
