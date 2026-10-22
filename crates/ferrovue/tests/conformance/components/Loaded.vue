<script setup lang="ts">
import { computed } from "vue";
import LoadedComments from "./LoadedComments.vue";
import { loadArticle, loadViews } from "./loaders";

const props = defineProps<{ slug: string; lang?: string }>();
const article = await loadArticle(props.slug, props.lang);
const { title, author: writer } = await loadArticle(props.slug, props.lang);
const views = await loadViews();
const heading = computed(() => `${title} (${views} views)`);
</script>

<template>
  <article>
    <h1>{{ heading }}</h1>
    <p v-if="writer">
      {{ writer.name }}<span v-if="writer.bio"> — {{ writer.bio }}</span>
    </p>
    <ul>
      <li v-for="tag in article.tags" :key="tag">{{ tag }}</li>
    </ul>
    <LoadedComments :article="slug" :page="1" />
    <LoadedComments :article="slug" :page="2" :drafts="article.tags.length > 1" />
  </article>
</template>
