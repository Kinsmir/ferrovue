<script setup lang="ts">
import Posted from "./Posted.vue";
import Rated from "./Rated.vue";
import Wrap from "./Wrap.vue";

defineProps<{ on: string; year: number; count: number; fill: string }>();
</script>

<template>
  <p>{{ new Date(on).getTime() }}|{{ Date.UTC(year, count) }}|{{ fill.padStart(count, "-") }}|{{ fill.padEnd(count) }}|{{ fill.repeat(count) }}|{{ fill.at(count - 4) }}</p>
  <Posted :at="new Date(on)" :deleted="null" />
  <Wrap class="framed"><Rated :stars="year * 2" /></Wrap>
  <Wrap :title="`${fill}-${count}`" />
</template>
