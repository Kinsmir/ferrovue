<script setup lang="ts">
import type { TileRow } from "../types/tiles";

defineProps<{ rows: TileRow[] }>();
</script>

<template>
  <nav>
    <a v-for="r in rows" :key="r.id" :href="r.href" :class="{ first: r.first }">{{ r.id }}. {{ r.label }}</a>
  </nav>
</template>
