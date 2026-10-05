<script setup lang="ts">
import { useHead } from "@unhead/vue";

const props = defineProps<{ path: string }>();
useHead({ title: "Not found", meta: [{ name: "robots", content: "noindex" }, { name: "description", content: `Nothing lives at ${props.path}` }] });
</script>

<template>
  <section class="not-found">
    <h1>Not found</h1>
    <p>Nothing lives at <code>{{ path }}</code>.</p>
    <RouterLink :to="{ name: 'home' }">Back to all books</RouterLink>
  </section>
</template>
