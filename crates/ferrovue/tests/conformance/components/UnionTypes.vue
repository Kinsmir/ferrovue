<script setup lang="ts">
import { computed } from "vue";
import type { Shade } from "../types/unions";
import UnionShade from "./UnionShade.vue";

const props = withDefaults(defineProps<{ tone: Shade; other?: Shade; picked: Shade | null; fallback?: Shade; label: string }>(), { fallback: "x-cool" });

const NAMES = { warm: "Warm & <w>", "x-cool": "Cool", "<b>&'q'\"": "Mark" } as const;
const loud = computed(() => (props.tone === "warm" ? "loud" : "quiet"));
const chosen = computed((): Shade => props.other ?? props.tone);
</script>

<template>
  <section :class="[tone, other]" :data-tone="tone" :title="picked ?? 'none'">
    <p>{{ tone }}|{{ other ?? "none" }}|{{ picked }}|{{ fallback }}|{{ NAMES[tone] }}|{{ tone.length }}|{{ `${tone}/${fallback}` }}|{{ label }}</p>
    <b v-if="tone === 'warm'">warm</b>
    <b v-else-if="tone !== 'x-cool'">mark</b>
    <b v-else>cool</b>
    <i v-if="other">{{ NAMES[other] }} {{ other }}</i>
    <i v-else>no other</i>
    <s>{{ picked === tone }} {{ picked === null ? "null" : picked }} {{ loud }}</s>
    <UnionShade :tone="tone" :text="label" />
    <UnionShade :tone="chosen" :text="tone" />
    <UnionShade :tone="other ?? 'warm'" text="fixed" />
  </section>
</template>
