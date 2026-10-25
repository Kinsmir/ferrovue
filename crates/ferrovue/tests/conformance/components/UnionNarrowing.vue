<script setup lang="ts">
import { computed, ref } from "vue";
import NarrowedTone from "./NarrowedTone.vue";

type Tone = "calm" | "<loud>" | "a&b";

const props = defineProps<{ start?: Tone; pick?: Tone; label: string }>();
const tone = ref<Tone | "">(props.start ?? "");
const chosen = computed((): Tone | "" => props.pick ?? "");
const shown = computed((): Tone | undefined => (tone.value === "" ? undefined : tone.value));
const on = computed(() => props.label !== "");
</script>

<template>
  <section>
    <NarrowedTone :tone="tone || undefined" :label="label" />
    <NarrowedTone :tone="tone === '' ? undefined : tone" :label="label" />
    <NarrowedTone :tone="'' !== tone ? tone : undefined" :label="label" />
    <NarrowedTone :tone="chosen ? chosen : undefined" :label="label" />
    <NarrowedTone :tone="shown" :label="label" />
    <NarrowedTone v-if="chosen !== ''" :tone="chosen" :label="label" />
    <i v-else>{{ label }} none</i>
    <i v-if="tone === ''">empty</i>
    <NarrowedTone v-else-if="tone === 'calm'" :tone="tone" label="calm" />
    <NarrowedTone v-else :tone="tone" :label="label" />
    <NarrowedTone v-if="on && chosen !== 'a&b' && chosen" :tone="chosen" :label="label" />
  </section>
</template>
