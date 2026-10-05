<script setup lang="ts">
import { computed, inject } from "vue";
import { type Look, LookKey } from "../types/keys";

const props = defineProps<{ label: string; size?: string }>();
const look = inject(LookKey, { size: props.size ?? "md", tone: "plain", count: 0 });
const made = inject(LookKey, () => ({ size: "lg", tone: props.label, note: "made", count: 1 }), true);
const named = inject<Look>("look", { size: "sm", tone: `${props.label}!`, count: 2 });
const summary = computed(() => `${look.size}/${look.tone}`);
</script>

<template>
  <span :class="['swatch', `swatch-${look.size}`]" :data-tone="look.tone" :data-note="look.note">{{ label }} {{ summary }} {{ made.tone }} {{ made.note }} {{ named.tone }} {{ named.size }} {{ look.count + made.count }}</span>
</template>
