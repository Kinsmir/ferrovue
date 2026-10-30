<script setup lang="ts">
import CommentBox from "./CommentBox.vue";
defineProps<{ label: string; on: boolean; items: string[] }>();
</script>

<template>
  <!-- first -->
  <section :title="label">
    <!-- inside -->
    <CommentBox class="outer" :data-label="label" :label="label"><!-- slotted --><b>{{ label }}</b></CommentBox>
    <CommentBox :label="label" />
    <i v-if="on">yes</i>
    <!-- between branches -->
    <i v-else>no</i>
    <template v-for="i in items" :key="i"><!-- item -->{{ i }}</template>
  </section>
  <!-- between roots -->
  <aside>{{ label }}</aside>
</template>
