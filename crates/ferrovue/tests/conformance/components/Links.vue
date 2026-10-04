<script setup lang="ts">
/* `<RouterLink>` with no class of its own, with a computed `to`, and with plain attributes. */
defineProps<{ user: string; tab?: string }>();
</script>

<template>
  <nav><RouterLink to="/">home</RouterLink> <RouterLink :to="'/users/' + user" :data-user="user" rel="author">{{ user }}</RouterLink> <RouterLink v-if="tab" :to="'/blog/' + user + '/' + tab" :title="tab">{{ tab }}</RouterLink></nav>
</template>
