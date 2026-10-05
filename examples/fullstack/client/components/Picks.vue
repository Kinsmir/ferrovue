<script setup lang="ts">
import { useHead } from "@unhead/vue";

const props = defineProps<{ shop: string; featured: string }>();
useHead({
  title: () => `Staff picks · ${props.shop}`,
  meta: [{ name: "description", content: () => `${props.featured} and the rest of this week's staff picks` }],
  htmlAttrs: { class: "picks-page" },
});
</script>

<template>
  <div class="layout picks">
    <header>
      <RouterLink :to="{ name: 'home' }" class="brand">{{ shop }}</RouterLink>
      <nav><RouterLink :to="{ name: 'picks' }">Staff picks</RouterLink></nav>
    </header>
    <main><slot /></main>
    <aside class="reviews">
      <h2>Readers on {{ featured }}</h2>
      <slot name="reviews"><p>Loading reviews…</p></slot>
    </aside>
    <footer>One app: the layout and every part in it, hydrated from the record the server wrote.</footer>
  </div>
</template>
