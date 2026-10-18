<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ published: string; updated?: string; at: number; offset: Float; days: string[] }>();
const date = computed(() => new Date(props.published));
const moment = computed(() => new Date(props.at + props.offset));
const valid = computed(() => moment.value.getTime() === moment.value.getTime());
const year = computed(() => date.value.getUTCFullYear());
</script>

<template>
  <article>
    <time :datetime="date.toISOString()">{{ date.getUTCDate() }}/{{ date.getUTCMonth() + 1 }}/{{ year }}</time>
    <p>{{ new Date(published).getTime() }}|{{ Date.parse(published) }}|{{ date.valueOf() }}|{{ date.getUTCDay() }}</p>
    <p>{{ `${date.getUTCHours()}:${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")}.${date.getUTCMilliseconds()}` }}</p>
    <p v-if="updated">{{ new Date(updated).toISOString() }}</p>
    <p v-else>never updated</p>
    <p v-if="valid">{{ moment.toISOString() }}</p>
    <p v-else>invalid: {{ moment.getTime() }}|{{ moment.getUTCFullYear() }}|{{ moment.getUTCMonth() }}|{{ moment.getUTCDate() }}|{{ moment.getUTCDay() }}|{{ moment.getUTCHours() }}|{{ moment.getUTCMinutes() }}|{{ moment.getUTCSeconds() }}|{{ moment.getUTCMilliseconds() }}</p>
    <p>{{ new Date(at).getUTCFullYear() }}|{{ new Date(offset).getTime() }}|{{ new Date("2024-02-29T12:00+05:30").toISOString() }}|{{ new Date(date).getTime() }}</p>
    <ul>
      <li v-for="day in days" :key="day">{{ new Date(day).toISOString().slice(0, 10) }} is day {{ new Date(day).getUTCDay() }}</li>
    </ul>
  </article>
</template>
