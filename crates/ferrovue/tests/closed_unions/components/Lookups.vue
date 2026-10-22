<script setup lang="ts">
import { computed } from "vue";
import { THEME, Tone } from "../types/tables";

type K = "a" | "b" | "c";
const props = defineProps<{ k: K; m?: K; tone: Tone; level: 1 | 2 | 3 }>();
const T = { a: "A", b: "B", c: "C" } as const;
const SHARED = { a: "x", b: "y", c: "x" } as const;
const COUNT = { a: 1, b: 2, c: 1.5 };
const SHOW_LAST = { a: false, b: false, c: true };
const SHOW_FIRST = { a: true, b: false, c: false };
const ICON: Partial<Record<K, { label: string }>> = { a: { label: "ia" }, c: { label: "ic" } };
const ICON_NO_LAST: Partial<Record<K, { label: string }>> = { a: { label: "ia" }, b: { label: "ib" } };
const NAMES = { 1: "one", 2: "two", 3: "three" };
const key = computed(() => props.k);
</script>

<template>
  <p :title="T[k]" :class="SHARED[k]" :style="{ opacity: COUNT[k] }">
    {{ T[k] }} {{ T[m ?? "a"] }} {{ T[m ?? "c"] }} {{ SHARED[k] }} {{ COUNT[k] }} {{ T[key] }} {{ NAMES[level] }}
    {{ THEME[tone].fg }}
    <b v-if="SHOW_LAST[k]">last</b><b v-if="SHOW_FIRST[k]">first</b>
    <i v-if="ICON[k]">{{ ICON[k].label }}</i><i v-if="ICON_NO_LAST[k]">{{ ICON_NO_LAST[k].label }}</i>
  </p>
</template>
