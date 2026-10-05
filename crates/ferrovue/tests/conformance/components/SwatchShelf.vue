<script setup lang="ts">
import { provide } from "vue";
import { LookKey } from "../types/keys";
import Swatch from "./Swatch.vue";

const props = defineProps<{ size: string; tone: string; note?: string }>();
provide(LookKey, { size: props.size, tone: props.tone, note: props.note, count: 5 });
</script>

<template>
  <div class="shelf"><Swatch :label="tone" /><Swatch label="fixed" size="xs" /><slot /></div>
</template>
