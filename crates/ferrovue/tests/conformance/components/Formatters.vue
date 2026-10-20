<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";
import { compact, href, pluralise, truncate } from "./text";

const props = defineProps<{ count: number; price: Float; title: string; base: string; path: string[]; query?: string; items: string[] }>();

const summary = computed(() => `${compact(props.count)} ${pluralise(props.count, "view")}`);
const link = computed(() => href(props.base, props.path, props.query));
</script>

<template>
  <section>
    <h2 :title="title">{{ truncate(title) }}|{{ truncate(title, 5) }}</h2>
    <p>{{ summary }}|{{ compact(price) }}|{{ compact(-count) }}</p>
    <p>{{ pluralise(items.length, "child", "children") }}|{{ pluralise(1, "box") }}</p>
    <a :href="link">{{ link }}</a>
    <a :href="href(base, [])">{{ href(base, items, "") }}</a>
    <ul>
      <li v-for="item in items" :key="item">{{ truncate(item, 4) }}</li>
    </ul>
  </section>
</template>
