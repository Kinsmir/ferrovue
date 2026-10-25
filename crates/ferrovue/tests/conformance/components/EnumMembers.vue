<script setup lang="ts">
const PREFIX = "tone-";
const MARK = "<b>&'q\"";
const BASE = 0;

enum Tone {
  Plain = PREFIX + "plain",
  Marked = MARK + PREFIX,
  Blank = "",
}

enum Rank {
  Low = BASE,
  Mid,
  Top = Rank.Mid * 2,
  Next = Top + 1,
}

const DEFAULT: Tone = Tone.Plain;
const TOP: Rank = Rank.Top;

defineProps<{ tone: Tone; rank: Rank; label?: string }>();
</script>

<template>
  <section :class="['tone', tone]" :data-rank="rank" :title="label">
    <p v-if="tone === DEFAULT">default {{ DEFAULT }}</p>
    <p v-else-if="tone === Tone.Marked">marked {{ Tone.Marked }}</p>
    <p v-else>other [{{ tone }}]</p>
    <b v-if="rank === TOP">top {{ TOP }}</b>
    <i>{{ Rank.Low }} {{ Rank.Mid }} {{ Rank.Top }} {{ Rank.Next }} {{ rank }} {{ label }}</i>
  </section>
</template>
