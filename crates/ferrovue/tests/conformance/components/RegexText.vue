<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ title: string; tags: string; code: string }>();
const slug = computed(() => props.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").replace(/-+$/, ""));
</script>

<template>
  <article :data-slug="slug" :class="{ numeric: /^\d+$/.test(code) }">
    <h1>{{ title.replace(/\s+/g, " ") }}</h1>
    <i v-for="(t, i) in tags.split(/\s*[,;]\s*/)" :key="i">{{ t }}</i>
    <b>{{ tags.split(/,/, 2).length }}|{{ title.replaceAll(/[aeiou]/gi, "[$&]") }}|{{ title.replace(/\bthe\b/i, "THE") }}|{{ /^[A-Z][a-z]*$/.test(title) }}</b>
  </article>
</template>
