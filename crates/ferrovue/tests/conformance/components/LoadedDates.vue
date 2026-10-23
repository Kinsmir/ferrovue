<script setup lang="ts">
import DateReplies from "./DateReplies.vue";
import { loadClosed, loadDays, loadOpened, loadThread } from "./loaders";

const props = defineProps<{ id: number; name: string }>();
const opened = await loadOpened(props.name);
const thread = await loadThread(props.id);
const { seen, pinned } = await loadThread(props.id);
const days = await loadDays();
const closed = await loadClosed(props.name);
</script>

<template>
  <section>
    <h2>{{ thread.title }} by {{ name }}</h2>
    <time v-if="opened.getTime() === opened.getTime()" :datetime="opened.toISOString()">{{ opened.getUTCFullYear() }}</time>
    <p v-else>never opened {{ opened.getTime() }}</p>
    <p v-if="closed">closed {{ closed.getTime() }}{{ closed > opened ? " later" : "" }}</p>
    <p v-else>open</p>
    <i v-for="(day, k) in days" :key="k">{{ day.getUTCDate() }}</i>
    <b v-for="(at, k) in seen" :key="k">{{ at ? at.getTime() : -1 }}</b>
    <u v-for="(at, who) in pinned" :key="who">{{ who }} {{ at.getUTCMonth() }}</u>
    <DateReplies :replies="thread.replies" :depth="0" />
  </section>
</template>
