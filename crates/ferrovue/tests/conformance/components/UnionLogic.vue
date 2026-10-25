<script setup lang="ts">
import NarrowedTone from "./NarrowedTone.vue";

type Tone = "calm" | "<loud>" | "a&b";
interface Mix {
  tones: Tone[];
}

const props = defineProps<{ pick?: Tone; other: Tone; choice: Tone | ""; label: string; on: boolean }>();
const QUIET = { "<loud>": true, "a&b": false };
function mixed(): Mix {
  return { tones: [props.other, "calm"] };
}
</script>

<template>
  <section>
    <i>{{ other === "calm" || QUIET[other] }}</i>
    <i>{{ other !== "calm" && QUIET[other] }}</i>
    <NarrowedTone :tone="choice || 'calm'" :label="label" />
    <NarrowedTone :tone="pick ?? other" :label="label" />
    <NarrowedTone :tone="on ? choice || 'a&b' : '<loud>'" :label="label" />
    <NarrowedTone :tone="on ? pick : undefined" :label="label" />
    <NarrowedTone :tone="on ? other : undefined" :label="label" />
    <i>{{ mixed().tones.join(",") }}</i>
  </section>
</template>
