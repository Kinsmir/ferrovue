<script setup lang="ts">
type Kind = "text" | "link";
type Mark = "" | "new";
interface Part {
  label: string;
  tags: string[];
}
const props = defineProps<{
  kind: Kind;
  mark: Mark;
  note?: string;
  replaces?: string;
  eager: boolean;
  collapsed: boolean;
  flair: string[];
  parts: Part[];
  byName: Record<string, Part>;
}>();
</script>

<template>
  <div v-if="replaces" :data-replaces="replaces" :data-collapsed="collapsed ? '' : undefined" :data-kind="kind" :data-mark="mark" :data-mark-or="mark || undefined" :title="note || undefined">
    <iframe :loading="eager ? undefined : 'lazy'" :title="eager ? 'a&quot;<b>' : undefined"></iframe>
    <b v-if="flair.length">{{ flair.length }}</b>
    <b v-if="!flair.length">none</b>
    <p v-for="(part, n) in parts" :class="[n !== 0 ? 'later' : '', n + 1 === parts.length ? 'last' : '']" :data-n="n - 1">
      {{ n + 2 }}:{{ part.label }}<i v-if="part.tags.length > n">{{ part.tags.length - n }}</i>
    </p>
    <s v-for="(part, name, i) in byName" :title="part.label || undefined">{{ name }}{{ i * 2 }}{{ i - 3 }}</s>
  </div>
  <span v-else :data-kind="kind">{{ replaces }}</span>
</template>
