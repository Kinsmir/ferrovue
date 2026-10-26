<script setup lang="ts">
import UnionBadge from "./UnionBadge.vue";
import type { Mood } from "../types/tables";

const props = defineProps<{ size: "sm" | "Lg" | "ünï"; mood: Mood; label: string }>();
const HALF = 0.5;
const BIG = 1e21;
const NEG = -0;
const BY_NUMBER = { "0.5": "half", "1e+21": "huge", "0": "zero" };
const BY_CASE = { SM: "small", LG: "large", "ÜNÏ": "umlaut", sm: "lower small", lg: "lower large" } as const;
const BY_TEMPLATE = { "size-sm": "<s>", "size-Lg": "&L", "size-ünï": "\"u\"", "SM!": "shout" };
const NEXT = { "mood-calm": "loud", "mood-loud": "calm", "mood-<q>&\"x'": "calm" } as const;
</script>

<template>
  <p :title="label" :data-half="BY_NUMBER[HALF]">
    {{ BY_NUMBER[HALF] }}|{{ BY_NUMBER[BIG] }}|{{ BY_NUMBER[NEG] }}|{{ BY_CASE[size.toUpperCase()] }}|{{ BY_CASE[size.toLowerCase()] ?? "none" }}|{{ BY_TEMPLATE[`size-${size}`] }}|{{ BY_TEMPLATE[`${size.toUpperCase()}!`] ?? "-" }}
  </p>
  <UnionBadge :mood="NEXT[`mood-${mood}`]" :label="label" />
</template>
