<script setup lang="ts">
import { computed } from "vue";

interface Meta {
  $tag: string;
  tag: string;
  count$: number;
}

interface Entry {
  $meta: Meta;
  label: string;
}

const props = defineProps<{ title: string; price$: number; entry: Entry; rows: Entry[] }>();

const $label = computed(() => `${props.title}!`);
const label = computed(() => props.entry.label.trim());

function shout($text: string): string {
  const $loud = $text.toUpperCase();
  return `${$loud}:${props.price$}`;
}
</script>

<template>
  <section :title="$label" :data-tag="entry.$meta.$tag">
    <h2>{{ $label }}|{{ label }}|{{ shout(title) }}</h2>
    <p>{{ entry.$meta.$tag }}|{{ entry.$meta.tag }}|{{ entry.$meta.count$ + price$ }}</p>
    <ul>
      <li v-for="($row, $i) in rows" :key="$i" :data-tag="$row.$meta.tag">{{ $i }}:{{ $row.label }}|{{ $row.$meta.$tag }}</li>
    </ul>
  </section>
</template>
