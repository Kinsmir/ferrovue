<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import Divider from "./Divider.vue";

const LazyDivider = defineAsyncComponent(() => import("./Divider.vue"));
const LazyGlyph = defineAsyncComponent(() => import("./Glyph.vue"));

defineProps<{ tone: string; tags: string[]; note?: string }>();
</script>

<template>
  <section>
    <LazyDivider :class="tone" />
    <LazyGlyph :class="` ${tone} `" title="g" />
    <LazyGlyph :class="[tone, 'x']" />
    <LazyGlyph :class="{ on: tone, off: !tone }" />
    <LazyGlyph :class="tone ? tone : { none: true }" />
    <component :is="tone ? LazyGlyph : 'b'" :class="tone" />
    <LazyDivider :class="tags.join(' ')" />
    <Divider :class="tone" :title="note ?? (tags.map((t) => t + '-').find((t) => t.length > 2) ?? '-')" />
  </section>
</template>
