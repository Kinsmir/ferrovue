<script setup lang="ts">
import type { ImportedCardProps } from "../types/imported";

const props = withDefaults(defineProps<ImportedCardProps>(), { count: 1, note: "none" });
</script>

<template>
  <article :class="mood" :title="title">{{ title }} ×{{ count }} <i v-for="t in tags" :key="t">{{ t }}</i>{{ note }}</article>
</template>
