<script setup lang="ts">
/* The page around every route: navigation by route name, the basket, and the route's own page.
 * The client hydrates the basket on its own (`#basket`), not the whole layout. */
import BasketSummary from "./BasketSummary.vue";

defineProps<{ shop: string }>();
</script>

<template>
  <div class="layout">
    <header>
      <RouterLink :to="{ name: 'home' }" class="brand">{{ shop }}</RouterLink>
      <nav><RouterLink :to="{ name: 'home' }">All books</RouterLink> <RouterLink :to="{ name: 'book', params: { id: 'dune' } }">Book of the week</RouterLink></nav>
      <div id="basket"><BasketSummary label="Basket" /></div>
    </header>
    <main><RouterView /></main>
    <footer>Rendered in Rust by ferrovue, hydrated by Vue.</footer>
  </div>
</template>
