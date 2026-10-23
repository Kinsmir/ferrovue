<script setup lang="ts">
import { computed } from "vue";
import UnionStep from "./UnionStep.vue";
import { END, type Align, type Step } from "../types/unions";

const ROLE: Record<string, string> = { left: "<start>", right: 'end & "after"', toString: "proto" };
const WIDTH = new Map([
  ["left", 10],
  ["center", 20],
]);
const SHORT = { left: "l", center: "c", right: "r" } as const;

const props = defineProps<{ label: string; align: Align; state: "todo" | "done" | "skipped"; side?: Align; words: string[] }>();

const first = computed<Step>(() => ({ label: props.label, state: "done", align: props.align }));
const chosen = computed((): Step => ({ label: `${props.label}!`, state: props.state === "todo" ? "skipped" : props.state, align: props.side }));
const steps = computed<Step[]>(() => props.words.map((w, i) => ({ label: w, state: i === 0 ? "todo" : "done", align: END })));
const role = computed(() => (Object.hasOwn(ROLE, props.align) ? ROLE[props.align] : "none"));
</script>

<template>
  <section :data-role="role" :class="side && SHORT[side]">
    <ol>
      <UnionStep :step="first" />
      <UnionStep :step="chosen" />
      <UnionStep :step="{ label, state, align: side }" />
      <UnionStep :step="{ label: 'fixed', state: 'skipped' }" />
      <UnionStep v-for="s in steps" :key="s.label" :step="s" />
    </ol>
    <p>{{ WIDTH.get(align) ?? 0 }}|{{ WIDTH.has(align) }}|{{ Object.hasOwn(ROLE, align) }}|<b v-if="Object.hasOwn(ROLE, align)">{{ ROLE[align] }}</b></p>
    <p>{{ side !== undefined && side !== "right" ? SHORT[side] : "x" }}|{{ state !== "todo" && state !== "done" }}|{{ state === "todo" || align === "left" }}</p>
  </section>
</template>
