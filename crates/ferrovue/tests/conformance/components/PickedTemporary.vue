<script setup lang="ts">
defineProps<{ n?: number; s: string }>();
</script>

<template>
  <p>{{ n ? (['a', 'Σ' + s].at(-1) ?? '<i>') : s }}</p>
  <p>{{ n ? (['a', s + '!'].at(n) ?? '<i>') : s }}</p>
</template>
