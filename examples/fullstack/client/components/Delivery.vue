<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ ordered: string; days: number }>();
const arrives = computed(() => new Date(Date.parse(props.ordered) + props.days * 86400000));
</script>

<template>
  <p class="delivery">
    Ordered on <time :datetime="new Date(ordered).toISOString()">{{ new Date(ordered).toISOString().slice(0, 10) }}</time>, arrives
    {{ days === 1 ? "the next day" : `${days} days later` }}, on <time :datetime="arrives.toISOString()">{{ arrives.toUTCString().slice(0, 16) }}</time>
  </p>
</template>
