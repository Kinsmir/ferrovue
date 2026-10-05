<script setup lang="ts">
import { defineAsyncComponent } from "vue";

const LazyBox = defineAsyncComponent(() => import("./PlainBox.vue"));
const LazyLeaf = defineAsyncComponent({ loader: () => import("./ScopedLeaf.vue"), delay: 0 });

defineProps<{ title: string; note?: string }>();
</script>

<template>
  <section class="deferred">
    <LazyBox :text="title"><em v-if="note">{{ note }}</em></LazyBox>
    <LazyLeaf :label="note" />
  </section>
</template>

<style scoped>
.deferred {
  color: teal;
}
</style>
