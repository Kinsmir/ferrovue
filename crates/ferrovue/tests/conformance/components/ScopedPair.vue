<script setup lang="ts">
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
