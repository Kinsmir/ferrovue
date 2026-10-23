<script setup lang="ts">
defineProps<{ words?: string[]; counts?: number[] }>();
</script>

<template>
  <section>
    <p>{{ (words ?? ["none"]).length }}|{{ (words ?? ["a<b", "c&d"]).join("-") }}|{{ (counts ?? [1, 2]).length }}</p>
    <ul>
      <li v-for="w in words ?? ['first', 'second']">{{ w }}</li>
    </ul>
    <p v-for="n in counts ?? [3]">{{ n * 2 }}</p>
  </section>
</template>
