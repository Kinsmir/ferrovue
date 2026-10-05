<script setup lang="ts">
defineProps<{ shop: string; featured: string }>();
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
