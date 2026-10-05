<script setup lang="ts">
defineProps<{ user: string; tab?: string }>();
</script>

<template>
  <nav><RouterLink to="/">home</RouterLink> <RouterLink :to="'/users/' + user" :data-user="user" rel="author">{{ user }}</RouterLink> <RouterLink v-if="tab" :to="'/blog/' + user + '/' + tab" :title="tab">{{ tab }}</RouterLink></nav>
</template>
