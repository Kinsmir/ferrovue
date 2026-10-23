<script setup lang="ts">
import { computed, type ComputedRef } from "vue";
import TileCard from "./TileCard.vue";
import TileRows from "./TileRows.vue";
import { relabel, tileOf, type Tile, type TileRow } from "../types/tiles";

interface Summary {
  heading: string;
  size: number;
  hint?: string;
  extra: string | null;
}

const KEY = "heading";

const props = defineProps<{ name: string; count: number; words: string[]; note?: string; owner: string | null }>();

const summary = computed((): Summary =>
  props.count > 0 ? { heading: props.name, size: props.count, extra: null } : { [KEY]: "empty", size: 0, hint: props.note, extra: props.owner },
);

const tile = computed<Tile>(() => ({
  title: props.name,
  count: props.count,
  note: props.note,
  owner: props.owner,
  tags: props.words,
  badge: props.count > 2 ? { label: `${props.count}+`, tone: "many" } : undefined,
}));

const rows: ComputedRef<TileRow[]> = computed(() =>
  props.words.map((w, i) => ({ id: i + 1, label: w.toUpperCase(), href: `/w/${encodeURIComponent(w)}`, first: i === 0 })),
);

const renamed = computed((): Tile => ({ ...tile.value, title: `${props.name}!` }));

const picked = computed((): Summary => {
  if (props.owner === null) return { heading: "no owner", size: props.words.length, extra: null };
  const heading = props.owner.trim();
  return { heading, size: heading.length, hint: props.note ?? "-", extra: props.owner };
});

function local(label: string): Summary {
  const size = label.length;
  if (size === 0) return { heading: "-", size, extra: null };
  return { heading: label.toUpperCase(), size, hint: label, extra: "x" };
}
</script>

<template>
  <section>
    <h2>{{ summary.heading }}|{{ summary.size }}|{{ summary.hint ?? "none" }}|{{ summary.extra ?? "null" }}</h2>
    <h2>{{ picked.heading }}|{{ picked.size }}|{{ picked.hint ?? "none" }}|{{ picked.extra ?? "null" }}</h2>
    <TileCard :tile="tile" />
    <TileCard :tile="{ title: name, count, owner: null, tags: [] }" />
    <TileCard v-bind="{ tile: { title: 'bound', count: 1, owner, tags: words, note } }" />
    <TileCard :tile="tileOf(name, count)" />
    <TileCard :tile="relabel(tile, 'other')" />
    <TileCard :tile="renamed" />
    <TileRows :rows="rows" />
    <TileRows :rows="words.map((w, i) => ({ id: i, label: w, href: '#' + w, first: false }))" />
    <p>{{ local(name).heading }}|{{ local(name).hint ?? "none" }}|{{ local("").size }}</p>
  </section>
</template>
