<script setup lang="ts">
import ImportedProps from "./ImportedProps.vue";
import type { ImportedBase } from "../types/imported";
import type { Mood } from "../types/tables";

interface Extra extends ImportedBase {
  mood: Mood;
}

defineProps<Extra & { tags: string[] }>();
</script>

<template>
  <section :data-on="on">{{ label }}<ImportedProps v-if="on" :title="label" :mood="mood" :tags="tags" /><ImportedProps v-else :title="`${label}!`" :mood="mood" :tags="[]" :count="tags.length" :note="label" /></section>
</template>
