<script setup lang="ts">
import { computed } from "vue";
import { type Align, Level, STATE_LABELS, type Step } from "../types/unions";
import UnionChild from "./UnionChild.vue";

const props = withDefaults(
  defineProps<{
    align: Align;
    mode: "a" | "b" | "c";
    other?: "a" | "b" | "c";
    level: Level;
    gap?: "" | "wide";
    mark: "<b>" | '"q"' | "a&b";
    tag: "h2" | "h3";
    size?: "sm" | "lg";
    picked: "a" | "b" | "c" | null;
    steps: Step[];
    note: string;
  }>(),
  { size: "lg" },
);

const ALIGNS = { left: "L", center: "C", right: "R" } as const;
const MODES = { a: 1, b: 2.5, c: -3 };
const SIZES: Record<"sm" | "lg", string> = { sm: "small", lg: "large" };
const MARKS = { "<b>": "bold", '"q"': "quote", "a&b": "amp" } as const;
const label = computed(() => {
  switch (props.mode) {
    case "a":
      return "first";
    case "b":
      return "second";
    default:
      return "third";
  }
});
const chosen = computed((): "a" | "b" | "c" => (props.level === Level.High ? "a" : props.mode));
</script>

<template>
  <section :class="[align, mode, gap]" :title="mark" :style="{ textAlign: align }" :data-level="level">
    <component :is="tag">{{ mark }} {{ mode.toUpperCase() }} {{ `${align}/${size}` }} {{ align.length }}</component>
    <p>{{ ALIGNS[align] }} {{ MODES[other ?? "c"] }} {{ MODES[mode] }} {{ SIZES[size] }} {{ label }} {{ MARKS[mark] }}</p>
    <b v-if="mode === 'a'">is a</b>
    <b v-else-if="mode !== 'c'">not c</b>
    <b v-else>c</b>
    <i v-if="other">{{ MODES[other] }} {{ other }}</i>
    <i v-else>no other</i>
    <i v-if="gap">gap {{ gap }}</i>
    <i v-else>no gap</i>
    <u v-if="level === Level.High">high</u>
    <s>{{ picked ?? "none" }} {{ picked === null ? "null" : picked }} {{ picked === mode }}</s>
    <ol>
      <li v-for="s in steps" :key="s.label" :class="s.state">{{ STATE_LABELS[s.state] }} {{ s.state === "done" ? "yes" : "no" }} {{ s.align ?? "left" }} {{ s.label }}</li>
    </ol>
    <UnionChild :align="align" :text="mode" :wide="align" :pick="chosen" fixed="y" />
    <UnionChild v-for="s in steps" :key="s.label" :align="s.align ?? 'center'" :text="s.label" :pick="other ?? 'b'" fixed="x" />
    <p>{{ note }}</p>
  </section>
</template>
