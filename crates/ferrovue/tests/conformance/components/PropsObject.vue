<script setup lang="ts">
import { computed } from "vue";
import Divider from "./Divider.vue";
import Glyph from "./Glyph.vue";

const props = withDefaults(defineProps<{ label: string; tags?: string[]; count?: number; tone?: string; note: string | null }>(), { count: 1, tags: () => [] });
const loud = computed(() => props.label.toUpperCase());
</script>

<template>
  <article :title="props.label" :class="props.tone">
    <Glyph class="mark" />
    <h3>{{ props.label }} ({{ props.count }}) {{ loud }}</h3>
    <Divider />
    <ul v-if="props.tags.length"><li v-for="t in props.tags" :key="t">{{ t }}</li></ul>
    <p v-else>{{ props.tone ?? "plain" }}</p>
    <em v-if="props.note !== null">{{ props.note }}</em>
    <small>{{ props.note ?? "no note" }}</small>
  </article>
</template>
