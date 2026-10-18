<script setup lang="ts">
import { computed } from "vue";
import UnreadFold from "./UnreadFold.vue";

const props = defineProps<{ when: string; show: boolean; count: number; word: string; width: number; tags: string[]; note?: string }>();
const upper = computed(() => props.word.toUpperCase());
const padded = computed(() => props.word.padStart(props.width, "."));
const unused = computed(() => props.word.repeat(props.count));
const iso = computed(() => new Date(props.when).toISOString());
const stamp = computed(() => `${iso.value} (${props.word})`);
const day = computed(() => new Date(props.when).getUTCDate());
const size = computed(() => props.word.repeat(props.count).length);
const copies = computed(() => props.tags.map((t) => t.repeat(props.count)));
const echoed = computed(() => (props.note ? props.note.repeat(props.count) : undefined));
</script>

<template>
  <section>
    <p>{{ upper }}|{{ padded }}</p>
    <template v-if="show">
      <time :datetime="iso">{{ stamp }}</time>
      <p>{{ day }}|{{ size }}|{{ echoed ?? "-" }}</p>
      <ul>
        <li v-for="c in copies" :key="c">{{ c }}|{{ stamp.length }}</li>
      </ul>
      <UnreadFold :label="stamp" />
    </template>
    <p v-else>hidden</p>
    <UnreadFold :open="show"><i>{{ iso }}</i></UnreadFold>
  </section>
</template>
