<script setup lang="ts">
/* Scoped, its root a `<RouterLink>`: the link's `<a>` takes what the parent hands this component
 * and this component's own id. */
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
