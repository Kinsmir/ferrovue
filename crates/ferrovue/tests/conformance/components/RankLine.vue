<script setup lang="ts">
defineProps<{ best?: number; worst: number | null; open: boolean | null }>();
</script>

<template>
  <p class="ranks">
    <b v-if="best !== undefined">{{ best }}</b><i v-else>none</i>
    <s v-if="worst !== null">{{ worst }}</s><i v-else>no worst</i>
    <u v-if="open !== null">{{ open }}</u>
  </p>
</template>
