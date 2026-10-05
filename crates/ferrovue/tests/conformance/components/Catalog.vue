<script setup lang="ts">
import { computed } from "vue";
import { CHOICES, LABELS, LIMITS, Rank, SIZES, SORTS, Tone } from "../types/catalog";

enum Shape {
  Round = "round",
  Square = "square",
}

const props = defineProps<{ tone: Tone; rank?: Rank; size?: string }>();
const heading = computed(() => `${LABELS.title} (${LABELS.counts.max})`);
</script>

<template>
  <section :class="[Shape.Round, props.tone]">
    <h2>{{ heading }}</h2>
    <p v-if="tone === Tone.Loud">LOUD</p>
    <p v-else-if="rank === Rank.High">high {{ Rank.High }}</p>
    <p v-else>{{ LABELS.empty }} {{ Rank[5] }} {{ Shape.Square }}</p>
    <select>
      <option v-for="s in SIZES" :key="s" :value="s" :selected="s === size">{{ s }}</option>
    </select>
    <ul>
      <li v-for="c in CHOICES" :key="c.id" :title="c.hint">{{ c.id }}: {{ c.label }}</li>
    </ul>
    <ol>
      <li v-for="(s, i) in SORTS" :key="s.key">{{ i }} {{ s.label }}{{ s.desc ? " (desc)" : "" }} {{ s.badge ?? "-" }}<b v-if="s.badge === null">plain</b></li>
    </ol>
    <small>{{ LIMITS.join(" / ") }} {{ SIZES.length }}</small>
  </section>
</template>
