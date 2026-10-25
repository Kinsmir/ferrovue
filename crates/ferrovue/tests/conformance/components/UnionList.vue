<script setup lang="ts">
import { computed } from "vue";
import type { Hue } from "../types/unions";
import UnionListItem from "./UnionListItem.vue";

const props = withDefaults(defineProps<{ hues: Hue[]; extra?: Hue[]; spare?: Hue[]; holes: (Hue | null)[]; named: Record<string, Hue>; label: string; sizes: ("sm" | "lg")[] }>(), {
  spare: () => [],
});

const NAMES = { red: "Red", green: "Green & <go>", '<b>&"hue\'': "Odd \"one\"" } as const;

const warm = computed(() => props.hues.filter((h) => h !== "green"));
</script>

<template>
  <p :title="label" :data-hues="hues.join(',')" :data-sizes="sizes.join()">{{ hues.join(" / ") }} {{ hues.length }} {{ hues.includes("red") }} {{ hues.indexOf("green") }}</p>
  <UnionListItem v-for="(h, i) in hues" :key="i" :hue="h" :wide="h" :label="`${label} ${i}`" :hues="hues" />
  <UnionListItem :hues="warm" :label="label" :extra="extra" />
  <UnionListItem :hues="hues.map((h) => h)" :label="label" :extra="spare" />
  <b v-for="h in extra ?? []" :key="h">{{ NAMES[h] }} {{ h === "red" ? "warm" : "cool" }}</b>
  <i v-for="h in spare" :key="h">{{ h.toUpperCase() }}</i>
  <s v-for="(h, i) in holes" :key="i">{{ h ?? "none" }}</s>
  <UnionListItem v-for="(h, i) in holes" :key="i" :hue="h ?? undefined" :hues="[]" :label="label" />
  <UnionListItem v-for="(h, k) in named" :key="k" :hue="h" :hues="[]" :label="k" />
  <q :title="`${holes}`">{{ String(sizes) }}</q>
  <em v-for="s in sizes" :key="s" :class="s">{{ s }}</em>
  <span v-if="extra">{{ extra.length }} {{ extra.join() }}</span>
  <u v-if="hues.some((h) => h === 'red')">{{ hues.filter((h) => h !== "red").join("|") }}</u>
</template>
