<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ posted: Date; due: Date; edited?: Date; published: string; year: number; month: number; day: Float; times: number[]; label: string }>();
const made = computed(() => new Date(Date.UTC(props.year, props.month, props.day)));
const json = computed(() => props.posted.toJSON());
const early = computed(() => props.posted < props.due);
</script>

<template>
  <article>
    <h2>{{ label }}</h2>
    <time :datetime="posted.toJSON()" :title="due.toJSON()">{{ posted.toUTCString() }}</time>
    <p>{{ json ?? "no date" }}|{{ due.toJSON() }}|{{ JSON.stringify(posted) }}|{{ JSON.stringify(new Date(published)) }}|{{ JSON.stringify([label]) }}</p>
    <p v-if="due.toJSON() === null">due is invalid</p>
    <p v-else>due {{ due.toUTCString() }}</p>
    <p>{{ Date.UTC(year) }}|{{ Date.UTC(year, month) }}|{{ Date.UTC(year, month, day, 25, -1, 61, 999.9) }}|{{ Date.UTC(99, 0) }}|{{ Date.UTC(1e6, 0, -365242500) }}|{{ made.toUTCString() }}|{{ made.getTime() }}</p>
    <p>{{ early }}|{{ posted <= due }}|{{ posted > due }}|{{ posted >= due }}|{{ posted <= posted }}|{{ new Date(published) < posted }}</p>
    <p v-if="edited && edited > posted">edited later, {{ edited.toUTCString() }}</p>
    <ul>
      <li v-for="t in times" :key="t" :class="{ late: new Date(t) > due }">{{ new Date(t).toUTCString() }}|{{ new Date(t).toJSON() ?? "invalid" }}</li>
    </ul>
  </article>
</template>
