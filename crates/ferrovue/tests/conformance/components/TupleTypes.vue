<script setup lang="ts">
import { computed } from "vue";
import TupleBadge from "./TupleBadge.vue";
import UnionBadge from "./UnionBadge.vue";
import type { Booking, Span } from "../types/tuples";

const props = defineProps<{
  booking: Booking;
  spans: Span[];
  score: [label: string, points: number];
  scores: [string, number][];
  when: [Date, string];
  nested: [{ name: string; tags: string[] }, boolean];
  extra?: [string, number];
}>();

const range = computed(() => {
  const [from, to] = props.booking.span;
  return `${from}–${to}`;
});
const total = computed(() => props.scores.reduce((sum, [, n]) => sum + n, 0));
const names = computed(() => props.scores.map(([name]) => name));
</script>

<template>
  <section :title="range" :data-seats="booking.seats[0] + booking.seats[1]">
    <UnionBadge :mood="booking.tagged[0]" :label="booking.tagged[1] ?? 'none'" />
    <p v-for="([from, to], i) in spans" :key="i" :data-to="to">{{ from }} {{ spans[i]?.[1] }} {{ booking.span.length }}</p>
    <TupleBadge :pair="score" :rest="scores" />
    <TupleBadge :pair="[score[0], 0]" :rest="[['x', 1], [names.join(), total]]" />
    <TupleBadge v-for="(s, i) in scores" :key="i" :pair="s" />
    <time :datetime="when[0].toISOString()">{{ when[1] }}</time>
    <p :class="{ on: nested[1] }">{{ nested[0].name }} {{ nested[0].tags.join(", ") }}</p>
    <b v-if="extra">{{ extra[0] }}={{ extra[1] }}</b>
    <i v-else>none</i>
    {{ total }}|{{ score[1] > 1 ? score[0] : "-" }}|{{ extra?.[0] ?? "-" }}
  </section>
</template>
