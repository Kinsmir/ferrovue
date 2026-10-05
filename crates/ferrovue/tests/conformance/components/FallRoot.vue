<script setup lang="ts">
/* A root that is another component: what this one is passed goes on to it, merged with the
 * attributes it gives that one itself, and falls through to that one's root in turn. */
import FallLeaf from "./FallLeaf.vue";

defineProps<{ text?: string }>();
</script>

<template>
  <FallLeaf :label="text ?? 'rooted'" class="via" data-via="root" :shown="true" />
</template>
