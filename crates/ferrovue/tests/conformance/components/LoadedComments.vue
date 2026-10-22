<script setup lang="ts">
import { loadComments, loadNote } from "./loaders";

const props = defineProps<{ article: string; page: number; drafts?: boolean }>();
const comments = await loadComments(props.article, props.page, props.drafts ? true : null);
const note = await loadNote(comments.length);
</script>

<template>
  <section>
    <p v-if="note !== null" class="note">{{ note }}</p>
    <p v-for="(comment, i) in comments" :key="i">{{ comment }}</p>
    <footer :title="comments.join(' / ')">{{ comments.length }} on page {{ page }}</footer>
    <ol v-if="comments.some((c) => c.length > 6)">
      <li v-for="c in comments.filter((c) => c.length > 6).toSorted()" :key="c">{{ c }}</li>
    </ol>
  </section>
</template>
