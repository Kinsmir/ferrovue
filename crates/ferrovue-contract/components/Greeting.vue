<script setup lang="ts">
defineProps<{ name: string; unread?: number; showHead?: boolean; type?: string }>();
const model = defineModel<string>();
</script>

<template>
  <p :class="type">Hello, {{ name }}!<b v-if="showHead">{{ unread }}</b>{{ model }}</p>
</template>
