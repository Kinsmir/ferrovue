<script setup lang="ts">
import type { Owner, Tag } from "../types/models";
import Badge from "./Badge.vue";

defineProps<{ title: string; owner: Owner; tags: Tag[]; note?: string }>();
</script>

<template>
  <article>
    <h2>{{ title }}</h2>
    <p>{{ owner.name }}<a v-if="owner.email" :href="`mailto:${owner.email}`">{{ owner.email }}</a></p>
    <ul>
      <li v-for="tag in tags" :key="tag.label" :title="tag.hint ?? undefined">{{ tag.label }}</li>
    </ul>
    <i v-if="note">{{ note }}</i>
    <Badge :count="tags.length" />
  </article>
</template>
