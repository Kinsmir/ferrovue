<script setup lang="ts">
import { computed } from "vue";
import DateStamp from "./DateStamp.vue";

const props = defineProps<{ posted: Date; edited?: Date; deleted: Date | null; title: string; tags: string[] }>();
const valid = computed(() => props.posted.getTime() === props.posted.getTime());
const year = computed(() => props.posted.getUTCFullYear());
const shown = computed(() => props.edited ?? props.posted);
</script>

<template>
  <article>
    <h2>{{ title }}</h2>
    <p v-if="valid"><time :datetime="posted.toISOString()">{{ posted.getUTCDate() }}/{{ posted.getUTCMonth() + 1 }}/{{ year }}</time></p>
    <p v-else>invalid: {{ posted.getTime() }}|{{ year }}|{{ props.posted.valueOf() }}|{{ posted.getUTCDay() }}</p>
    <p v-if="edited">edited {{ edited.getTime() }} on day {{ new Date(edited).getUTCDay() }}</p>
    <p v-else>never edited</p>
    <p v-if="deleted !== null">deleted at {{ deleted.getUTCHours() }}:{{ deleted.getUTCMinutes() }}:{{ deleted.getUTCSeconds() }}</p>
    <ul>
      <li v-for="(tag, i) in tags" :key="tag">{{ tag }} {{ posted.getUTCMilliseconds() + i }}</li>
    </ul>
    <DateStamp :at="posted" :edited="edited" :deleted="deleted" :shown="shown" />
  </article>
</template>
