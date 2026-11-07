<script setup lang="ts">
import type { Float } from "ferrovue/types";

defineProps<{ tags: string[]; counts: number[]; ratios: Float[]; sep: string }>();
</script>

<template>
  <p :title="tags.join(sep)">{{ tags.join(sep) }}|{{ counts.join(", ") }}|{{ ratios.join() }}</p>
</template>
