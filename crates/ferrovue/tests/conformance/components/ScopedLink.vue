<script setup lang="ts">
defineProps<{ to: string }>();
</script>

<template>
  <RouterLink :to="to" class="link">go <b>there</b></RouterLink>
</template>

<style scoped>
.link {
  text-decoration: none;
}
</style>
