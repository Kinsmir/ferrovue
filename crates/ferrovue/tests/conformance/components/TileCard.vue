<script setup lang="ts">
import type { Tile } from "../types/tiles";

defineProps<{ tile: Tile }>();
</script>

<template>
  <article>
    <h3>{{ tile.title }}</h3>
    <p>{{ tile.count }}|{{ tile.note ?? "no note" }}|{{ tile.owner === null ? "nobody" : tile.owner }}|{{ tile.tags.join(",") }}</p>
    <b v-if="tile.badge" :class="tile.badge.tone">{{ tile.badge.label }}</b>
  </article>
</template>
