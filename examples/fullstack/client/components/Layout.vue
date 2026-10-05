<script setup lang="ts">
import { useHead } from "@unhead/vue";
import BasketSummary from "./BasketSummary.vue";

const props = defineProps<{ shop: string }>();
useHead({ title: props.shop, titleTemplate: `%s · ${props.shop}` });
</script>

<template>
  <div class="layout">
    <header>
      <RouterLink :to="{ name: '/' }" class="brand">{{ shop }}</RouterLink>
      <nav><RouterLink :to="{ name: '/' }">All books</RouterLink> <RouterLink :to="{ name: '/books/[id]', params: { id: 'dune' } }">Book of the week</RouterLink></nav>
      <div id="basket"><BasketSummary label="Basket" /></div>
    </header>
    <main><RouterView /></main>
    <footer>Rendered in Rust by ferrovue, hydrated by Vue.</footer>
  </div>
</template>
