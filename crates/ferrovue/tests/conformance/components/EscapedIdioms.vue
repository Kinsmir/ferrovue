<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { ClientOnly } from "ferrovue/client";
import StarRating from "../vendor/StarRating";
import Glyph from "./Glyph.vue";

const LazyDivider = defineAsyncComponent(() => import("./Divider.vue"));

const props = defineProps<{ title: string; stars: number }>();
</script>

<template>
  <section class="escaped-idioms">
    <ClientOnly>
      <Glyph />
      <template #fallback><Glyph /><em>{{ props.title }}</em></template>
    </ClientOnly>
    <LazyDivider />
    <StarRating :value="props.stars" :label="props.title" />
  </section>
</template>
