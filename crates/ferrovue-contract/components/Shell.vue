<script setup lang="ts">
import CartBadge from "./CartBadge.vue";
import HeadNote from "./HeadNote.vue";
import Modal from "./Modal.vue";
import ThemedButton from "./ThemedButton.vue";
import Translated from "./Translated.vue";

defineProps<{ title: string }>();
</script>

<template>
  <div class="shell">
    <nav>
      <RouterLink to="/">Home</RouterLink>
      <RouterLink :to="{ name: '/books/[id]', params: { id: title } }">Book</RouterLink>
      <RouterLink :to="{ path: '/', query: { from: 'shell' } }">Back</RouterLink>
    </nav>
    <CartBadge />
    <Translated :name="title" />
    <Modal :title="title" />
    <ThemedButton :label="title" />
    <HeadNote :title="title" />
    <main><RouterView /></main>
    <slot />
  </div>
</template>
