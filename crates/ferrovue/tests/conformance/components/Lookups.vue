<script setup lang="ts">
import { computed } from "vue";
import { ICONS, type Kind, LABELS, type Size, THEME, Tone } from "../types/lookups";

interface Badge {
  tone: Tone;
  text: string;
}

const props = withDefaults(defineProps<{ size: Size; tone: Tone; level: 1 | 2 | 3; badges: Badge[]; loud: boolean; kind?: Kind }>(), { kind: "note" });

const PAD = { sm: "p-1", md: "p-2", lg: "p-4" } as const;
const WIDTH: Record<Size, number> = { sm: 8, md: 12.5, lg: 16 };
const TAGS = { sm: ["a"], md: [], lg: ["x", "<y>"] };
const STEPS: Partial<Record<1 | 2 | 3, string>> = { 1: "first", 2: "second" };
const NOTES = { sm: null, md: "medium note", lg: "large note" };
const padding = computed(() => PAD[props.size]);
const shout = computed(() => (props.loud ? "lg" : "sm"));
const heading = computed(() => `${LABELS[shout.value]} / ${THEME[props.tone].weight}`);
</script>

<template>
  <section :class="[PAD[size], THEME[tone].dark ? 'dark' : 'light']" :style="{ color: THEME[tone].fg, background: THEME[tone].bg, width: WIDTH[size] + 'px' }">
    <h2 :title="LABELS[size]">{{ heading }} {{ padding }} {{ PAD[loud ? "lg" : "md"] }}</h2>
    <p>{{ THEME[tone].weight }} {{ WIDTH[size] }} {{ THEME[Tone.Warn].fg }} {{ TAGS[size].join("+") }} {{ TAGS[size].length }}</p>
    <p>{{ ICONS[kind]?.label ?? "none" }} {{ ICONS[kind]?.glyph }} {{ NOTES[size] ?? "no note" }}</p>
    <p v-if="ICONS[kind]" :class="kind">{{ ICONS[kind].glyph }}</p>
    <p v-else>no icon</p>
    <b v-if="STEPS[level]">{{ STEPS[level] }}</b>
    <i>{{ STEPS[level] ?? "later" }}</i>
    <ul>
      <li v-for="b in badges" :key="b.text" :class="THEME[b.tone].dark ? 'dark' : null" :style="{ fontWeight: THEME[b.tone].weight }">{{ LABELS[size] }}: {{ b.text }}</li>
    </ul>
  </section>
</template>
