<script setup lang="ts">
interface Shelf {
  tags: string[];
}

defineProps<{ shelves: Shelf[]; note?: string }>();
</script>

<template>
  <section>
    <template v-for="shelf in shelves"><p v-if="note"><b v-for="tag in shelf.tags.filter((t) => t).map((t) => note + t)">{{ tag }}</b></p></template>
  </section>
</template>
