<script setup lang="ts">
defineProps<{ text: string; other: string }>();
</script>

<template>
  <ol :data-length="text.length">
    <li v-for="i in text.length" :key="i" :data-code="text.charCodeAt(i - 1)">{{ text.codePointAt(text.length - i) }}|{{ other[i - 1] }}|{{ other.charAt(other.length - i) }}|{{ other.at(-i) }}|{{ other.at(i - 2) }}</li>
  </ol>
</template>
