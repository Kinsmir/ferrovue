<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";
import DateReplies from "./DateReplies.vue";
import type { Reply, Thread } from "../types/dated";

const props = defineProps<{ thread: Thread; shift: Float }>();
const moved = computed<Reply[]>(() =>
  props.thread.replies.map((r): Reply => ({ author: r.author.toUpperCase(), at: new Date(r.at.getTime() + props.shift), edited: r.edited, removed: null, replies: [] })),
);
const opening = computed((): Reply => ({ author: props.thread.title, at: props.thread.opened, removed: props.thread.opened, replies: moved.value }));
</script>

<template>
  <article>
    <h2>{{ thread.title }}</h2>
    <p>opened {{ thread.opened.getTime() }}, {{ thread.seen.length }} seen</p>
    <DateReplies :replies="thread.replies" :depth="0" />
    <DateReplies :replies="moved" :depth="1" />
    <p>{{ opening.author }} {{ opening.at.getTime() }} {{ opening.removed ? opening.removed.getUTCDay() : -1 }}</p>
    <DateReplies :replies="opening.replies" :depth="2" />
    <p v-for="(at, who) in thread.pinned" :key="who">{{ who }} pinned at {{ at.getUTCHours() }}</p>
  </article>
</template>
