<script setup lang="ts">
/* Scoped, with two roots: a fragment, which inherits no ids from its parent. */
defineProps<{ term: string; text: string }>();
</script>

<template>
  <dt>{{ term }}</dt>
  <dd :data-term="term">{{ text }}</dd>
</template>

<style scoped>
dt {
  float: left;
}
</style>
