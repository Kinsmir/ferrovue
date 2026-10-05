<script setup lang="ts">
import FallLeaf from "./FallLeaf.vue";

defineProps<{ text?: string }>();
</script>

<template>
  <FallLeaf :label="text ?? 'rooted'" class="via" data-via="root" :shown="true" />
</template>
