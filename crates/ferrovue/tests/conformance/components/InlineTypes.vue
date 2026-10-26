<script setup lang="ts">
import UnionBadge from "./UnionBadge.vue";
import type { Placed } from "../types/placed.ts";

type Side = "left" | "right";

defineProps<{
  post: Placed;
  box: { width: number; note?: string; inner: { on: boolean } };
  rows: { key: string; side: Side }[];
  sides: Record<Side, string>;
  limits?: { [K in Side]?: number };
  mood: Placed["mood"];
  label: string;
}>();
</script>

<template>
  <article :title="post.title" :data-width="box.width">
    <UnionBadge :mood="mood" :label="post.author.name" />
    <a v-for="(l, i) in post.author.links" :key="i" :href="l.href">{{ l.label ?? label }}</a>
    {{ post.counts.seen }}/{{ post.counts.liked }}|{{ box.note ?? "-" }}|{{ box.inner.on }}
    <p v-for="r in rows" :key="r.key" :class="r.side">{{ r.key }} {{ sides[r.side] }}</p>
    {{ sides.left }}|{{ sides.right }}|{{ limits?.left ?? 0 }}
  </article>
</template>
